// Canonical workflow policy loader: policy/workflow.json is the single
// source of truth for states, transitions, actions and acceptance rules.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { err } from './errors.mjs';
import { readJsonFile } from './fsx.mjs';

const POLICY_PATH = fileURLToPath(
  new URL('../../policy/workflow.json', import.meta.url));

let cached = null;

export function loadPolicy() {
  if (cached) return cached;
  const policy = readJsonFile(POLICY_PATH, 'workflow policy');
  if (policy.schemaVersion !== 1
      || typeof policy.initial !== 'string'
      || policy.transitions === null || typeof policy.transitions !== 'object'
      || policy.actions === null || typeof policy.actions !== 'object'
      || policy.acceptance === null || typeof policy.acceptance !== 'object') {
    throw err('POLICY_INVALID', 'policy/workflow.json has an unexpected shape');
  }
  if (!Array.isArray(policy.transitions[policy.initial])) {
    throw err('POLICY_INVALID', 'policy initial state is not declared in transitions');
  }
  for (const [state, next] of Object.entries(policy.transitions)) {
    if (!Array.isArray(next) || !Array.isArray(policy.actions[state])) {
      throw err('POLICY_INVALID', `policy state '${state}' lacks transitions or actions`);
    }
  }
  cached = policy;
  return cached;
}

export function knownStates() {
  return Object.keys(loadPolicy().transitions);
}

export function isTransitionAllowed(from, to) {
  const policy = loadPolicy();
  const next = policy.transitions[from];
  return Array.isArray(next) && next.includes(to);
}

export function knownActions() {
  const all = new Set();
  for (const list of Object.values(loadPolicy().actions)) {
    for (const a of list) all.add(a);
  }
  return all;
}

export function actionsFor(state) {
  return loadPolicy().actions[state] || [];
}
