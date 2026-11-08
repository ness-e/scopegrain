// Pure methodology data: assessment validation/normalization and the
// deterministic work classifier. No storage, gates or transition imports -
// this module computes facts from declared facts only (operator-attributed,
// never authenticated).
import { err } from './errors.mjs';

const ASSESSMENT_KEYS = new Set([
  'schemaVersion', 'request', 'intent', 'authorization', 'understanding',
  'uncertainty', 'risk', 'riskCategories', 'continuity', 'evidence',
  'preferredRoute',
]);
const AUTH_KEYS = new Set(['status', 'actor', 'reference']);
const INTENTS = new Set(['change', 'read-only']);
const AUTH_STATUS = new Set(['authorized', 'missing', 'declined']);
const UNDERSTANDING = new Set(['sufficient', 'insufficient']);
const UNCERTAINTY = new Set(['resolved', 'unresolved']);
const RISK = new Set(['contained', 'named', 'unknown']);
const CONTINUITY = new Set(['diff-sufficient', 'record-required']);
const ROUTES = new Set(['auto', 'sdd']);
const RISK_CATEGORIES = new Set([
  'security', 'data-integrity', 'public-contract', 'concurrency',
  'delivery', 'external-effects', 'verification-gap', 'other',
]);

function bad(label, m) {
  throw err('INVALID_METHODOLOGY', `${label}: ${m}`);
}

function text(v, label) {
  if (typeof v !== 'string' || v.trim() === '') {
    bad(label, 'must be a non-empty string');
  }
  return v; // verbatim - never trimmed or summarized
}

function closed(v, keys, label) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    bad(label, 'must be an object');
  }
  for (const k of Object.keys(v)) {
    if (!keys.has(k)) bad(label, `has unknown key '${k}'`);
  }
}

// stored=true (reads of persisted records): every schema-required field
// must be present verbatim. Raw inputs may omit preferredRoute (auto).
export function validateMethodologyData(data,
    label = 'methodology', { stored = false } = {}) {
  closed(data, ASSESSMENT_KEYS, label);
  if (data.schemaVersion !== 1) bad(label, 'schemaVersion must be 1');
  if (stored) {
    for (const k of ASSESSMENT_KEYS) {
      if (data[k] === undefined) bad(label, `.${k} is required in stored data`);
    }
  }
  if (!INTENTS.has(data.intent)) bad(label, `.intent invalid`);
  // authorization.closed + conditional required actor/reference.
  closed(data.authorization, AUTH_KEYS, `${label}.authorization`);
  const auth = data.authorization;
  if (!AUTH_STATUS.has(auth.status)) bad(label, '.authorization.status invalid');
  if (auth.status === 'missing') {
    if (auth.actor !== null || auth.reference !== null) {
      bad(label, '.authorization actor/reference must be null when missing');
    }
  } else {
    text(auth.actor, `${label}.authorization.actor`);
    text(auth.reference, `${label}.authorization.reference`);
  }
  if (!UNDERSTANDING.has(data.understanding)) {
    bad(label, '.understanding invalid');
  }
  if (!UNCERTAINTY.has(data.uncertainty)) {
    bad(label, '.uncertainty invalid');
  }
  if (!RISK.has(data.risk)) bad(label, '.risk invalid');
  if (!Array.isArray(data.riskCategories)) {
    bad(label, '.riskCategories must be an array');
  }
  const cats = new Set();
  for (const c of data.riskCategories) {
    if (!RISK_CATEGORIES.has(c)) {
      bad(label, `.riskCategories unknown category '${c}'`);
    }
    if (cats.has(c.toLowerCase())) {
      bad(label, `.riskCategories duplicate '${c}'`);
    }
    cats.add(c.toLowerCase());
  }
  if (data.risk === 'contained' && data.riskCategories.length !== 0) {
    bad(label, '.riskCategories must be empty when risk is contained');
  }
  if (data.risk === 'named' && data.riskCategories.length === 0) {
    bad(label, '.riskCategories must be non-empty when risk is named');
  }
  if (!CONTINUITY.has(data.continuity)) bad(label, '.continuity invalid');
  if (!Array.isArray(data.evidence) || data.evidence.length === 0) {
    bad(label, '.evidence must be a non-empty array');
  }
  // for-of visits sparse holes (which are undefined), forEach would skip.
  for (const [i, e] of data.evidence.entries()) {
    text(e, `${label}.evidence[${i}]`);
  }
  const preferredRoute = data.preferredRoute === undefined
    ? 'auto' : data.preferredRoute;
  if (!ROUTES.has(preferredRoute)) {
    bad(label, '.preferredRoute invalid');
  }
  return {
    schemaVersion: 1,
    request: text(data.request, `${label}.request`),
    intent: data.intent,
    authorization: {
      status: auth.status,
      actor: auth.actor ?? null,
      reference: auth.reference ?? null,
    },
    understanding: data.understanding,
    uncertainty: data.uncertainty,
    risk: data.risk,
    riskCategories: [...data.riskCategories],
    continuity: data.continuity,
    evidence: [...data.evidence],
    preferredRoute,
  };
}

// Deterministic routing from declared facts. read-only reports first;
// a change accumulates EVERY blocker. Route is never accepted as input -
// it is derived here only.
export function classifyWork(data) {
  const d = validateMethodologyData(data, 'methodology input');
  const issues = [];
  const attestationOnly = true;
  if (d.intent === 'read-only') {
    return { route: 'read-only', issues, attestationOnly };
  }
  const push = (code, message) => issues.push({ code, message });
  const a = d.authorization;
  if (a.status === 'missing') {
    push('AUTHORIZATION_MISSING',
      'change intent requires declared authorization');
  } else if (a.status === 'declined') {
    push('AUTHORIZATION_DECLINED',
      `authorization was declined by ${a.actor}`);
  }
  if (d.understanding === 'insufficient') {
    push('UNDERSTANDING_INSUFFICIENT',
      'understanding must be sufficient before change work');
  }
  if (d.uncertainty === 'unresolved') {
    push('UNCERTAINTY_UNRESOLVED',
      'unresolved uncertainty blocks change work');
  }
  if (d.risk === 'unknown') {
    push('RISK_UNKNOWN', 'unknown risk requires a structured assessment');
  }
  if (issues.length > 0) {
    return { route: 'blocked', issues, attestationOnly };
  }
  if (d.preferredRoute === 'sdd' || d.risk === 'named'
      || d.continuity === 'record-required') {
    return { route: 'sdd', issues, attestationOnly };
  }
  return { route: 'light', issues, attestationOnly };
}
