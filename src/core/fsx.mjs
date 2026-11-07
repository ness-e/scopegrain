// Small synchronous filesystem helpers shared by core modules.
import fs from 'node:fs';
import { err } from './errors.mjs';

export function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

// Bounded read via descriptor + fstat; never buffers more than maxBytes.
export function readFileLimited(p, maxBytes) {
  const fd = fs.openSync(p, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (st.size > maxBytes) {
      return { exceeded: true, size: st.size, content: null };
    }
    const buf = Buffer.alloc(Math.max(1, Math.min(st.size, maxBytes + 1)));
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    return {
      exceeded: false,
      size: st.size,
      content: buf.subarray(0, bytesRead),
    };
  } finally {
    fs.closeSync(fd);
  }
}

// Bounded directory listing via opendir: collects at most max entries and
// closes the iterator in all cases. Exactly-max directories are NOT
// truncated: a single extra peek decides whether more entries exist.
export function readDirBounded(dirAbs, max) {
  const dir = fs.opendirSync(dirAbs);
  const entries = [];
  let truncated = false;
  try {
    while (entries.length < max) {
      const dirent = dir.readSync();
      if (dirent === null) return { entries, truncated };
      entries.push(dirent);
    }
    truncated = dir.readSync() !== null; // one peek, never processed
  } finally {
    dir.closeSync();
  }
  return { entries, truncated };
}

export function readJsonFile(p, label) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw err('READ_FAILED', `cannot read ${label}: ${p}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw err('MALFORMED_JSON', `malformed JSON in ${label}: ${p}`);
  }
}

// Exclusive write with ownership semantics: the fd is opened OUTSIDE the
// try, so a failed 'wx' open (EEXIST/EACCES) never triggers cleanup of a
// file we do not own. After a successful open the file is ours — write
// loops until complete, and any write/close failure removes only it.
export function writeFileExclusive(file, content) {
  const fd = fs.openSync(file, 'wx');
  try {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(fd, buf, off, buf.length - off);
      if (n <= 0) {
        throw err('WRITE_FAILED', `write made no progress on ${file}`);
      }
      off += n;
    }
    fs.closeSync(fd);
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    removeIfExists(file); // ours: created by the successful open above
    throw e;
  }
}

export function mkdirpSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function removeIfExists(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best-effort cleanup of our own artifacts only
  }
}
