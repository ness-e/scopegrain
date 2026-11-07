// TaskSystem error primitive: {code, message} carried on Error instances.
export class TaskError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
  }
}

export function err(code, message) {
  return new TaskError(code, message);
}

export function isTaskError(e) {
  return e instanceof TaskError;
}

export function toErrorPayload(e) {
  if (isTaskError(e)) return { code: e.code, message: e.message };
  const msg = e && e.message ? String(e.message) : String(e);
  return { code: 'INTERNAL', message: msg };
}
