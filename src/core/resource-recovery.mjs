// Resource recovery: read-only diagnosis plus a guarded restore flow that
// only ever sources bytes from THIS installation at the SHA the project
// snapshot expects. Never downloads, never uses legacy/global fallbacks.
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { loadLimits } from './policy.mjs';
import {
  catalogDestRel, getResource, loadCatalog, loadWorkspaceCatalog,
  resolveCatalogEntry,
} from './catalog.mjs';
import { applyPlan, preflightPlan } from './bootstrap.mjs';

const SHA = /^[0-9a-f]{64}$/i;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const VALID_KIND = /^(command|agent|skill|rule|reference|profile|prompt|mcp)$/;

const FIND_KEYS = new Set(['kind', 'query']);
const DIAG_KEYS = new Set(['kind', 'id']);
const RESTORE_KEYS = new Set(['kind', 'id', 'expectedCurrentHash']);

function requireClosed(v, keys, label) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw err('INVALID_ARGS', `${label} must be an object`);
  }
  for (const k of Object.keys(v)) {
    if (!keys.has(k)) {
      throw err('INVALID_ARGS', `unknown ${label} key '${k}'`);
    }
  }
}

function requireKindId({ kind, id }) {
  if (typeof kind !== 'string' || !VALID_KIND.test(kind)) {
    throw err('INVALID_ARGS', `invalid resource kind '${kind}'`);
  }
  if (typeof id !== 'string' || id === '') {
    throw err('INVALID_ARGS', 'id must be a non-empty string');
  }
}

function configDirAbs(ctx) {
  return ctx.configDir === '.'
    ? ctx.projectRoot
    : resolveInside(ctx.projectRoot, ctx.configDir, 'config directory');
}

// Bounded read resolved through the project root: catches junctions even
// when the configDir itself was swapped after load.
function readProjectFile(ctx, rel) {
  const abs = resolveInside(ctx.projectRoot,
    `${ctx.configDir === '.' ? '' : `${ctx.configDir}/`}${rel}`,
    `resource ${rel}`);
  return readFileLimited(abs, loadLimits().maxDocumentBytes);
}

function resolveEntry(catalog, kind, id) {
  const { entry } = resolveCatalogEntry(catalog, kind, id);
  if (!entry) {
    throw err('CATALOG_UNKNOWN_ID', `unknown ${kind} '${id}'`);
  }
  return entry;
}

export function findResources(ctx, input = {}) {
  requireClosed(input, FIND_KEYS, 'search input');
  const { kind, query } = input;
  if (kind !== undefined
      && (typeof kind !== 'string' || !VALID_KIND.test(kind))) {
    throw err('INVALID_ARGS', `invalid resource kind '${kind}'`);
  }
  if (query !== undefined && typeof query !== 'string') {
    throw err('INVALID_ARGS', 'query must be a string');
  }
  // Metadata-only so search works even when a body is missing.
  const catalog = loadWorkspaceCatalog(ctx, { verifyResources: false });
  const q = query?.toLowerCase() ?? null;
  return {
    entries: catalog.entries
      .filter((e) => (kind === undefined || e.kind === kind)
        && (q === null || e.id.toLowerCase().includes(q)
          || e.description.toLowerCase().includes(q)))
      .map((e) => ({
        kind: e.kind, id: e.id, path: catalogDestRel(e),
        description: e.description,
      })),
    integrity: catalog.integrity, warnings: catalog.warnings,
  };
}

// Presence/form first; only a regular file gets a hash comparison.
export function diagnoseResource(ctx, input) {
  requireClosed(input, DIAG_KEYS, 'diagnose input');
  requireKindId(input);
  const { kind, id } = input;
  const catalog = loadWorkspaceCatalog(ctx, { verifyResources: false });
  const e = resolveEntry(catalog, kind, id);
  const rel = catalogDestRel(e);
  const abs = path.join(configDirAbs(ctx), rel);
  const st = lstatOrNull(abs);
  const base = {
    kind, id, requestedId: id, canonicalId: e.id,
    path: rel, integrity: catalog.integrity,
    warnings: catalog.warnings,
    transport: 'not-probed',
    requiresSeparateActivation: true,
  };
  if (!st) return { ...base, status: 'missing' };
  if (!st.isFile() || st.isSymbolicLink()) {
    return { ...base, status: 'invalid-form' };
  }
  if (catalog.snapshotVersion === 1) {
    return { ...base, status: 'legacy-unpinned' };
  }
  let limited;
  try {
    limited = readProjectFile(ctx, rel);
  } catch (e) {
    return { ...base, status: 'unreadable', error: e.code ?? 'READ_FAILED' };
  }
  if (limited.exceeded) return { ...base, status: 'oversized' };
  const actual = sha(limited.content);
  if (actual !== e.sha256.toLowerCase()) {
    return { ...base, status: 'drift', actualSha256: actual };
  }
  return { ...base, status: 'healthy', actualSha256: actual };
}

// Dry-run plan only. Origin is always this installation's canonical entry
// — and only when its bytes hash exactly to the snapshot expectation.
export function prepareResourceRestore(ctx, input, { installRoot } = {}) {
  requireClosed(input, RESTORE_KEYS, 'restore input');
  requireKindId(input);
  const { kind, id, expectedCurrentHash } = input;
  if (expectedCurrentHash !== null
      && (typeof expectedCurrentHash !== 'string'
        || !SHA.test(expectedCurrentHash))) {
    throw err('INVALID_ARGS',
      'expectedCurrentHash must be null or a sha256 hex string');
  }
  const catalog = loadWorkspaceCatalog(ctx, { verifyResources: false });
  const e = resolveEntry(catalog, kind, id);
  if (catalog.snapshotVersion !== 2 || !e.sha256) {
    throw err('RESOURCE_UNPINNED',
      `${kind}/${id} is a legacy-unpinned snapshot entry; explicit migration required`);
  }
  const rel = catalogDestRel(e);
  const abs = path.join(configDirAbs(ctx), rel);
  const st = lstatOrNull(abs);
  if (st && (!st.isFile() || st.isSymbolicLink())) {
    throw err('RESOURCE_RESTORE_CONFLICT',
      `${rel} exists as link or non-file; manual reconciliation required`);
  }
  if (st && expectedCurrentHash === null) {
    throw err('RESOURCE_RESTORE_CONFLICT',
      `${rel} exists but expectedCurrentHash is null; refusing overwrite`);
  }
  if (!st && expectedCurrentHash !== null) {
    throw err('RESOURCE_RESTORE_CONFLICT',
      'expectedCurrentHash given but target is absent');
  }
  if (st) {
    const limited = readProjectFile(ctx, rel);
    const actual = limited.exceeded ? null : sha(limited.content);
    if (actual === null || actual !== expectedCurrentHash.toLowerCase()) {
      throw err('RESOURCE_RESTORE_CONFLICT',
        'target content differs from expectedCurrentHash; refusing overwrite');
    }
    if (actual === e.sha256.toLowerCase()) {
      return { action: 'noop', kind, id, path: rel };
    }
    // File exists, matches the caller's CAS, but differs from the pinned
    // SHA: overwriting it is a divergence — conflict at prepare.
    throw err('RESOURCE_RESTORE_CONFLICT',
      `${rel} diverges from the pinned snapshot hash; manual reconciliation required`);
  }
  // Source: this installation's canonical entry, and ONLY if it hashes to
  // exactly what the snapshot expects. Metadata-only install catalog so a
  // missing unrelated body cannot block the restore.
  const install = loadCatalog({ installRoot, verifyResources: false });
  const { entry: src } = resolveCatalogEntry(install, kind, e.id);
  if (!src) {
    throw err('RESOURCE_VERSION_UNAVAILABLE',
      `no installed ${kind}/${id} to source the restore`);
  }
  let body;
  try {
    body = getResource(src.kind, src.id, { catalog: install });
  } catch {
    throw err('RESOURCE_VERSION_UNAVAILABLE',
      `installed ${kind}/${id} body is missing`);
  }
  if (sha(body.content) !== e.sha256.toLowerCase()) {
    throw err('RESOURCE_VERSION_UNAVAILABLE',
      `installed ${kind}/${id} does not match the snapshot-pinned SHA256`);
  }
  return {
    action: 'create', kind, id, path: rel,
    files: [{ rel: path.relative(ctx.projectRoot, abs)
      .replace(/\\/g, '/'), content: body.content }],
  };
}

export function applyResourceRestore(ctx, input) {
  const plan = prepareResourceRestore(ctx, input); // revalidate under apply
  if (plan.action === 'noop') return plan;
  const planned = preflightPlan(ctx.projectRoot, plan.files);
  applyPlan(ctx.projectRoot, planned);
  return { action: 'created', kind: plan.kind, id: plan.id, path: plan.path };
}
