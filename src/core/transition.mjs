// Locked CAS transitions and action checks over stored task state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { mkdirpSync, removeIfExists, writeFileExclusive } from './fsx.mjs';
import { isTransitionAllowed, knownActions, knownStates, loadLimits } from './policy.mjs';
import { getTask, taskFilePath, validateTaskShape } from './tasks.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { evaluateMethodology, evaluateTaskActions } from './methodology.mjs';

const TRANSITION_KEYS = new Set([
  'id', 'to', 'expectedRevision', 'verification', 'review',
]);

function acquireLock(taskFile) {
  const lockPath = taskFile + '.lock';
  try {
    writeFileExclusive(lockPath, '');
    return lockPath;
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('TASK_LOCKED',
        'task lock exists; refusing to recover it automatically');
    }
    if (e && e.code === 'ENOENT') {
      throw err('TASK_NOT_FOUND', 'task directory does not exist');
    }
    throw e;
  }
}

export function transitionTask(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'transitionTask input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!TRANSITION_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `transitionTask received unknown key '${key}'`);
    }
  }
  const { id, to, expectedRevision } = input;
  if (!knownStates().includes(to)) {
    throw err('INVALID_STATE', `unknown target state '${String(to)}'`);
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  const attachingEvidence = input.verification !== undefined
    || input.review !== undefined;
  if (to === 'ACT' && attachingEvidence) {
    throw err('INVALID_EVIDENCE',
      'evidence cannot be attached on a transition to ACT');
  }

  const file = taskFilePath(ctx, id);
  const lockPath = acquireLock(file);
  let tmpPath = null;
  let tmpOwned = false;
  try {
    const task = getTask(ctx, id);
    if (task.revision !== expectedRevision) {
      throw err('REVISION_MISMATCH',
        `expected revision ${expectedRevision} but stored ${task.revision}`);
    }
    if (!isTransitionAllowed(task.state, to)) {
      throw err('INVALID_TRANSITION',
        `transition ${task.state} -> ${to} is not allowed by workflow policy`);
    }

    let verification = task.verification;
    let review = task.review;
    if (input.verification !== undefined) {
      verification = validateVerification(input.verification);
      if (input.review === undefined) review = null; // new verification voids review
    }
    if (input.review !== undefined) {
      review = validateReview(input.review, task);
    }
    if (to === 'ACT') {
      verification = null; // returning to implementation voids evidence
      review = null;
    }
    if (to === 'ACCEPT') {
      if (!verification) {
        throw err('ACCEPT_REQUIRES_EVIDENCE',
          'ACCEPT requires non-empty passing verification evidence');
      }
      if (!review) {
        throw err('ACCEPT_REQUIRES_REVIEW',
          'ACCEPT requires a fresh review or an explicit owner waiver');
      }
      // Always re-validate the effective payloads, including ones that were
      // stored by an earlier transition.
      verification = validateVerification(verification);
      review = validateReview(review, task);
    }

    const at = new Date().toISOString();
    const next = {
      ...task,
      state: to,
      revision: task.revision + 1,
      verification,
      review,
      updatedAt: at,
      history: [...task.history, {
        at, event: 'transition', from: task.state, to,
        revision: task.revision + 1,
      }],
    };
    validateTaskShape(next, `task ${id}`);
    if (to === 'ACT' || to === 'ACCEPT') {
      const result = evaluateMethodology(ctx, next, {
        to, previousRevision: task.revision,
      });
      if (!result.allowed) {
        const e = err('METHODOLOGY_BLOCKED',
          `methodology gate blocked ${to}: ${result.issues[0].code}: ${result.issues[0].message}`);
        e.issues = result.issues;
        e.result = result;
        throw e;
      }
    }
    mkdirpSync(path.dirname(file));
    tmpPath = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const serialized = JSON.stringify(next, null, 2) + '\n';
    const maxBytes = loadLimits().maxDocumentBytes;
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      throw err('DOCUMENT_TOO_LARGE',
        `task record would exceed ${maxBytes} bytes`);
    }
    writeFileExclusive(tmpPath, serialized); // cleans itself on write failure
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    return next;
  } finally {
    removeIfExists(lockPath); // only the lock file created above
    if (tmpOwned) removeIfExists(tmpPath); // rename path only
  }
}

// checkAction reports whether an action is permitted by policy in the task's
// current stored state. It does not intercept native host tool calls.
export function checkAction(ctx, taskId, action) {
  if (typeof action !== 'string' || !knownActions().has(action)) {
    throw err('INVALID_ACTION', `unknown action '${String(action)}'`);
  }
  const task = getTask(ctx, taskId);
  const { permitted } = evaluateTaskActions(ctx, task);
  return {
    id: task.id,
    state: task.state,
    action,
    allowed: permitted.includes(action),
    permitted,
  };
}
