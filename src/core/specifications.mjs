// Structured specification and design documents. V2 artifacts carry typed
// `data`; the stored body is the deterministic renderer materialization of
// that data, so digest coherence is checkable on every read.
import { err } from './errors.mjs';
import { resolveInside } from './paths.mjs';
import { canonicalDigest } from './digests.mjs';
import {
  validateDesignData, validateSpecificationData,
} from './specification-data.mjs';
import {
  getArtifact, prepareArtifact, renderSpecification,
} from './artifacts.mjs';

const SPEC_INPUT_KEYS = new Set([
  'originalRequest', 'title', 'outcome', 'requirements', 'scope',
  'constraints', 'nonGoals', 'openQuestions', 'references',
]);
const DESIGN_INPUT_KEYS = new Set([
  'specId', 'title', 'body', 'references',
]);

export function prepareSpecification(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARTIFACT', 'specification input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!SPEC_INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `specification input has unknown key '${k}'`);
    }
  }
  if (typeof input.originalRequest !== 'string'
      || input.originalRequest.trim() === '') {
    throw err('INVALID_ARTIFACT',
      'specification input requires originalRequest verbatim');
  }
  const data = validateSpecificationData({
    schemaVersion: 1,
    originalRequest: input.originalRequest,
    outcome: input.outcome,
    requirements: input.requirements,
    scope: input.scope,
    constraints: input.constraints,
    nonGoals: input.nonGoals,
    openQuestions: input.openQuestions,
  }, 'specification input');
  // Prepare-time containment: scope paths must resolve inside the project
  // (rejects junction/link escapes the lexical check cannot see).
  for (const s of data.scope) {
    resolveInside(ctx.projectRoot, s, 'specification scope');
  }
  // Stored body is EXACTLY the renderer output — never re-summarized.
  const body = renderSpecification(
    typeof input.title === 'string' ? input.title : '', data);
  return prepareArtifact(ctx, 'spec', {
    title: input.title, body, references: input.references,
  }, { data });
}

// V2 spec read: returns the validated artifact — callers read spec.data
// and canonicalDigest(spec) for bindings.
export function getSpecification(ctx, id) {
  const a = getArtifact(ctx, 'spec', id);
  if (a.data === undefined) {
    throw err('SPEC_STRUCTURED_REQUIRED',
      `spec ${id} is not a structured V2 artifact`);
  }
  return a;
}

export function prepareDesign(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARTIFACT', 'design input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!DESIGN_INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `design input has unknown key '${k}'`);
    }
  }
  const spec = getSpecification(ctx, input.specId);
  const data = validateDesignData({
    specId: input.specId,
    specDigest: canonicalDigest(spec),
  }, 'design input');
  return prepareArtifact(ctx, 'design', {
    title: input.title, body: input.body, references: input.references,
  }, { data });
}
