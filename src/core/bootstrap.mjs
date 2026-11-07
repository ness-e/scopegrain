// Init planning and application: renders templates, builds the full file
// plan, preflights every destination and creates files exclusively.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import { lstatOrNull, mkdirpSync, removeIfExists } from './fsx.mjs';
import {
  assertDestination, isSameOrAncestor, portableKey, resolveInside,
} from './paths.mjs';
import {
  DEFAULT_CONFIG_PATH, assertAnswersMatchConfig,
  assertNoCollisions, configDirOf, createConfig,
  loadConfig, validateAnswers,
} from './config.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { renderAdapters } from '../adapters/render.mjs';
import { catalogFiles } from './catalog.mjs';
import { buildVersioningFiles } from './versioning.mjs';
import { renderNativeAdapters } from '../adapters/native.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INSTALL_ROOT = path.resolve(MODULE_DIR, '..', '..');
const TEMPLATES_DIR = path.join(INSTALL_ROOT, 'templates');
const SERVER_PATH = path.join(INSTALL_ROOT, 'src', 'mcp', 'server.mjs');
const AGENTS_HOSTS = new Set(['codex', 'opencode', 'devin']);

export function templateDir(installRoot = INSTALL_ROOT) {
  return path.join(installRoot, 'templates');
}

function readTemplate(name, templatesDir = TEMPLATES_DIR) {
  return fs.readFileSync(path.join(templatesDir, name), 'utf8');
}

export function renderTemplate(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  if (out.includes('{{')) {
    throw err('TEMPLATE_UNRESOLVED', 'unresolved placeholder remains after render');
  }
  return out;
}

function planFile(projectRoot, rel, content) {
  const abs = resolveInside(projectRoot, rel, `plan destination ${rel}`);
  return { rel, abs, content };
}

// Builds the complete init plan from an already-validated config object.
// Pure computation + reads; performs no writes. configContent and
// discoveryContent may supply preserved bytes for re-init no-ops.
export function buildInitPlan({
  projectRoot, configRel, config, configContent, discovery, discoveryContent,
  templatesDir = TEMPLATES_DIR, installRoot = null,
}) {
  const cfgRel = assertDestination(configRel || DEFAULT_CONFIG_PATH, 'configPath');
  assertNoCollisions(config.paths, cfgRel, config.hosts);

  const configDir = configDirOf(cfgRel);
  const prefix = configDir === '.' ? '' : configDir + '/';
  const configAbs = resolveInside(projectRoot, cfgRel, 'config');
  const instructionsRel = `${prefix}instructions.md`;
  const discoveryRel = `${prefix}discovery.json`;

  const files = [];
  files.push(planFile(projectRoot, cfgRel,
    configContent !== undefined
      ? configContent
      : JSON.stringify(config, null, 2) + '\n'));
  files.push(planFile(projectRoot, instructionsRel, renderTemplate(
    readTemplate('project-instructions.md', templatesDir),
    { configPath: cfgRel, discoveryPath: discoveryRel })));
  // discovery.json is ALWAYS planned: preserved bytes on a no-op re-init,
  // fresh serialization when absent (repairing a deleted file) or changed.
  files.push(planFile(projectRoot, discoveryRel,
    discoveryContent !== undefined
      ? discoveryContent
      : JSON.stringify(discovery ?? null, null, 2) + '\n'));

  // Common entrypoint for codex/opencode/devin; CLAUDE.md for claude.
  // Distinct filenames: no duplicates inside a single plan.
  const entry = renderTemplate(readTemplate('entrypoint.md', templatesDir), {
    instructionsPath: instructionsRel,
    configPath: cfgRel,
  });
  if (config.hosts.some((h) => AGENTS_HOSTS.has(h))) {
    files.push(planFile(projectRoot, 'AGENTS.md', entry));
  }
  if (config.hosts.includes('claude')) {
    files.push(planFile(projectRoot, 'CLAUDE.md', entry));
  }

  const rendered = renderAdapters(config, {
    projectRoot,
    configPath: configAbs,
    instructionsPath: resolveInside(projectRoot, instructionsRel),
    serverPath: SERVER_PATH,
  });
  for (const f of rendered.files) {
    files.push(planFile(projectRoot, `${prefix}${f.relativePath}`, f.content));
  }
  files.push(planFile(projectRoot, `${prefix}task-contract.md`,
    readTemplate('task-contract.md', templatesDir)));

  // Canonical workflow/limits policy copied verbatim so copied references
  // can resolve ../policy/*.json inside the projected workspace.
  for (const p of ['workflow.json', 'operation-limits.json']) {
    files.push(planFile(projectRoot, `${prefix}policy/${p}`,
      readTemplate(path.join('..', 'policy', p), templatesDir)));
  }

  // Catalog projection: every manifest entry (commands, agents, skills,
  // rules, references, profiles) plus catalog.json. The three template
  // skills arrive through the catalog mapping skills/<id>/SKILL.md.
  for (const cf of catalogFiles({
    installRoot: installRoot || path.dirname(templatesDir),
  })) {
    files.push(planFile(projectRoot, `${prefix}${cf.rel}`, cf.content));
  }

  // Versioning proposals: <configDir>/.gitignore (skipped at project root)
  // and integrations/gitignore-proposal.txt. Root .gitignore untouched.
  for (const vf of buildVersioningFiles({
    configDir, paths: config.paths, versioning: config.versioning,
  })) {
    files.push(planFile(projectRoot, vf.rel, vf.content));
  }

  // Native host proposals: thin bridges under integrations/native plus the
  // manual-review activation plan. Proposals only — no host-root writes.
  const native = renderNativeAdapters(config, {
    configRel: cfgRel,
    installRoot: installRoot || path.dirname(templatesDir),
  });
  for (const nf of native.files) {
    files.push(planFile(projectRoot, nf.rel, Buffer.from(nf.content, 'utf8')));
  }
  files.push(planFile(projectRoot,
    `${prefix}integrations/native/activation-plan.json`,
    JSON.stringify(native.activationPlan, null, 2) + '\n'));
  return { config, files, configDir, configRel: cfgRel };
}

// Every planned file is checked before anything is written:
// - no two planned destinations may be equal or ancestor-related
//   (case-insensitive portable comparison),
// - each leaf must be absent, a link, a non-file, identical (noop) or
//   different (conflict).
export function preflightPlan(projectRoot, files) {
  const conflicts = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i].rel;
      const b = files[j].rel;
      if (isSameOrAncestor(a, b) || isSameOrAncestor(b, a)) {
        conflicts.push({
          path: b,
          reason: `planned destination collides with ${a}`,
        });
      }
    }
  }
  const planned = files.map((f) => {
    // Re-verify containment and the no-link/no-file ancestor chain now.
    const abs = resolveInside(projectRoot, f.rel, `plan destination ${f.rel}`);
    const st = lstatOrNull(abs);
    if (!st) return { ...f, abs, action: 'create' };
    if (st.isSymbolicLink() || !st.isFile()) {
      conflicts.push({ path: f.rel, reason: 'destination is a link or directory' });
      return { ...f, abs, action: 'conflict' };
    }
    const existing = fs.readFileSync(abs);
    const incoming = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    if (existing.equals(incoming)) {
      return { ...f, abs, action: 'noop' };
    }
    conflicts.push({ path: f.rel, reason: 'destination exists with different content' });
    return { ...f, abs, action: 'conflict' };
  });
  if (conflicts.length > 0) {
    const e = err('PLAN_CONFLICT',
      'existing files block init; reconcile manually (no overwrite)');
    e.conflicts = conflicts;
    throw e;
  }
  return planned;
}

// If the config already exists, it must be valid and match the answers;
// otherwise the run is an explicit error, never a silent overwrite.
// Returns the loaded config or null when absent.
export function checkExistingConfig(projectRoot, configRel, answers) {
  const abs = resolveInside(projectRoot, configRel, 'config');
  if (!lstatOrNull(abs)) return null;
  const { config } = loadConfig(projectRoot, configRel);
  assertAnswersMatchConfig(answers, config);
  return config;
}

function readRegularFile(abs) {
  const st = lstatOrNull(abs);
  if (st && st.isFile() && !st.isSymbolicLink()) {
    return fs.readFileSync(abs);
  }
  return undefined;
}

// Applies a preflighted plan. Re-verifies the whole preflight immediately
// before writing (covering anything changed since the plan was shown).
// Each file is created with an exclusive descriptor whose ownership is
// recorded BEFORE content is written, so a mid-write failure still rolls
// back exactly the files this operation created — never foreign files and
// never directories.
export function applyPlan(projectRoot, files) {
  const planned = preflightPlan(projectRoot, files);
  const created = [];
  try {
    for (const f of planned) {
      if (f.action === 'noop') continue;
      mkdirpSync(path.dirname(f.abs));
      const fd = fs.openSync(f.abs, 'wx');
      created.push(f.abs); // we own this file from the successful open
      try {
        const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
        let written = 0;
        while (written < buf.length) {
          const n = fs.writeSync(fd, buf, written, buf.length - written);
          if (n <= 0) {
            throw err('WRITE_FAILED',
              `write made no progress on ${f.rel}`);
          }
          written += n;
        }
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (e) {
    for (const p of created) removeIfExists(p);
    throw e;
  }
  return { created: created.length, files: planned.map((f) => f.rel) };
}

export function prepareInit({ projectRoot, configRel, answers }) {
  validateAnswers(answers); // early validation before any plan work
  const cfgRel = assertDestination(configRel || DEFAULT_CONFIG_PATH, 'configPath');
  const existing = checkExistingConfig(projectRoot, cfgRel, answers);
  const discovery = inspectProject(projectRoot);

  let config;
  let configContent;
  let discoveryContent;
  if (existing && existing.discovery.fingerprint === discovery.fingerprint) {
    // True no-op re-init: preserve the entire stored config object AND the
    // original config/discovery bytes (whitespace, ordering, custom
    // verification.commands, original evidence). Fresh discovery remains
    // preview/doctor information only.
    config = existing;
    const cfgDir = configDirOf(cfgRel);
    const configAbs = resolveInside(projectRoot, cfgRel, 'config');
    const discoveryAbs = resolveInside(projectRoot,
      cfgDir === '.' ? 'discovery.json' : `${cfgDir}/discovery.json`);
    configContent = readRegularFile(configAbs);
    discoveryContent = readRegularFile(discoveryAbs);
  } else {
    config = createConfig(projectRoot, answers, discovery);
    // Changed manifests produce new config/discovery bytes; when a config
    // already exists that difference is reported as an explicit conflict.
    discoveryContent = JSON.stringify(discovery, null, 2) + '\n';
  }
  const plan = buildInitPlan({
    projectRoot, configRel: cfgRel, config,
    configContent, discovery, discoveryContent,
  });
  const planned = preflightPlan(projectRoot, plan.files);
  return { ...plan, discovery, files: planned };
}
