// Pure validators for structured specification V2 data and design V2
// bindings. No storage, no IO beyond canonical path checks — see
// schemas/specification-data.schema.json and design-data.schema.json.
import { err } from './errors.mjs';
import { assertDestination } from './paths.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;

const SPEC_KEYS = new Set([
  'schemaVersion', 'originalRequest', 'outcome', 'requirements', 'scope',
  'constraints', 'nonGoals', 'openQuestions',
]);
const OUTCOME_KEYS = new Set(['statement', 'evidencePlan']);
const REQ_KEYS = new Set(['id', 'statement', 'scenarios']);
const SCEN_KEYS = new Set(['id', 'given', 'when', 'then']);
const DESIGN_KEYS = new Set(['specId', 'specDigest']);

function closed(v, keys, label) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw err('SPEC_DATA_MALFORMED', `${label} must be an object`);
  }
  for (const k of Object.keys(v)) {
    if (!keys.has(k)) {
      throw err('SPEC_DATA_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
}

function text(v, label) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw err('SPEC_DATA_MALFORMED', `${label} must be a non-empty string`);
  }
  return v;
}

function textArray(v, label, { required = false } = {}) {
  if (v === undefined && !required) return [];
  if (!Array.isArray(v)) {
    throw err('SPEC_DATA_MALFORMED', `${label} must be an array of strings`);
  }
  return v.map((s, i) => text(s, `${label}[${i}]`));
}

// Shared requirement/scenario ID syntax — same contract, exported for
// tasks' stored-shape validation (no second regex).
export function validateSpecificationItemId(v, label) {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    throw err('SPEC_DATA_MALFORMED',
      `${label} must match ${ID_RE}`);
  }
  return v;
}

function uniqueIds(items, label) {
  const seen = new Set();
  for (const it of items) {
    const k = it.id.toLowerCase();
    if (seen.has(k)) {
      throw err('SPEC_DATA_MALFORMED',
        `${label} has duplicate id '${it.id}' (case-insensitive)`);
    }
    seen.add(k);
  }
}

// Canonical scope paths. stored=true demands the array be present AND that
// each entry already equals its canonical form — a stored payload may not
// be silently normalized on read.
export function scopePaths(v, label = 'scope', { stored = false } = {}) {
  if (v === undefined) {
    if (stored) {
      throw err('SPEC_DATA_MALFORMED', `${label} is required in stored data`);
    }
    return [];
  }
  if (!Array.isArray(v)) {
    throw err('SPEC_DATA_MALFORMED', `${label} must be an array of paths`);
  }
  return v.map((p, i) => {
    const canon = assertDestination(p, `${label}[${i}]`);
    if (stored && canon !== p) {
      throw err('SPEC_DATA_MALFORMED',
        `${label}[${i}] is not canonical: '${p}'`);
    }
    return canon;
  });
}

// stored=true (reads of persisted artifacts): every schema-required key
// must be present verbatim — a missing field is malformed data, never a
// default to fill. Prepare-time inputs use stored=false and normalize the
// declared optional arrays to [].
export function validateSpecificationData(data,
    label = 'specification data', { stored = false } = {}) {
  closed(data, SPEC_KEYS, label);
  if (data.schemaVersion !== 1) {
    throw err('SPEC_DATA_MALFORMED', `${label}.schemaVersion must be 1`);
  }
  const required = ['originalRequest', 'outcome', 'requirements', 'scope',
    'constraints', 'nonGoals', 'openQuestions'];
  if (stored) {
    for (const k of required) {
      if (data[k] === undefined) {
        throw err('SPEC_DATA_MALFORMED',
          `${label}.${k} is required in stored data`);
      }
    }
  }
  const originalRequest = text(data.originalRequest,
    `${label}.originalRequest`);
  const outcome = (() => {
    closed(data.outcome, OUTCOME_KEYS, `${label}.outcome`);
    return {
      statement: text(data.outcome.statement,
        `${label}.outcome.statement`),
      evidencePlan: text(data.outcome.evidencePlan,
        `${label}.outcome.evidencePlan`),
    };
  })();
  if (!Array.isArray(data.requirements) || data.requirements.length === 0) {
    throw err('SPEC_DATA_MALFORMED',
      `${label}.requirements must be a non-empty array`);
  }
  const requirements = data.requirements.map((r, i) => {
    closed(r, REQ_KEYS, `${label}.requirements[${i}]`);
    if (!Array.isArray(r.scenarios) || r.scenarios.length === 0) {
      throw err('SPEC_DATA_MALFORMED',
        `${label}.requirements[${i}].scenarios must be non-empty`);
    }
    const scenarios = r.scenarios.map((s, j) => {
      closed(s, SCEN_KEYS, `${label}.requirements[${i}].scenarios[${j}]`);
      return {
        id: validateSpecificationItemId(s.id, `${label}.requirements[${i}].scenarios[${j}].id`),
        given: text(s.given,
          `${label}.requirements[${i}].scenarios[${j}].given`),
        when: text(s.when,
          `${label}.requirements[${i}].scenarios[${j}].when`),
        then: text(s.then,
          `${label}.requirements[${i}].scenarios[${j}].then`),
      };
    });
    uniqueIds(scenarios, `${label}.requirements[${i}].scenarios`);
    return {
      id: validateSpecificationItemId(r.id, `${label}.requirements[${i}].id`),
      statement: text(r.statement,
        `${label}.requirements[${i}].statement`),
      scenarios,
    };
  });
  uniqueIds(requirements, `${label}.requirements`);
  return {
    schemaVersion: 1,
    originalRequest,
    outcome,
    requirements,
    scope: scopePaths(data.scope, `${label}.scope`, { stored }),
    constraints: textArray(data.constraints, `${label}.constraints`,
      { required: stored }),
    nonGoals: textArray(data.nonGoals, `${label}.nonGoals`,
      { required: stored }),
    openQuestions: textArray(data.openQuestions, `${label}.openQuestions`,
      { required: stored }),
  };
}

// Design V2 data: binding only — no inner schemaVersion.
export function validateDesignData(data, label = 'design data') {
  closed(data, DESIGN_KEYS, label);
  if (typeof data.specId !== 'string' || !UUID_RE.test(data.specId)) {
    throw err('SPEC_DATA_MALFORMED', `${label}.specId must be a UUID`);
  }
  if (typeof data.specDigest !== 'string' || !SHA_RE.test(data.specDigest)) {
    throw err('SPEC_DATA_MALFORMED',
      `${label}.specDigest must be a sha256 hex digest`);
  }
  return { specId: data.specId, specDigest: data.specDigest };
}
