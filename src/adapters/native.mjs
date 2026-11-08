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
import { KNOWN_HOSTS } from '../core/config.mjs';
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
  validateNativePolicy(p);
  return p;
}

const POLICY_KEYS = new Set([
  'schemaVersion', 'namespace', 'activation', 'writeHostRoots',
  'installHooks', 'installPlugins', 'readOnlyAgentIds', 'hosts',
]);
const HOST_KEYS = new Set([
  'skillRoot', 'commandRoot', 'commandFormat', 'agentRoot', 'agentFormat',
  'commandFrontmatter', 'agentFrontmatter', 'readOnlyAgentFrontmatter',
  'invocation', 'permissionScope', 'sources',
]);
const CMD_FORMATS = new Set(['skill', 'markdown']);
const AGENT_FORMATS = new Set(['markdown', 'toml-with-declarations']);
const FORBIDDEN_SEGMENT = new Set(['.git', 'node_modules', 'legacy']);
const HTTPS_URL = /^https:\/\/[^\s]+$/;
const bad = (msg) => err('POLICY_MALFORMED', `native policy: ${msg}`);

// Canonical relative dir via the shared normalizer: rejects absolute,
// traversal, double-slash, dot-prefixed paths; the value must be a
// non-root relative dir whose FIRST segment is not forbidden. '.opencode'
// is allowed (documented native proposal destination).
function assertCanonicalRoot(value, label) {
  if (typeof value !== 'string' || value === '' || value === '.'
      || value.endsWith('/')) {
    throw bad(`${label} must be a non-root canonical relative dir`);
  }
  let rel;
  try {
    rel = toCanonicalRelative(value, label);
  } catch {
    throw bad(`${label} is not a canonical relative path: '${value}'`);
  }
  const first = rel.split('/')[0].toLowerCase();
  if (FORBIDDEN_SEGMENT.has(first)) {
    throw bad(`${label} may not start with '${first}'`);
  }
  return rel;
}

function validateNativePolicy(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw bad('root must be an object');
  }
  for (const k of Object.keys(p)) {
    if (!POLICY_KEYS.has(k)) throw bad(`unknown key '${k}'`);
  }
  for (const k of POLICY_KEYS) {
    if (!(k in p)) throw bad(`missing required key '${k}'`);
  }
  if (p.schemaVersion !== 1) throw bad('schemaVersion must be 1');
  // lowercase alnum segments joined by single hyphens + trailing hyphen;
  // '--' disallowed by the segment pattern.
  if (typeof p.namespace !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*-$/.test(p.namespace)) {
    throw bad('namespace must be a lowercase-hyphenated prefix ending in -');
  }
  if (p.activation !== 'manual-review-only') {
    throw bad("activation must be 'manual-review-only'");
  }
  for (const f of ['writeHostRoots', 'installHooks', 'installPlugins']) {
    if (p[f] !== false) throw bad(`${f} must be exactly false`);
  }
  if (!Array.isArray(p.readOnlyAgentIds) || p.readOnlyAgentIds.length === 0
      || !p.readOnlyAgentIds.every((x) => typeof x === 'string' && x !== '')
      || new Set(p.readOnlyAgentIds).size !== p.readOnlyAgentIds.length) {
    throw bad('readOnlyAgentIds must be unique non-empty strings');
  }
  const knownHosts = new Set(KNOWN_HOSTS);
  if (p.hosts === null || typeof p.hosts !== 'object' || Array.isArray(p.hosts)
      || Object.keys(p.hosts).length === 0) {
    throw bad('hosts must be a non-empty object');
  }
  for (const [name, h] of Object.entries(p.hosts)) {
    if (!knownHosts.has(name)) throw bad(`unknown host '${name}'`);
    if (h === null || typeof h !== 'object' || Array.isArray(h)) {
      throw bad(`hosts.${name} must be an object`);
    }
    for (const k of Object.keys(h)) {
      if (!HOST_KEYS.has(k)) throw bad(`hosts.${name} unknown key '${k}'`);
    }
    if (!CMD_FORMATS.has(h.commandFormat)) {
      throw bad(`hosts.${name}.commandFormat must be skill|markdown`);
    }
    if (!AGENT_FORMATS.has(h.agentFormat)) {
      throw bad(`hosts.${name}.agentFormat must be markdown|toml-with-declarations`);
    }
    if (h.commandFormat === 'markdown' && typeof h.commandRoot !== 'string') {
      throw bad(`hosts.${name}.commandRoot required for markdown commands`);
    }
    for (const rk of ['skillRoot', 'agentRoot']) {
      assertCanonicalRoot(h[rk], `hosts.${name}.${rk}`);
    }
    if (h.commandFormat === 'markdown') {
      assertCanonicalRoot(h.commandRoot, `hosts.${name}.commandRoot`);
    }
    for (const tk of ['invocation', 'permissionScope']) {
      if (typeof h[tk] !== 'string' || h[tk] === '') {
        throw bad(`hosts.${name}.${tk} must be a non-empty string`);
      }
    }
    for (const fk of ['commandFrontmatter', 'agentFrontmatter',
      'readOnlyAgentFrontmatter']) {
      if (h[fk] !== undefined && typeof h[fk] !== 'string') {
        throw bad(`hosts.${name}.${fk} must be a string`);
      }
    }
    if (!Array.isArray(h.sources) || h.sources.length === 0
        || !h.sources.every((s) => typeof s === 'string' && HTTPS_URL.test(s))
        || new Set(h.sources).size !== h.sources.length) {
      throw bad(`hosts.${name}.sources must be unique https URLs`);
    }
  }
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
  // Policy-declared read-only agents must actually exist in the catalog.
  const agentIds = new Set(catalog.entries
    .filter((e) => e.kind === 'agent').map((a) => a.id));
  for (const id of policy.readOnlyAgentIds) {
    if (!agentIds.has(id)) {
      throw err('POLICY_MALFORMED',
        `readOnlyAgentIds '${id}' has no agent in catalog`);
    }
  }
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
