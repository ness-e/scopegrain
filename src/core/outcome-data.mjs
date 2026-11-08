// Pure validator for outcome report V2 data — bindings computed by the
// runtime, never free operator parameters. See schemas/outcome-data.schema.json.
import { err } from './errors.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const KEYS = new Set([
  'schemaVersion', 'taskId', 'taskRevision', 'taskDigest', 'specId',
  'specDigest', 'designDigest', 'planDigest', 'verificationDigest',
]);

export function validateOutcomeData(data, label = 'outcome data') {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw err('OUTCOME_DATA_MALFORMED', `${label} must be an object`);
  }
  for (const k of Object.keys(data)) {
    if (!KEYS.has(k)) {
      throw err('OUTCOME_DATA_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
  const digest = (v, k) => {
    if (typeof v !== 'string' || !SHA_RE.test(v)) {
      throw err('OUTCOME_DATA_MALFORMED',
        `${label}.${k} must be a sha256 hex digest`);
    }
    return v;
  };
  if (data.schemaVersion !== 1) {
    throw err('OUTCOME_DATA_MALFORMED', `${label}.schemaVersion must be 1`);
  }
  if (typeof data.taskId !== 'string' || !UUID_RE.test(data.taskId)) {
    throw err('OUTCOME_DATA_MALFORMED', `${label}.taskId must be a UUID`);
  }
  if (!Number.isSafeInteger(data.taskRevision) || data.taskRevision < 0) {
    throw err('OUTCOME_DATA_MALFORMED',
      `${label}.taskRevision must be a non-negative safe integer`);
  }
  if (typeof data.specId !== 'string' || !UUID_RE.test(data.specId)) {
    throw err('OUTCOME_DATA_MALFORMED', `${label}.specId must be a UUID`);
  }
  if (data.planDigest !== null
      && (typeof data.planDigest !== 'string' || !SHA_RE.test(data.planDigest))) {
    throw err('OUTCOME_DATA_MALFORMED',
      `${label}.planDigest must be null or a sha256 hex digest`);
  }
  return {
    schemaVersion: 1,
    taskId: data.taskId,
    taskRevision: data.taskRevision,
    taskDigest: digest(data.taskDigest, 'taskDigest'),
    specId: data.specId,
    specDigest: digest(data.specDigest, 'specDigest'),
    designDigest: digest(data.designDigest, 'designDigest'),
    planDigest: data.planDigest,
    verificationDigest: digest(data.verificationDigest, 'verificationDigest'),
  };
}
