// canonicalJSON/canonicalDigest contract: deterministic key order, array
// order sensitive, hostile shapes rejected, lead projection fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  canonicalDigest, canonicalJSON, taskStaticProjection,
} from '../src/core/digests.mjs';

test('canonical literal: sorted keys, array order preserved', () => {
  const value = { z: [2, 1], a: { b: 2, a: 1 } };
  const expected = '{"a":{"a":1,"b":2},"z":[2,1]}';
  assert.equal(canonicalJSON(value), expected);
  // Independent digest: computed by node crypto, not by the code under test.
  const sha = crypto.createHash('sha256').update(expected, 'utf8')
    .digest('hex');
  assert.equal(canonicalDigest(value), sha);
});

test('object key order invariant; array order sensitive', () => {
  const a = canonicalJSON({ x: 1, y: [3, 2], k: { b: 0, a: 1 } });
  const b = canonicalJSON({ k: { a: 1, b: 0 }, y: [3, 2], x: 1 });
  assert.equal(a, b);
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
});

test('primitives, null-prototype objects, shared refs are canonical', () => {
  assert.equal(canonicalJSON(null), 'null');
  assert.equal(canonicalJSON('s'), '"s"');
  assert.equal(canonicalJSON(true), 'true');
  assert.equal(canonicalJSON(1.5), '1.5');
  assert.equal(canonicalJSON(Object.create(null)), '{}');
  const shared = { v: 1 };
  assert.equal(canonicalJSON({ a: shared, b: shared }),
    '{"a":{"v":1},"b":{"v":1}}');
});

test('hostile __proto__ key is data, never pollution', () => {
  const v = JSON.parse('{"__proto__":{"x":9},"b":1}');
  const out = canonicalJSON(v);
  assert.equal(out, '{"__proto__":{"x":9},"b":1}');
  assert.equal(({}).x, undefined); // no pollution escaped
});

test('non-JSON values reject: undefined, non-finite, function, symbol, Date', () => {
  const cases = [
    undefined, NaN, Infinity, -Infinity,
    () => {}, Symbol('s'), new Date(0),
    { u: undefined }, { f: () => {} },
  ];
  for (const v of cases) {
    assert.throws(() => canonicalJSON(v),
      (e) => e.code === 'INVALID_JSON_VALUE');
  }
});

test('cycles, getters and sparse arrays reject', () => {
  const cyc = { a: {} }; cyc.a.self = cyc;
  assert.throws(() => canonicalJSON(cyc), (e) => e.code === 'INVALID_JSON_VALUE');
  const getter = {}; Object.defineProperty(getter, 'g', { get: () => 1 });
  assert.throws(() => canonicalJSON(getter), (e) => e.code === 'INVALID_JSON_VALUE');
  const sparse = new Array(3);
  assert.throws(() => canonicalJSON(sparse), (e) => e.code === 'INVALID_JSON_VALUE');
});

test('taskStaticProjection: exact 11 fields, nulls for absent V2 keys', () => {
  const t = {
    id: 'id1', title: 'T', contract: 'C', authorContext: 'a',
    scope: ['s'], createdAt: '2026-01-01T00:00:00.000Z',
    state: 'ACT', revision: 9, updatedAt: 'later', history: [{}],
    verification: {}, review: {},
  };
  const p = taskStaticProjection(t);
  assert.deepEqual(Object.keys(p).sort(), [
    'authorContext', 'contract', 'createdAt', 'designId', 'id',
    'methodology', 'planKey', 'scenarioRefs', 'scope', 'specId', 'title',
  ]);
  assert.equal(p.specId, null);
  assert.equal(p.designId, null);
  assert.equal(p.planKey, null);
  assert.equal(p.methodology, null);
  assert.equal(p.scenarioRefs, null);
  assert.equal(!('state' in p) && !('revision' in p)
    && !('history' in p) && !('updatedAt' in p), true);
});
