// Path safety: canonical relative paths, containment and link rejection.
// Stored paths are project-relative POSIX strings.
//
// PORTABLE COMPARISON POLICY: all structural comparisons (reserved prefixes,
// overlap, plan collisions, duplicate detection) lowercase both operands on
// every platform. Windows filesystems are case-insensitive and Linux ones are
// usually not, so case-insensitive comparison is the conservative choice: it
// may reject two names that could coexist on a case-sensitive volume, which
// is acceptable for harness-owned destinations. Real filesystem containment
// and reads still use the actual path bytes.
import path from 'node:path';
import fs from 'node:fs';
import { err } from './errors.mjs';
import { lstatOrNull } from './fsx.mjs';

export const RESERVED_PREFIXES = new Set(['.git', 'node_modules', 'legacy', '.opencode']);

const DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);
const FORBIDDEN_CHARS = /[<>:"|?*]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/;

export function portableKey(rel) {
  return rel.toLowerCase();
}

function validateSegment(seg, original) {
  if (seg === '') {
    throw err('INVALID_PATH', `path contains an empty segment: ${original}`);
  }
  if (seg === '.' || seg === '..') {
    throw err('INVALID_PATH', `path contains a '${seg}' segment: ${original}`);
  }
  if (seg.endsWith(' ') || seg.endsWith('.')) {
    throw err('INVALID_PATH',
      `path segment may not end in space or dot: ${original}`);
  }
  const base = seg.split('.')[0].toLowerCase();
  if (DEVICE_NAMES.has(base)) {
    throw err('INVALID_PATH',
      `path segment uses a reserved device name: ${original}`);
  }
}

// Accepts user input (also Windows-style separators), returns canonical
// project-relative POSIX path or throws. Rejects: NUL/control chars,
// colon (drives and ADS), <>|?* characters, POSIX and win32 absolutes,
// UNC, '..', '.', empty segments, trailing space/dot and device names.
// Unicode letters are preserved; only ASCII-restricted names are rejected.
export function toCanonicalRelative(input, label = 'path') {
  if (typeof input !== 'string') {
    throw err('INVALID_PATH', `${label} must be a string`);
  }
  const normalized = input.replace(/\\/g, '/');
  if (normalized.length === 0) {
    throw err('INVALID_PATH', `${label} must not be empty`);
  }
  if (CONTROL_CHARS.test(normalized)) {
    throw err('INVALID_PATH', `${label} contains a control character`);
  }
  if (normalized.includes(':')) {
    throw err('INVALID_PATH', `${label} contains a colon (drives/ADS are not allowed): ${input}`);
  }
  if (FORBIDDEN_CHARS.test(normalized.replace(/:/g, ''))) {
    throw err('INVALID_PATH', `${label} contains a forbidden character: ${input}`);
  }
  if (normalized.startsWith('/')) {
    throw err('INVALID_PATH', `${label} must be relative, not absolute: ${input}`);
  }
  const segments = normalized.split('/');
  for (const seg of segments) validateSegment(seg, input);
  return segments.join('/');
}

// Relative destination validation including reserved prefixes (compared
// case-insensitively). Used for config, the seven artifact paths and scope.
export function assertDestination(input, label = 'destination') {
  const rel = toCanonicalRelative(input, label);
  const first = portableKey(rel.split('/')[0]);
  if (RESERVED_PREFIXES.has(first)) {
    throw err('RESERVED_PATH', `${label} may not target reserved prefix '${first}': ${input}`);
  }
  return rel;
}

// Case-insensitive ancestor relation on canonical POSIX relative paths.
export function isSameOrAncestor(ancestor, child) {
  const a = portableKey(ancestor);
  const c = portableKey(child);
  return c === a || c.startsWith(a + '/');
}

export function assertDistinctPaths(entries) {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [aKey, a] = entries[i];
      const [bKey, b] = entries[j];
      if (isSameOrAncestor(a, b) || isSameOrAncestor(b, a)) {
        throw err('PATH_OVERLAP',
          `paths '${aKey}' (${a}) and '${bKey}' (${b}) overlap or are equal`);
      }
    }
  }
}

// Lexical containment: abs must resolve inside rootAbs (equal counts).
export function isInside(rootAbs, abs) {
  const rel = path.relative(rootAbs, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Reject links and non-directory ancestors in every existing segment between
// rootAbs (exclusive) and absPath. The leaf itself is checked by callers.
export function assertNoSymlinkChain(rootAbs, absPath) {
  const root = lstatOrNull(rootAbs);
  if (root?.isSymbolicLink()) {
    throw err('SYMLINK_REJECTED',
      `approved root was replaced with a symlink/junction: ${rootAbs}`);
  }
  if (root && !root.isDirectory()) {
    throw err('FILE_ANCESTOR', `approved root is not a directory: ${rootAbs}`);
  }
  const rel = path.relative(rootAbs, absPath);
  if (rel === '') return;
  const segments = rel.split(path.sep);
  let current = rootAbs;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    const st = lstatOrNull(current);
    if (!st) break; // deeper segments cannot exist either
    if (st.isSymbolicLink()) {
      throw err('SYMLINK_REJECTED',
        `refusing path through symlink/junction ancestor: ${current}`);
    }
    if (i < segments.length - 1 && !st.isDirectory()) {
      throw err('FILE_ANCESTOR',
        `path crosses a non-directory ancestor: ${current}`);
    }
  }
}

// Resolve a project-relative path to an absolute path that is verifiably
// contained: lexical containment plus real ancestors without links.
export function resolveInside(rootAbs, rel, label = 'path') {
  const canonical = toCanonicalRelative(rel, label);
  const abs = path.resolve(rootAbs, ...canonical.split('/'));
  if (!isInside(rootAbs, abs)) {
    throw err('OUTSIDE_ROOT', `${label} escapes the project root: ${rel}`);
  }
  assertNoSymlinkChain(rootAbs, abs);
  return abs;
}

// The explicitly chosen project root must exist and be a real directory.
export function resolveProjectRoot(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw err('INVALID_PROJECT', 'a project root path is required');
  }
  const abs = path.resolve(input);
  const st = lstatOrNull(abs);
  if (!st) throw err('PROJECT_NOT_FOUND', `project root does not exist: ${abs}`);
  if (st.isSymbolicLink()) {
    throw err('SYMLINK_REJECTED', `project root may not be a symlink/junction: ${abs}`);
  }
  if (!st.isDirectory()) {
    throw err('PROJECT_NOT_DIR', `project root is not a directory: ${abs}`);
  }
  return fs.realpathSync(abs);
}
