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
import { canonicalDigest } from './digests.mjs';
import {
  validateDesignData, validateSpecificationData,
} from './specification-data.mjs';
import { validateOutcomeData } from './outcome-data.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTIFACT_INPUT_KEYS = new Set(['title', 'body', 'references']);
const ARTIFACT_KEYS = new Set([
  'schemaVersion', 'id', 'kind', 'title', 'body', 'references', 'createdAt',
  'data',
]);
// Kinds that may carry typed V2 data. design is V2-only (no legacy mode).
const V2_KINDS = new Set(['spec', 'design', 'report']);

// Graceful template load: a missing/malformed authored renderer degrades
// to a TaskError at use time, never an import-time crash.
let renderFn = null;
let renderError = null;
try {
  ({ renderSpecification: renderFn } = await import(
    '../../templates/render-specification.mjs'));
  if (typeof renderFn !== 'function') {
    throw new Error('renderSpecification is not a function');
  }
} catch (e) {
  renderError = e;
}

export function renderSpecification(title, data) {
  if (renderError) {
    throw err('ARTIFACT_MALFORMED',
      `specification renderer unavailable: ${renderError.message}`);
  }
  return renderFn(title, data);
}

// Kind -> destination under configured paths. reviews nest inside reports
// per policy/onboarding-defaults.json (reviewSubdirectory). A Map lookup
// keeps inherited object properties out of the kind set.
export function artifactDirRel(ctx, kind) {
  const p = ctx.config.paths;
  const dirs = new Map([
    ['spec', `${p.plans}/specs`],
    ['design', `${p.plans}/designs`],
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
// The fourth {data} argument is internal to typed factories (specification
// /design/report V2); the generic public input stays closed at three keys.
export function prepareArtifact(ctx, kind, input, { data } = {}) {
  const dirRel = artifactDirRel(ctx, kind);
  if (kind === 'design' && data === undefined) {
    throw err('INVALID_ARTIFACT',
      'design artifacts require structured V2 data; no legacy form exists');
  }
  if (data !== undefined && !V2_KINDS.has(kind)) {
    throw err('INVALID_ARTIFACT',
      `artifact kind '${kind}' does not accept typed data`);
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARTIFACT', 'artifact input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!ARTIFACT_INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `artifact input has unknown key '${k}'`);
    }
  }
  const artifact = {
    schemaVersion: data === undefined ? 1 : 2,
    id: crypto.randomUUID(),
    kind,
    title: requireNonEmpty(input.title, 'title'),
    body: requireNonEmpty(input.body, 'body'),
    references: validateReferences(ctx, input.references),
    createdAt: new Date().toISOString(),
  };
  if (data !== undefined) artifact.data = data;
  // Validate the constructed record BEFORE serialization: malformed typed
  // data, bad scope/links or binding drift never reach a file plan.
  validateArtifactShape(artifact, kind, 'prepared artifact');
  validateStoredReferences(ctx, artifact, 'prepared artifact');
  validateArtifactBindings(ctx, artifact, 'prepared artifact');
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
  if (typeof a.id !== 'string' || !UUID_RE.test(a.id)
      || a.kind !== kind
      || typeof a.title !== 'string' || a.title.trim() === ''
      || typeof a.body !== 'string' || a.body.trim() === ''
      || !Array.isArray(a.references)
      || !a.references.every((r) => typeof r === 'string')
      || !isCanonicalTime(a.createdAt)) {
    throw err('ARTIFACT_MALFORMED', `${label} has invalid fields`);
  }
  // Version/data coherence is structural, not a warning: V1 forbids data,
  // V2 requires typed data on spec/design/report only.
  if (a.schemaVersion === 1) {
    if (a.data !== undefined) {
      throw err('ARTIFACT_MALFORMED',
        `${label}: schemaVersion 1 may not carry typed data`);
    }
    if (kind === 'design') {
      throw err('ARTIFACT_MALFORMED',
        `${label}: design has no legacy V1 form`);
    }
  } else if (a.schemaVersion === 2) {
    if (!V2_KINDS.has(kind)) {
      throw err('ARTIFACT_MALFORMED',
        `${label}: kind '${kind}' may not be schemaVersion 2`);
    }
    if (a.data === undefined) {
      throw err('ARTIFACT_MALFORMED',
        `${label}: schemaVersion 2 requires typed data`);
    }
    validateArtifactData(a, label);
  } else {
    throw err('ARTIFACT_MALFORMED',
      `${label}: schemaVersion must be 1 or 2, got ${a.schemaVersion}`);
  }
  return a;
}

// Typed payload per kind, plus renderer coherence for specifications: the
// stored body must equal the deterministic materialization of data.
function validateArtifactData(a, label) {
  if (a.kind === 'spec') {
    const data = validateSpecificationData(a.data, `${label}.data`,
      { stored: true });
    if (a.body !== renderSpecification(a.title, data)) {
      throw err('ARTIFACT_MALFORMED',
        `${label}.body does not match the rendered specification data`);
    }
    a.data = data;
  } else if (a.kind === 'design') {
    a.data = validateDesignData(a.data, `${label}.data`);
  } else if (a.kind === 'report') {
    a.data = validateOutcomeData(a.data, `${label}.data`);
  }
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
  // V2 spec data.scope is containment-checked on read as well as prepare —
  // a junction swapped in after prepare cannot smuggle outside paths.
  if (a.kind === 'spec' && a.data !== undefined) {
    for (const s of a.data.scope) {
      resolveInside(ctx.projectRoot, s, `${label}.data.scope`);
    }
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
  validateArtifactBindings(ctx, a, `artifact ${id}`);
  return a;
}

// Design V2 foreign-key check, shared by prepare (pre-serialization) and
// get: the referenced spec must be a real V2 structured artifact AND hash
// to the recorded digest — one bounded hop, no cycle.
function validateArtifactBindings(ctx, a, label) {
  if (a.kind !== 'design' || a.data === undefined) return;
  const spec = getArtifact(ctx, 'spec', a.data.specId);
  if (spec.schemaVersion !== 2 || spec.data === undefined) {
    throw err('SPEC_STRUCTURED_REQUIRED',
      `${label} requires a structured V2 spec, got ${a.data.specId}`);
  }
  if (canonicalDigest(spec) !== a.data.specDigest) {
    throw err('ARTIFACT_DRIFT',
      `${label} specDigest no longer matches spec ${a.data.specId}`);
  }
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
