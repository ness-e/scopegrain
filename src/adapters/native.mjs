// Native host adapter PROPOSALS: thin bridge files projected under
// <configDir>/integrations/native/<host>/... mirroring the intended host
// target path. Everything here is a reviewable proposal — destination
// metadata never becomes a write outside the project workspace.
import path from 'node:path';
import fs from 'node:fs';
import { err } from '../core/errors.mjs';
import { lstatOrNull, readFileLimited, readJsonFile } from '../core/fsx.mjs';
import {
  catalogDestRel, INSTALL_ROOT, loadCatalog,
} from '../core/catalog.mjs';
import { resolveInside, toCanonicalRelative } from '../core/paths.mjs';
import { loadLimits } from '../core/policy.mjs';
import { renderTemplate } from '../core/bootstrap.mjs';

const POLICY_REL = 'policy/native-adapters.json';
const TPL_RESOURCE = 'templates/hosts/native-resource.md';
const TPL_AGENT = 'templates/hosts/native-agent.md';

export function loadNativePolicy({ installRoot = INSTALL_ROOT } = {}) {
  const abs = resolveInside(installRoot, POLICY_REL, 'native policy');
  const st = lstatOrNull(abs);
  if (!st || st.isSymbolicLink() || !st.isFile()) {
    throw err('POLICY_MALFORMED', 'policy/native-adapters.json missing');
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('POLICY_MALFORMED', 'native policy exceeds document limit');
  }
  let p;
  try {
    p = JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('POLICY_MALFORMED', 'native adapters policy is not valid JSON');
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p)
      || p.schemaVersion !== 1 || typeof p.namespace !== 'string'
      || p.hosts === null || typeof p.hosts !== 'object'
      || !Array.isArray(p.readOnlyAgentIds)) {
    throw err('POLICY_MALFORMED', 'policy/native-adapters.json is malformed');
  }
  return p;
}

function readTemplate(installRoot, rel) {
  const abs = resolveInside(installRoot, rel, `native template ${rel}`);
  const st = lstatOrNull(abs);
  if (!st || st.isSymbolicLink() || !st.isFile()) {
    throw err('TEMPLATE_MISSING', `native template missing: ${rel}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('TEMPLATE_MISSING', `native template too large: ${rel}`);
  }
  return limited.content;
}

// One complete YAML header: declared scalars (JSON.stringify keeps colons/
// newlines/quotes safe) plus the host's raw frontmatter lines, all INSIDE
// the --- fence so permissions are never rendered as body text.
const frontmatter = (pairs, extras = '') =>
  `---\n${pairs.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n${extras}---\n\n`;

function nativeName(policy, id) {
  return `${policy.namespace}${id.toLowerCase()}`;
}

// configRel -> config-dir prefix ('cfg space/x.json' -> 'cfg space/',
// 'config.json' -> ''). Structured rejection of non-file config paths.
export function configDirPrefix(configRel) {
  assertSafeLiteral(configRel, 'configRel'); // precedes path validation
  const rel = toCanonicalRelative(configRel, 'configRel');
  const idx = rel.lastIndexOf('/');
  if (idx === -1) return '';
  return `${rel.slice(0, idx + 1)}`;
}

// Hosts preprocess interpolations before permission flow (OpenCode expands
// !`...` shell blocks; commands expand $ARGUMENTS/$N). A literal containing
// such a marker must abort generation — never auto-execute or 'escape'
// uncertain host syntax. Authored templates/policy contain none by design.
const UNSAFE_LITERAL = /!`|\$ARGUMENTS|\$\d+/;
function assertSafeLiteral(value, label) {
  if (typeof value === 'string' && UNSAFE_LITERAL.test(value)) {
    throw err('NATIVE_UNSAFE_LITERAL',
      `${label} contains a host-interpolated sequence: ${value}`);
  }
  return value;
}

// renderNativeAdapters(config, {configRel, installRoot}) ->
//   {files: [{rel, content}], activationPlan}
// configRel is the project-relative config path (e.g. '.tasksystem/config.json').
export function renderNativeAdapters(config, { configRel, installRoot = INSTALL_ROOT } = {}) {
  const policy = loadNativePolicy({ installRoot });
  const catalog = loadCatalog({ installRoot });
  const cfgPrefix = configDirPrefix(configRel);
  const tplResource = readTemplate(installRoot, TPL_RESOURCE);
  const tplAgent = readTemplate(installRoot, TPL_AGENT);
  const files = [];
  const entries = [];

  const vars = (kind, id, destRel) => {
    const v = {
      instructionsPath: `${cfgPrefix}instructions.md`,
      configPath: configRel,
      kind, id,
      resourcePath: `${cfgPrefix}${destRel}`,
      catalogPath: `${cfgPrefix}catalog.json`,
    };
    for (const [k, val] of Object.entries(v)) assertSafeLiteral(val, k);
    return v;
  };

  const emit = (host, kind, id, hostRel, content) => {
    const rel = `${cfgPrefix}integrations/native/${host}/${hostRel}`;
    files.push({ rel, content });
    entries.push({
      host, kind, id,
      source: rel,
      destination: hostRel,
      manualMerge: true,
    });
  };

  const readOnly = new Set(policy.readOnlyAgentIds);

  for (const host of config.hosts) {
    const hp = policy.hosts[host];
    if (!hp) {
      throw err('UNKNOWN_HOST', `no native adapter policy for host '${host}'`);
    }
    for (const e of catalog.entries) {
      const canon = catalogDestRel(e);
      const v = vars(e.kind, e.id, canon);
      const name = nativeName(policy, e.id);
      const tplText = (b) => b.toString('utf8');
      if (e.kind === 'skill') {
        const body = renderTemplate(tplText(tplResource), v);
        emit(host, 'skill', e.id,
          `${hp.skillRoot}/${name}/SKILL.md`,
          frontmatter([['name', name], ['description', e.description]]) + body);
      } else if (e.kind === 'command') {
        const body = renderTemplate(tplText(tplResource), v);
        if (hp.commandFormat === 'skill') {
          // Host command frontmatter is INSIDE the YAML fence.
          emit(host, 'command', e.id,
            `${hp.skillRoot}/${name}/SKILL.md`,
            frontmatter([['name', name], ['description', e.description]],
              hp.commandFrontmatter || '') + body);
        } else {
          emit(host, 'command', e.id,
            `${hp.commandRoot}/${name}.md`,
            frontmatter([['description', e.description]],
              hp.commandFrontmatter || '') + body);
        }
      } else if (e.kind === 'agent') {
        const extras = (hp.agentFrontmatter || '')
          + (readOnly.has(e.id) ? (hp.readOnlyAgentFrontmatter || '') : '');
        const body = renderTemplate(tplText(tplAgent), v);
        if (hp.agentFormat === 'toml-with-declarations') {
          const toml = [
            `description = ${JSON.stringify(e.description)}`,
            `developer_instructions = ${JSON.stringify(body)}`,
            ...(readOnly.has(e.id)
              ? [(hp.readOnlyAgentFrontmatter || '').trim()] : []),
            '',
          ].join('\n');
          emit(host, 'agent', e.id,
            `${hp.agentRoot}/${name}.toml`, toml);
        } else {
          emit(host, 'agent', e.id,
            `${hp.agentRoot}/${name}.md`,
            frontmatter([['name', name], ['description', e.description]],
              extras) + body);
        }
      }
    }
    // Codex: ONE declaration fragment outside the agent dir — it must not
    // autodiscover as a role. Manual merge into .codex/config.toml only.
    if (hp.agentFormat === 'toml-with-declarations') {
      const decls = catalog.entries
        .filter((e) => e.kind === 'agent')
        .map((e) => {
          const name = nativeName(policy, e.id);
          return [
            `[agents."${name}"]`,
            `description = ${JSON.stringify(e.description)}`,
            `config_file = "agents/${name}.toml"`,
          ].join('\n');
        }).join('\n\n');
      files.push({
        rel: `${cfgPrefix}integrations/native/${host}/agents-fragment.toml`,
        content: `# manual merge into .codex/config.toml\n${decls}\n`,
      });
      entries.push({
        host, kind: 'agent-declaration', id: '*',
        source: `${cfgPrefix}integrations/native/${host}/agents-fragment.toml`,
        destination: '.codex/config.toml',
        manualMerge: true,
      });
    }
  }

  const perHost = {};
  for (const host of config.hosts) {
    perHost[host] = {
      sources: policy.hosts[host].sources,
      permissionScope: policy.hosts[host].permissionScope,
    };
  }
  return {
    files,
    activationPlan: {
      schemaVersion: 1,
      activation: policy.activation,
      hooksInstalled: false,
      nativeHostTested: false,
      writeHostRoots: policy.writeHostRoots,
      hosts: perHost,
      entries,
      note: 'reviewable proposals only; destinations are intended host-root '
        + 'paths for manual merge — the harness never writes them',
    },
  };
}
