// Canonical JSON algorithm authored by the lead for src/core/digests.mjs.
import crypto from 'node:crypto';
import { err } from './errors.mjs';

export function canonicalJSON(value) {
  const ancestors = new Set();
  const invalid = (message) => {
    throw err('INVALID_JSON_VALUE', message);
  };
  const encode = (v) => {
    if (v === null) return 'null';
    if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) invalid('non-finite numbers are not canonical JSON');
      return JSON.stringify(v);
    }
    if (typeof v !== 'object') invalid('value is not JSON data');
    if (ancestors.has(v)) invalid('cyclic values are not JSON data');
    if (Object.getOwnPropertySymbols(v).length) {
      invalid('symbol keys are not JSON data');
    }
    const array = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (!array && proto !== Object.prototype && proto !== null) {
      invalid('only plain JSON objects are supported');
    }
    const descriptors = Object.getOwnPropertyDescriptors(v);
    const names = Object.getOwnPropertyNames(v);
    const ownValue = (key) => {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        invalid('accessors and sparse arrays are not JSON data');
      }
      return descriptor.value;
    };
    ancestors.add(v);
    try {
      if (array) {
        if (names.length !== v.length + 1) {
          invalid('array contains holes or non-index properties');
        }
        const parts = [];
        for (let i = 0; i < v.length; i += 1) {
          parts.push(encode(ownValue(String(i))));
        }
        return `[${parts.join(',')}]`;
      }
      const keys = Object.keys(v).sort();
      if (keys.length !== names.length) {
        invalid('non-enumerable object properties are not JSON data');
      }
      return `{${keys.map((key) =>
        `${JSON.stringify(key)}:${encode(ownValue(key))}`).join(',')}}`;
    } finally {
      ancestors.delete(v);
    }
  };
  try {
    return encode(value);
  } catch (error) {
    if (error instanceof RangeError) {
      throw err('INVALID_JSON_VALUE', 'JSON nesting exceeds serializer capacity');
    }
    throw error;
  }
}

export function canonicalDigest(value) {
  return crypto.createHash('sha256').update(canonicalJSON(value), 'utf8')
    .digest('hex');
}

export function taskStaticProjection(task) {
  return {
    id: task.id,
    title: task.title,
    contract: task.contract,
    authorContext: task.authorContext,
    scope: task.scope,
    createdAt: task.createdAt,
    specId: task.specId ?? null,
    designId: task.designId ?? null,
    planKey: task.planKey ?? null,
    methodology: task.methodology ?? null,
    scenarioRefs: task.scenarioRefs ?? null,
  };
}
