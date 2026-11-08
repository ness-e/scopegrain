// Catalog loader: validates catalog/manifest.json and serves model-facing
// resources verbatim. Content is data, never interpreted or executed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { portableKey, resolveInside, toCanonicalRelative } from './paths.mjs';
import { loadLimits } from './policy.mjs';

export const INSTALL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MANIFEST_REL = 'catalog/manifest.json';
const LEGACY_REL = 'catalog/legacy-inventory.json';
const KINDS = new Set([
  'command', 'agent', 'skill', 'rule', 'reference', 'profile',
]);
const DEP_KEYS = ['agents', 'skills', 'rules', 'references'];
const DEP_KIND = {
  agents: 'agent', skills: 'skill', rules: 'rule', references: 'reference',
};
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
// Per-kind required component folder; skills may also live in templates/.
const KIND_PREFIX = {
  command: ['commands/'], agent: ['agents/'],
  skill: ['skills/', 'templates/skills/'], rule: ['rules/'],
  reference: ['references/'], profile: ['profiles/'],
};
const ENTRY_KEYS = new Set([
  'kind', 'id', 'path', 'description', 'modes', ...DEP_KEYS,
]);
const PROFILE_KEYS = new Set([
  'schemaVersion', 'id', 'description', 'skills', 'rules', 'references',
  'activation', 'externalServices',
]);
const PROFILE_LIST_KEYS = ['skills', 'rules', 'references'];
export const PROFILE_DEP_KIND = {
  skills: 'skill', rules: 'rule', references: 'reference',
};

function limitedDoc(abs, label) {
  const st = lstatOrNull(abs);
  if (!st) throw err('CATALOG_MISSING_FILE', `${label} missing: ${abs}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('CATALOG_INVALID_FILE', `${label} is a link or non-file`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('CATALOG_INVALID_FILE', `${label} exceeds document limit`);
  }
  return limited.content;
}

function readEntryContent(root, rel) {
  // resolveInside rejects symlink ancestors inside the install root.
  const abs = resolveInside(root, rel, `catalog resource ${rel}`);
  return limitedDoc(abs, 'catalog resource');
}

// Shared authored profile shape validation (exact keys, string lists,
// activation string, externalServices string array, id match).
export function validateProfile(id, content) {
  let p;
  try {
    p = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : content);
  } catch {
    throw err('PROFILE_MALFORMED', `profile ${id} is not valid JSON`);
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw err('PROFILE_MALFORMED', `profile ${id} must be an object`);
  }
  for (const k of Object.keys(p)) {
    if (!PROFILE_KEYS.has(k)) {
      throw err('PROFILE_MALFORMED', `profile ${id} has unknown key '${k}'`);
    }
  }
  if (p.schemaVersion !== 1 || p.id !== id
      || typeof p.description !== 'string' || p.description === '') {
    throw err('PROFILE_MALFORMED', `profile ${id} has invalid header fields`);
  }
  for (const lk of PROFILE_LIST_KEYS) {
    if (!Array.isArray(p[lk])
        || !p[lk].every((x) => typeof x === 'string')) {
      throw err('PROFILE_MALFORMED', `profile ${id}.${lk} must be a string array`);
    }
    const dup = p[lk].find((x, i) => p[lk].indexOf(x) !== i);
    if (dup !== undefined) {
      throw err('PROFILE_MALFORMED', `profile ${id}.${lk} duplicates '${dup}'`);
    }
  }
  if (typeof p.activation !== 'string' || p.activation === '') {
    throw err('PROFILE_MALFORMED', `profile ${id}.activation must be a string`);
  }
  if (!Array.isArray(p.externalServices)
      || !p.externalServices.every((x) => typeof x === 'string')) {
    throw err('PROFILE_MALFORMED',
      `profile ${id}.externalServices must be a string array`);
  }
  return p;
}

// Strict load+validate. Throws on the first structural problem.
export function loadCatalog({ installRoot = INSTALL_ROOT } = {}) {
  const manifestAbs = resolveInside(installRoot, MANIFEST_REL, 'catalog manifest');
  let manifest;
  try {
    manifest = JSON.parse(limitedDoc(manifestAbs, 'catalog manifest').toString('utf8'));
  } catch (e) {
    if (e && e.code === 'CATALOG_MISSING_FILE') {
      throw err('CATALOG_NOT_FOUND', 'catalog/manifest.json not found');
    }
    if (e instanceof SyntaxError) {
      throw err('CATALOG_MALFORMED', 'catalog/manifest.json is not valid JSON');
    }
    throw e;
  }
  if (manifest === null || typeof manifest !== 'object'
      || Array.isArray(manifest)) {
    throw err('CATALOG_MALFORMED', 'manifest must be an object');
  }
  for (const k of Object.keys(manifest)) {
    if (!['schemaVersion', 'entries'].includes(k)) {
      throw err('CATALOG_MALFORMED', `manifest has unknown key '${k}'`);
    }
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)
      || manifest.entries.length === 0) {
    throw err('CATALOG_MALFORMED', 'manifest requires schemaVersion 1 and entries');
  }

  const byKey = new Map();
  const byDest = new Map();
  const byProj = new Map();
  const entries = manifest.entries.map((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw err('CATALOG_MALFORMED', `entries[${i}] is not an object`);
    }
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.has(key)) {
        throw err('CATALOG_MALFORMED', `entries[${i}] has unknown key '${key}'`);
      }
    }
    if (!KINDS.has(e.kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${e.kind}'`);
    }
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) {
      throw err('CATALOG_MALFORMED', `entries[${i}] has invalid id`);
    }
    if (typeof e.description !== 'string' || e.description.trim() === '') {
      throw err('CATALOG_MALFORMED', `${e.kind}/${e.id} needs a description`);
    }
    const rel = toCanonicalRelative(e.path, `${e.kind}/${e.id}.path`);
    if (!KIND_PREFIX[e.kind].some((p) => rel.startsWith(p))) {
      throw err('CATALOG_INVALID_FILE',
        `${e.kind}/${e.id} is outside its component folder: ${rel}`);
    }
    const key = `${e.kind}/${e.id}`.toLowerCase();
    if (byKey.has(key)) {
      throw err('CATALOG_DUPLICATE', `duplicate ${key} (case-insensitive)`);
    }
    const canon = { ...e, path: rel };
    byKey.set(key, canon);
    const dest = portableKey(rel);
    if (byDest.has(dest)) {
      throw err('CATALOG_DUPLICATE', `duplicate catalog path ${rel}`);
    }
    byDest.set(dest, canon);
    // Post-mapping destination collisions are also detected at load so
    // checkCatalog (not only catalogFiles) catches them.
    const proj = portableKey(catalogDestRel(canon));
    if (byProj.has(proj) && byProj.get(proj) !== `${e.kind}/${e.id}`) {
      throw err('CATALOG_DUPLICATE',
        `projected destination collision: ${catalogDestRel(canon)}`);
    }
    byProj.set(proj, `${e.kind}/${e.id}`);
    for (const dk of DEP_KEYS) {
      if (e[dk] !== undefined && (!Array.isArray(e[dk])
          || !e[dk].every((x) => typeof x === 'string'))) {
        throw err('CATALOG_MALFORMED', `${e.kind}/${e.id}.${dk} must be a string array`);
      }
    }
    if (e.kind === 'command') {
      if (!Array.isArray(e.modes) || e.modes.length === 0
          || !e.modes.every((m) => typeof m === 'string' && m.trim() !== '')
          || new Set(e.modes).size !== e.modes.length) {
        throw err('CATALOG_MALFORMED',
          `command/${e.id} requires unique non-empty modes`);
      }
    }
    readEntryContent(installRoot, rel); // existence/link check eagerly
    return canon;
  });

  // Dependency references must resolve to existing entries of the right kind.
  for (const e of entries) {
    for (const dk of DEP_KEYS) {
      for (const dep of e[dk] || []) {
        if (!byKey.has(`${DEP_KIND[dk]}/${dep}`.toLowerCase())) {
          throw err('CATALOG_MISSING_DEP',
            `${e.kind}/${e.id} references unknown ${DEP_KIND[dk]} '${dep}'`);
        }
      }
    }
  }
  // Profile entries are validated eagerly: exact shape + dependency ids.
  for (const e of entries) {
    if (e.kind !== 'profile') continue;
    const profile = validateProfile(
      e.id, readEntryContent(installRoot, e.path));
    for (const lk of PROFILE_LIST_KEYS) {
      for (const dep of profile[lk]) {
        if (!byKey.has(`${PROFILE_DEP_KIND[lk]}/${dep}`.toLowerCase())) {
          throw err('CATALOG_MISSING_DEP',
            `profile/${e.id} references unknown ${PROFILE_DEP_KIND[lk]} '${dep}'`);
        }
      }
    }
  }
  return { installRoot, entries, byKey };
}

export function getResource(kind, id, opts = {}) {
  const catalog = opts.catalog || loadCatalog(opts);
  if (!KINDS.has(kind)) {
    throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${kind}'`);
  }
  const e = catalog.byKey.get(`${kind}/${id}`.toLowerCase());
  if (!e) {
    throw err('CATALOG_UNKNOWN_ID', `unknown ${kind} '${id}'`);
  }
  return { ...e, content: readEntryContent(catalog.installRoot, e.path) };
}

// Collect-mode validation used by CLI/doctor; never throws on issues.
export function checkCatalog(opts = {}) {
  try {
    const catalog = loadCatalog(opts);
    return { ok: true, issues: [], entries: catalog.entries.length };
  } catch (e) {
    return {
      ok: false,
      issues: [{ code: e.code || 'INTERNAL', message: e.message }],
      entries: 0,
    };
  }
}

// Projected destination of a catalog entry underneath the config directory:
// skill sources under templates/ map to skills/<id>/SKILL.md; all other
// entries keep their component-relative path.
export function catalogDestRel(e) {
  return e.path.startsWith('templates/skills/')
    ? `skills/${e.id}/SKILL.md`
    : e.path;
}

// Copy set for bootstrap: resources projected under the selected config
// directory plus a PROJECTED manifest (catalog.json) whose entry paths are
// the generated destinations. Destination collisions after mapping are
// detected as duplicates.
export function catalogFiles({ installRoot = INSTALL_ROOT } = {}) {
  const catalog = loadCatalog({ installRoot });
  const files = [];
  const seenDest = new Map();
  const projectedEntries = [];
  for (const e of catalog.entries) {
    const rel = catalogDestRel(e);
    const key = portableKey(rel);
    if (seenDest.has(key)) {
      throw err('CATALOG_DUPLICATE',
        `projected destination collision: ${rel} (entries '${seenDest.get(key)}' and '${e.id}')`);
    }
    seenDest.set(key, e.id);
    files.push({
      rel, content: readEntryContent(catalog.installRoot, e.path),
    });
    projectedEntries.push({ ...e, path: rel });
  }
  files.push({
    rel: 'catalog.json',
    content: JSON.stringify(
      { schemaVersion: 1, entries: projectedEntries }, null, 2) + '\n',
  });
  return files;
}

// --- Frozen provenance ledger (metadata only) ---
// catalog/legacy-inventory.json is authored frozen data: counts, hashes and
// review indicators. Bodies are never read or served; originalActivation is
// 'blocked' for every entry.

export function loadLegacyInventory({ installRoot = INSTALL_ROOT } = {}) {
  const abs = resolveInside(installRoot, LEGACY_REL, 'legacy inventory');
  let data;
  try {
    data = JSON.parse(limitedDoc(abs, 'legacy inventory').toString('utf8'));
  } catch (e) {
    if (e && e.code === 'CATALOG_MISSING_FILE') {
      throw err('LEGACY_NOT_FOUND', 'catalog/legacy-inventory.json not found');
    }
    if (e instanceof SyntaxError) {
      throw err('LEGACY_MALFORMED', 'legacy inventory is not valid JSON');
    }
    throw e;
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.entries)) {
    throw err('LEGACY_MALFORMED', 'legacy inventory requires an entries array');
  }
  return data;
}

export function legacyList({ kind } = {}, opts = {}) {
  const data = loadLegacyInventory(opts);
  if (kind !== undefined) {
    if (typeof kind !== 'string' || kind === '') {
      throw err('CATALOG_UNKNOWN_KIND', `unknown legacy kind '${kind}'`);
    }
    if (!data.entries.some((e) => e.kind === kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown legacy kind '${kind}'`);
    }
  }
  const entries = kind
    ? data.entries.filter((e) => e.kind === kind) : data.entries;
  // Active catalog is loaded ONCE per public call; its absence produces an
  // explicit warning and captured replacements, never a silent current path.
  const active = activeCatalogOnce(opts);
  const cls = loadClassification(opts);
  return {
    schemaVersion: data.schemaVersion,
    claim: data.claim ?? null,
    sourceBodiesIncluded: data.sourceBodiesIncluded ?? null,
    counts: data.counts ?? {},
    warnings: active.warning ? [active.warning] : [],
    entries: entries.map((e) => decorateLegacy(e, active.catalog, cls)),
  };
}

function activeCatalogOnce(opts) {
  try {
    return { catalog: opts.catalog || loadCatalog(opts), warning: null };
  } catch (e) {
    return {
      catalog: null,
      warning: `active catalog unavailable (${e.code || 'INTERNAL'}): `
        + 'currentReplacement falls back to captured metadata',
    };
  }
}

// Frozen identifier triage: catalog/legacy-classification.json entries carry
// {id,category,family,basis,reviewRequired,...} (no kind). Joined ONLY for
// legacy kind 'skill' by id. Missing file is optional; malformed or
// oversized content is a structured error, never swallowed.
const CLASSIFICATION_REL = 'catalog/legacy-classification.json';
function loadClassification(opts = {}) {
  const abs = resolveInside(
    opts.installRoot || INSTALL_ROOT, CLASSIFICATION_REL, 'classification');
  const st = lstatOrNull(abs);
  if (!st) return new Map();
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('LEGACY_MALFORMED', 'classification file is not a regular file');
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('LEGACY_MALFORMED', 'classification exceeds document limit');
  }
  let data;
  try {
    data = JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('LEGACY_MALFORMED', 'classification is not valid JSON');
  }
  if (data === null || typeof data !== 'object'
      || !Array.isArray(data.entries)) {
    throw err('LEGACY_MALFORMED', 'classification requires an entries array');
  }
  const byId = new Map();
  for (const e of data.entries) {
    if (e && typeof e.id === 'string') byId.set(e.id, e);
  }
  return byId;
}

function decorateLegacy(e, activeCatalog, clsById) {
  let currentReplacement = e.replacement ?? null;
  if (activeCatalog) {
    const active = activeCatalog.byKey.get(`${e.kind}/${e.id}`.toLowerCase());
    if (active) currentReplacement = catalogDestRel(active);
  }
  const out = {
    ...e, originalActivation: 'blocked', currentReplacement,
  };
  if (e.kind === 'skill' && clsById) {
    const c = clsById.get(e.id);
    if (c) {
      for (const k of ['category', 'family', 'basis', 'reviewRequired']) {
        if (c[k] !== undefined) out[k] = c[k];
      }
    }
  }
  return out;
}

export function legacyGet(kind, id, opts = {}) {
  const data = loadLegacyInventory(opts);
  const e = data.entries.find((x) => x.kind === kind && x.id === id);
  if (!e) {
    throw err('CATALOG_UNKNOWN_ID', `unknown legacy ${kind} '${id}'`);
  }
  const active = activeCatalogOnce(opts);
  const cls = loadClassification(opts);
  const out = decorateLegacy(e, active.catalog, cls);
  if (active.warning) out.warnings = [active.warning];
  return out;
}
