// Configuration contract: validation, creation and loading.
// The canonical workflow policy lives in policy/workflow.json; this module
// only models .tasksystem/config.json and init answers.
import { err } from './errors.mjs';
import { lstatOrNull, readJsonFile } from './fsx.mjs';
import {
  assertDestination,
  assertDistinctPaths,
  isSameOrAncestor,
  resolveInside,
} from './paths.mjs';

import { loadLimits, loadOnboardingDefaults } from './policy.mjs';

export const KNOWN_HOSTS = ['claude', 'codex', 'opencode', 'devin'];
export const LOCALES = ['es', 'en'];
export const PATH_KEYS = [
  'plans', 'tasks', 'reports', 'research', 'decisions', 'memory', 'state',
];

// Versioning categories: the seven artifact paths plus nested reviews.
export const VERSIONING_KEYS = [
  'plans', 'tasks', 'reports', 'reviews', 'research', 'decisions',
  'memory', 'state',
];
export const DEFAULT_CONFIG_PATH = '.tasksystem/config.json';

// Proposal defaults come verbatim from policy/onboarding-defaults.json;
// never accepted implicitly: every category is asked and stored explicitly.
export function defaultPathProposals() {
  return { ...loadOnboardingDefaults().paths };
}
export const DEFAULT_PATH_PROPOSALS = defaultPathProposals();

export function allFalseVersioning() {
  const v = {};
  for (const k of VERSIONING_KEYS) v[k] = false;
  return v;
}

// versioning is OPTIONAL (old answers/configs). Absent -> all false.
// When present, all eight keys are required and must be booleans.
export function validateVersioning(value, label = 'versioning') {
  if (value === undefined) return allFalseVersioning();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw err('INVALID_VALUE', `${label} must be an object`);
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (!VERSIONING_KEYS.includes(key)) {
      throw err('UNKNOWN_KEY', `${label} contains unknown key '${key}'`);
    }
  }
  for (const key of VERSIONING_KEYS) {
    if (!(key in value)) {
      throw err('INVALID_VALUE', `${label} is missing required key '${key}'`);
    }
    if (typeof value[key] !== 'boolean') {
      throw err('INVALID_VALUE', `${label}.${key} must be boolean`);
    }
    out[key] = value[key];
  }
  return out;
}

const ANSWER_KEYS = new Set(['name', 'locale', 'hosts', 'paths', 'versioning']);
const CONFIG_KEYS = new Set([
  'schemaVersion', 'project', 'locale', 'hosts', 'paths', 'verification',
  'discovery', 'versioning',
]);

function rejectUnknownKeys(obj, allowed, label) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw err('INVALID_ANSWERS', `${label} must be an object`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw err('UNKNOWN_KEY', `${label} contains unknown key '${key}'`);
    }
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw err('INVALID_VALUE', `${label} must be a non-empty string`);
  }
  return value;
}

export function validateHosts(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw err('INVALID_HOSTS', 'hosts must be a non-empty array');
  }
  const seen = new Set();
  for (const h of hosts) {
    if (!KNOWN_HOSTS.includes(h)) {
      throw err('UNKNOWN_HOST', `unknown host '${h}'; known: ${KNOWN_HOSTS.join(', ')}`);
    }
    if (seen.has(h)) throw err('INVALID_HOSTS', `duplicate host '${h}'`);
    seen.add(h);
  }
  return [...hosts];
}

export function validateLocale(locale) {
  if (!LOCALES.includes(locale)) {
    throw err('INVALID_LOCALE', `locale must be one of: ${LOCALES.join(', ')}`);
  }
  return locale;
}

export function validateArtifactPaths(paths) {
  rejectUnknownKeys(paths, new Set(PATH_KEYS), 'paths');
  const out = {};
  const entries = [];
  for (const key of PATH_KEYS) {
    if (!(key in paths)) {
      throw err('INVALID_PATHS', `paths is missing required key '${key}'`);
    }
    out[key] = assertDestination(paths[key], `paths.${key}`);
    entries.push([key, out[key]]);
  }
  assertDistinctPaths(entries);
  return out;
}

// answers: {name, locale, hosts, paths{7}} — strict, mirrors
// schemas/answers.schema.json plus runtime path checks.
export function validateAnswers(answers) {
  rejectUnknownKeys(answers, ANSWER_KEYS, 'answers');
  for (const key of ANSWER_KEYS) {
    if (key === 'versioning') continue; // optional field
    if (!(key in answers)) {
      throw err('INVALID_ANSWERS', `answers is missing required key '${key}'`);
    }
  }
  return {
    name: requireNonEmptyString(answers.name, 'answers.name'),
    locale: validateLocale(answers.locale),
    hosts: validateHosts(answers.hosts),
    paths: validateArtifactPaths(answers.paths),
    versioning: validateVersioning(answers.versioning, 'answers.versioning'),
  };
}

// Deterministic generated-file destinations for a config location.
// Used both to plan writes and to forbid artifact/config collisions.
export function generatedFilePaths(configRel, hosts) {
  const dir = configRel.includes('/')
    ? configRel.slice(0, configRel.lastIndexOf('/'))
    : '.';
  const prefix = dir === '.' ? '' : dir + '/';
  const files = [
    configRel,
    prefix + 'instructions.md',
    prefix + 'discovery.json',
    prefix + 'task-contract.md',
    prefix + 'catalog.json',
    prefix + '.gitignore',
    prefix + 'integrations/gitignore-proposal.txt',
  ];
  if (hosts.some((h) => h === 'codex' || h === 'opencode' || h === 'devin')) {
    files.push('AGENTS.md');
  }
  if (hosts.includes('claude')) {
    files.push('CLAUDE.md');
  }
  for (const host of hosts) {
    const ext = host === 'codex' ? 'toml' : 'json';
    files.push(`${prefix}integrations/${host}-mcp.${ext}`);
    if (host === 'opencode') {
      files.push(`${prefix}integrations/opencode-v1-mcp.json`);
    }
  }
  // Native adapter proposals, projected policy and catalog component
  // trees are generated destinations for collisions.
  files.push(`${prefix}integrations/native`);
  files.push(`${prefix}policy`);
  for (const dir of ['commands', 'agents', 'skills', 'rules', 'references',
    'profiles']) {
    files.push(`${prefix}${dir}`);
  }
  return { configDir: dir, files };
}

// Artifact destinations may not collide with the config file, bootstrap
// files or adapter files in either direction.
export function assertNoCollisions(paths, configRel, hosts) {
  const generated = generatedFilePaths(configRel, hosts).files;
  for (const [key, p] of Object.entries(paths)) {
    for (const g of generated) {
      if (isSameOrAncestor(p, g) || isSameOrAncestor(g, p)) {
        throw err('PATH_COLLISION',
          `paths.${key} (${p}) collides with generated file ${g}`);
      }
    }
  }
}

export function createConfig(projectRoot, answers, discovery) {
  const a = validateAnswers(answers);
  const d = discovery && typeof discovery === 'object' ? discovery : {};
  return {
    schemaVersion: 1,
    project: { name: a.name, root: '.' },
    locale: a.locale,
    hosts: a.hosts,
    paths: a.paths,
    verification: { mode: 'manual', commands: [] },
    versioning: a.versioning,
    discovery: {
      fingerprint: typeof d.fingerprint === 'string' ? d.fingerprint : '',
      stacks: Array.isArray(d.stacks) ? d.stacks : [],
      evidence: Array.isArray(d.evidence) ? d.evidence : [],
    },
  };
}

export function validateConfigObject(config) {
  rejectUnknownKeys(config, CONFIG_KEYS, 'config');
  if (config.schemaVersion !== 1) {
    throw err('CONFIG_VERSION', 'config schemaVersion must be 1');
  }
  rejectUnknownKeys(config.project, new Set(['name', 'root']), 'config.project');
  requireNonEmptyString(config.project.name, 'config.project.name');
  if (config.project.root !== '.') {
    throw err('INVALID_VALUE', 'config.project.root must be "." (relocatable)');
  }
  validateLocale(config.locale);
  validateHosts(config.hosts);
  validateArtifactPaths(config.paths);
  rejectUnknownKeys(
    config.verification, new Set(['mode', 'commands']), 'config.verification');
  if (config.verification.mode !== 'manual') {
    throw err('INVALID_VALUE', 'config.verification.mode must be "manual"');
  }
  if (!Array.isArray(config.verification.commands)) {
    throw err('INVALID_VALUE', 'config.verification.commands must be an array');
  }
  rejectUnknownKeys(
    config.discovery,
    new Set(['fingerprint', 'stacks', 'evidence']),
    'config.discovery');
  if (typeof config.discovery.fingerprint !== 'string'
      || !Array.isArray(config.discovery.stacks)
      || !Array.isArray(config.discovery.evidence)) {
    throw err('INVALID_VALUE', 'config.discovery has invalid field types');
  }
  config.versioning = validateVersioning(
    config.versioning, 'config.versioning');
  return config;
}

// Load and validate without mutating. configPath is project-relative.
export function loadConfig(projectRoot, configPath = DEFAULT_CONFIG_PATH) {
  const configRel = assertDestination(configPath, 'configPath');
  const abs = resolveInside(projectRoot, configRel, 'config');
  const st = lstatOrNull(abs);
  if (!st) throw err('CONFIG_NOT_FOUND', `config not found: ${configRel}`);
  if (st.isSymbolicLink()) {
    throw err('SYMLINK_REJECTED', `config file may not be a symlink: ${configRel}`);
  }
  if (!st.isFile()) {
    throw err('CONFIG_NOT_FILE', `config path is not a file: ${configRel}`);
  }
  const config = validateConfigObject(
    readJsonFile(abs, 'config', loadLimits().maxDocumentBytes));
  assertNoCollisions(config.paths, configRel, config.hosts);
  for (const key of PATH_KEYS) {
    resolveInside(projectRoot, config.paths[key], `paths.${key}`);
  }
  return { config, configPath: configRel };
}

// Answers differ from an existing config: explicit error, never overwrite.
export function assertAnswersMatchConfig(answers, config) {
  const a = validateAnswers(answers);
  const sameHosts = a.hosts.length === config.hosts.length
    && a.hosts.every((h) => config.hosts.includes(h));
  const samePaths = PATH_KEYS.every((k) => a.paths[k] === config.paths[k]);
  const sameVersioning = VERSIONING_KEYS.every(
    (k) => a.versioning[k] === config.versioning[k]);
  if (a.name !== config.project.name || a.locale !== config.locale
      || !sameHosts || !samePaths || !sameVersioning) {
    throw err('INIT_CONFLICT',
      'existing config differs from the supplied answers; reconcile manually');
  }
}

export function configDirOf(configRel) {
  return configRel.includes('/')
    ? configRel.slice(0, configRel.lastIndexOf('/'))
    : '.';
}
