// Evidence payloads are attestations supplied by the operator or agent.
// They record declared commands, results and reviewer contexts; they are not
// authenticated identity nor proof that checks actually ran.
import { err } from './errors.mjs';
import { toCanonicalRelative } from './paths.mjs';
import { loadPolicy } from './policy.mjs';
import { validateSpecificationItemId } from './specification-data.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VERIFICATION_KEYS = new Set(
  ['checks', 'coverage', 'outcomeEvidenceId']);
const CHECK_KEYS = new Set(['command', 'cwd', 'status', 'evidence']);
const COVERAGE_KEYS = new Set(
  ['requirementId', 'scenarioId', 'checkIndexes']);
const REVIEW_KEYS = new Set([
  'mode', 'reviewer', 'authorContext', 'reviewerContext',
  'verdict', 'owner', 'reference', 'reason',
]);

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw err('INVALID_EVIDENCE', `${label} must be a non-empty string`);
  }
  return value;
}

function checkKeys(obj, allowed, label) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw err('INVALID_EVIDENCE', `${label} must be an object`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw err('INVALID_EVIDENCE', `${label} contains unknown key '${key}'`);
    }
  }
}

export function validateVerification(verification) {
  const acceptance = loadPolicy().acceptance;
  checkKeys(verification, VERIFICATION_KEYS, 'verification');
  const checks = verification.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    throw err('INVALID_EVIDENCE', 'verification.checks must be a non-empty array');
  }
  const accepted = acceptance.verificationStatuses;
  const out = {
    checks: Array.from(checks, (c, i) => {
      checkKeys(c, CHECK_KEYS, `verification.checks[${i}]`);
      for (const key of CHECK_KEYS) {
        if (!(key in c)) {
          throw err('INVALID_EVIDENCE',
            `verification.checks[${i}] is missing '${key}'`);
        }
      }
      nonEmpty(c.command, `checks[${i}].command`);
      nonEmpty(c.evidence, `checks[${i}].evidence`);
      if (!accepted.includes(c.status)) {
        throw err('INVALID_EVIDENCE',
          `checks[${i}].status must be one of: ${accepted.join(', ')}`);
      }
      // A working directory of '.' means the project root.
      const cwd = c.cwd === '.' ? '.' : toCanonicalRelative(c.cwd, `checks[${i}].cwd`);
      return { command: c.command, cwd, status: c.status, evidence: c.evidence };
    }),
  };
  // Optional coverage: exactly {requirementId,scenarioId,checkIndexes}
  // entries, casefold-unique pairs, indexes bounded by checks.length.
  if (verification.coverage !== undefined) {
    if (!Array.isArray(verification.coverage)) {
      throw err('INVALID_EVIDENCE', 'verification.coverage must be an array');
    }
    const seen = new Set();
    const cov = [];
    for (const [i, c] of verification.coverage.entries()) {
      checkKeys(c, COVERAGE_KEYS, `verification.coverage[${i}]`);
      for (const key of COVERAGE_KEYS) {
        if (!(key in c)) {
          throw err('INVALID_EVIDENCE',
            `verification.coverage[${i}] is missing '${key}'`);
        }
      }
      let rid;
      let sid;
      try {
        rid = validateSpecificationItemId(c.requirementId,
          `coverage[${i}].requirementId`);
        sid = validateSpecificationItemId(c.scenarioId,
          `coverage[${i}].scenarioId`);
      } catch (e) {
        throw err('INVALID_EVIDENCE', `coverage[${i}]: ${e.message}`);
      }
      const idx = c.checkIndexes;
      if (!Array.isArray(idx) || idx.length === 0) {
        throw err('INVALID_EVIDENCE',
          `coverage[${i}].checkIndexes must be a non-empty array`);
      }
      for (const [j, n] of idx.entries()) {
        if (!Number.isSafeInteger(n) || n < 0 || n >= checks.length) {
          throw err('INVALID_EVIDENCE',
            `coverage[${i}].checkIndexes[${j}] out of range`);
        }
      }
      const k = `${rid.toLowerCase()}/${sid.toLowerCase()}`;
      if (seen.has(k)) {
        throw err('INVALID_EVIDENCE',
          `coverage pair ${rid}/${sid} duplicated`);
      }
      seen.add(k);
      cov.push({ requirementId: rid, scenarioId: sid,
        checkIndexes: [...idx] });
    }
    out.coverage = cov;
  }
  if (verification.outcomeEvidenceId !== undefined) {
    if (typeof verification.outcomeEvidenceId !== 'string'
        || !UUID_RE.test(verification.outcomeEvidenceId)) {
      throw err('INVALID_EVIDENCE',
        'verification.outcomeEvidenceId must be a UUID string');
    }
    out.outcomeEvidenceId = verification.outcomeEvidenceId;
  }
  return out;
}

export function validateReview(review, task) {
  const acceptance = loadPolicy().acceptance;
  checkKeys(review, REVIEW_KEYS, 'review');
  if (review.verdict !== acceptance.reviewVerdict) {
    throw err('INVALID_EVIDENCE',
      `review.verdict must be '${acceptance.reviewVerdict}'`);
  }
  if (review.mode === 'fresh') {
    for (const key of ['reviewer', 'authorContext', 'reviewerContext']) {
      nonEmpty(review[key], `review.${key}`);
    }
    if (review.authorContext !== task.authorContext) {
      throw err('INVALID_EVIDENCE',
        'review.authorContext does not match the stored task author');
    }
    if (acceptance.freshContextsMustDiffer
        && review.reviewerContext === review.authorContext) {
      throw err('INVALID_EVIDENCE',
        'reviewerContext must differ from authorContext for a fresh review');
    }
    return {
      mode: 'fresh',
      reviewer: review.reviewer,
      authorContext: review.authorContext,
      reviewerContext: review.reviewerContext,
      verdict: review.verdict,
    };
  }
  if (review.mode === 'waived') {
    for (const key of acceptance.waiverRequiredFields) {
      nonEmpty(review[key], `review.${key}`);
    }
    return {
      mode: 'waived',
      owner: review.owner,
      reference: review.reference,
      reason: review.reason,
      verdict: review.verdict,
    };
  }
  throw err('INVALID_EVIDENCE',
    `review.mode must be 'fresh' or 'waived', got: ${String(review.mode)}`);
}
