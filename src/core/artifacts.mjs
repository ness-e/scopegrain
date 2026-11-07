// Immutable artifacts: create-only documents (spec, report, research,
// decision, lesson, handoff, review) stored under configured paths.
// prepareArtifact is read-only; applyPlan performs the exclusive write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { assertDestination, resolveInside } from './paths.mjs';
import { loadLimits, loadOnboardingDefaults } from './policy.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_INPUT_KEYS = new Set(['title', 'body', 'references']);
const ARTIFACT_KEYS = new Set([
  'schemaVersion', 'id', 'kind', 'title', 'body', 'references', 'createdAt',
]);

// Kind -> destination under configured paths. reviews nest inside reports
// per policy/onboarding-defaults.json (reviewSubdirectory). A Map lookup
// keeps inherited object properties out of the kind set.
export function artifactDirRel(ctx, kind) {
  const p = ctx.config.paths;
  const dirs = new Map([
    ['spec', `${p.plans}/specs`],
    ['report', p.reports],
    ['research', p.research],
    ['decision', p.decisions],
    ['lesson', `${p.memory}/lessons`],
    ['handoff', `${p.memory}/handoffs`],
    ['review', `${p.reports}/${loadOnboardingDefaults().reviewSubdirectory}`],
  ]);
  const rel = dirs.get(kind);
  if (!rel) {
    throw err('INVALID_KIND',
      `unknown artifact kind '${kind}'; known: ${[...dirs.keys()].join(', ')}`);
  }
  return rel;
}

function requireNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw err('INVALID_VALUE', `${label} must be a non-empty string`);
  }
  return value;
}

function validateReferences(ctx, references) {
  const refs = references === undefined ? [] : references;
  if (!Array.isArray(refs)) {
    throw err('INVALID_VALUE', 'references must be an array of paths');
  }
  return refs.map((r, i) => {
    const rel = assertDestination(r, `references[${i}]`);
    resolveInside(ctx.projectRoot, rel, 'references');
    return rel;
  });
}

// Read-only artifact plan: returns {artifact, file} for exclusive apply.
export function prepareArtifact(ctx, kind, input) {
  const dirRel = artifactDirRel(ctx, kind);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARTIFACT', 'artifact input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!ARTIFACT_INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `artifact input has unknown key '${k}'`);
    }
  }
  const artifact = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind,
    title: requireNonEmpty(input.title, 'title'),
    body: requireNonEmpty(input.body, 'body'),
    references: validateReferences(ctx, input.references),
    createdAt: new Date().toISOString(),
  };
  const rel = `${dirRel}/${artifact.id}.json`;
  const content = JSON.stringify(artifact, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      `artifact would exceed ${loadLimits().maxDocumentBytes} bytes`);
  }
  return {
    artifact,
    file: {
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'artifact file'),
      content,
    },
  };
}

export function validateArtifactShape(a, kind, label = 'artifact') {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) {
    throw err('ARTIFACT_MALFORMED', `${label} is not an object`);
  }
  for (const k of Object.keys(a)) {
    if (!ARTIFACT_KEYS.has(k)) {
      throw err('ARTIFACT_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
  if (a.schemaVersion !== 1 || !UUID_RE.test(a.id || '')
      || a.kind !== kind
      || typeof a.title !== 'string' || a.title.trim() === ''
      || typeof a.body !== 'string' || a.body.trim() === ''
      || !Array.isArray(a.references)
      || !a.references.every((r) => typeof r === 'string')
      || !isCanonicalTime(a.createdAt)) {
    throw err('ARTIFACT_MALFORMED', `${label} has invalid fields`);
  }
  return a;
}

// Canonical timestamp: parses AND round-trips through toISOString.
export function isCanonicalTime(v) {
  if (typeof v !== 'string' || v === '') return false;
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
}

// Stored references must be canonical safe paths contained in the project.
function validateStoredReferences(ctx, a, label) {
  for (const r of a.references) {
    if (assertDestination(r, `${label}.references`) !== r) {
      throw err('ARTIFACT_MALFORMED',
        `${label} reference is not canonical: ${r}`);
    }
    resolveInside(ctx.projectRoot, r, `${label}.references`);
  }
}

function artifactAbs(ctx, kind, id) {
  const rel = `${artifactDirRel(ctx, kind)}/${id}.json`;
  return { rel, abs: resolveInside(ctx.projectRoot, rel, 'artifact') };
}

export function getArtifact(ctx, kind, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw err('INVALID_ID', `artifact id must be a UUID, got: ${String(id)}`);
  }
  const { abs } = artifactAbs(ctx, kind, id.toLowerCase());
  const st = lstatOrNull(abs);
  if (!st) throw err('ARTIFACT_NOT_FOUND', `artifact not found: ${id}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `artifact may not be a link: ${id}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('ARTIFACT_MALFORMED', `artifact ${id} exceeds document limit`);
  }
  let a;
  try {
    a = JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('ARTIFACT_MALFORMED', `artifact ${id} contains malformed JSON`);
  }
  try {
    a = validateArtifactShape(a, kind, `artifact ${id}`);
    validateStoredReferences(ctx, a, `artifact ${id}`);
  } catch (e) {
    if (e && (e.code === 'ARTIFACT_MALFORMED')) throw e;
    throw err('ARTIFACT_MALFORMED', `artifact ${id} failed validation: ${e.message}`);
  }
  if (a.id.toLowerCase() !== id.toLowerCase()) {
    throw err('ARTIFACT_MALFORMED', `artifact id does not match filename`);
  }
  return a;
}

export function listArtifacts(ctx, kind) {
  const dirRel = artifactDirRel(ctx, kind);
  const dir = resolveInside(ctx.projectRoot, dirRel, 'artifact dir');
  const out = { artifacts: [], malformed: [] };
  const st = lstatOrNull(dir);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', `${dirRel} is not a real directory`);
  }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const stem = name.slice(0, -'.json'.length);
    const file = path.join(dir, name);
    const fst = lstatOrNull(file);
    if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
    if (!UUID_RE.test(stem)) {
      out.malformed.push({
        file: name,
        error: { code: 'ARTIFACT_MALFORMED', message: 'filename is not a UUID' },
      });
      continue;
    }
    try {
      out.artifacts.push(getArtifact(ctx, kind, stem));
    } catch (e) {
      out.malformed.push({
        file: name,
        error: { code: e.code || 'INTERNAL', message: e.message },
      });
    }
  }
  return out;
}
