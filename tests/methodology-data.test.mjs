// Pure methodology data: assessment validation + deterministic classifier.
// All facts are declared/attributed - the classifier never authenticates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWork, validateMethodologyData,
} from '../src/core/methodology-data.mjs';

const BASE = {
  schemaVersion: 1,
  request: 'add a dark-mode toggle, verbatim request',
  intent: 'change',
  authorization: { status: 'authorized', actor: 'operator', reference: 'REQ-1' },
  understanding: 'sufficient',
  uncertainty: 'resolved',
  risk: 'contained',
  riskCategories: [],
  continuity: 'diff-sufficient',
  evidence: ['user asked in chat'],
  preferredRoute: 'auto',
};

const over = (o = {}) => ({ ...BASE, ...o });
const im = (code) => (e) => e.code === 'INVALID_METHODOLOGY'
  && e.message.includes(code);

// -------------------- classifyWork routing table --------------------

test('base contained/authorized -> light', () => {
  const { route, issues, attestationOnly } = classifyWork(BASE);
  assert.equal(route, 'light');
  assert.equal(issues.length, 0);
  assert.equal(attestationOnly, true);
});

test('read-only intent reports route without authorizing change', () => {
  // Even with missing auth/unknown risk/unresolved uncertainty, read-only
  // work is reported as read-only - it carries no change authority.
  const { route, issues } = classifyWork(over({
    intent: 'read-only',
    authorization: { status: 'missing', actor: null, reference: null },
    risk: 'unknown',
    uncertainty: 'unresolved',
  }));
  assert.equal(route, 'read-only');
  assert.equal(issues.length, 0);
});

for (const [label, input, code] of [
  ['missing auth', over({ authorization: { status: 'missing', actor: null, reference: null } }), 'AUTHORIZATION_MISSING'],
  ['declined auth', over({ authorization: { status: 'declined', actor: 'op', reference: 'R' } }), 'AUTHORIZATION_DECLINED'],
  ['insufficient understanding', over({ understanding: 'insufficient' }), 'UNDERSTANDING_INSUFFICIENT'],
  ['unresolved uncertainty', over({ uncertainty: 'unresolved' }), 'UNCERTAINTY_UNRESOLVED'],
  ['unknown risk', over({ risk: 'unknown', riskCategories: ['security'] }), 'RISK_UNKNOWN'],
]) {
  test(`change with ${label} -> blocked`, () => {
    const { route, issues } = classifyWork(input);
    assert.equal(route, 'blocked');
    assert.ok(issues.some((i) => i.code === code),
      `${label}: ${JSON.stringify(issues)}`);
  });
}

test('all four blockers accumulate: issues=4', () => {
  const { route, issues } = classifyWork(over({
    authorization: { status: 'missing', actor: null, reference: null },
    understanding: 'insufficient',
    uncertainty: 'unresolved',
    risk: 'unknown',
  }));
  assert.equal(route, 'blocked');
  assert.equal(issues.length, 4);
});

for (const [label, input] of [
  ['named security risk', over({ risk: 'named', riskCategories: ['security'] })],
  ['other category w/ evidence', over({ risk: 'named', riskCategories: ['other'], evidence: ['prior incident'] })],
  ['continuity record-required', over({ continuity: 'record-required' })],
  ['preferredRoute sdd', over({ preferredRoute: 'sdd' })],
]) {
  test(`${label} -> sdd`, () => {
    const { route, issues } = classifyWork(input);
    assert.equal(route, 'sdd');
    assert.equal(issues.length, 0);
  });
}

test('preferredRoute sdd + unknown risk -> blocked, not sdd', () => {
  const { route, issues } = classifyWork(over({
    preferredRoute: 'sdd', risk: 'unknown',
    riskCategories: ['security'] }));
  assert.equal(route, 'blocked');
  assert.ok(issues.some((i) => i.code === 'RISK_UNKNOWN'));
});

// -------------------- validateMethodologyData --------------------

test('raw preferredRoute omitted -> auto; stored requires it', () => {
  const { preferredRoute } = validateMethodologyData(
    (() => { const { preferredRoute: _p, ...r } = BASE; return r; })());
  assert.equal(preferredRoute, 'auto');
  const noPref = (() => { const { preferredRoute: _p, ...r } = BASE; return r; })();
  assert.throws(() => validateMethodologyData(noPref, 'stored', { stored: true }),
    im('preferredRoute'));
});

test('sparse evidence holes are validated, never skipped', () => {
  const sparse = over({ evidence: ['a', , 'c'] }); // hole at index 1
  assert.throws(() => validateMethodologyData(sparse), im('evidence'));
});

test('request preserved verbatim incl whitespace', () => {
  const raw = '  leading\ntrailing  ';
  const { request } = validateMethodologyData(over({ request: raw }));
  assert.equal(request, raw);
});

for (const [label, input, frag] of [
  ['unknown top key', over({ extra: 1 }), 'extra'],
  ['unknown nested key', over({ authorization: { status: 'authorized', actor: 'a', reference: 'r', extra: 1 } }), 'extra'],
  ['bad intent enum', over({ intent: 'bogus' }), 'intent'],
  ['whitespace request', over({ request: '   ' }), 'request'],
  ['missing required (stored)', (() => { const { risk: _r, ...r } = BASE; return r; })(), 'risk'],
  ['duplicate categories', over({ risk: 'named', riskCategories: ['security', 'security'] }), 'duplicate'],
  ['contained + categories', over({ risk: 'contained', riskCategories: ['security'] }), 'riskCategories'],
  ['named no categories', over({ risk: 'named', riskCategories: [] }), 'riskCategories'],
  ['missing auth + nonnull actor', over({ authorization: { status: 'missing', actor: 'a', reference: null } }), 'actor'],
  ['authorized + no actor', over({ authorization: { status: 'authorized', actor: null, reference: 'r' } }), 'actor'],
  ['authorized + no reference', over({ authorization: { status: 'authorized', actor: 'a', reference: null } }), 'reference'],
  ['bad schemaVersion', over({ schemaVersion: 2 }), 'schemaVersion'],
  ['empty evidence', over({ evidence: [] }), 'evidence'],
  ['bad riskCategory', over({ risk: 'named', riskCategories: ['not-a-cat'] }), 'riskCategories'],
]) {
  test(`malformed: ${label} -> INVALID_METHODOLOGY`, () => {
    assert.throws(() => validateMethodologyData(input), im(frag));
  });
}
