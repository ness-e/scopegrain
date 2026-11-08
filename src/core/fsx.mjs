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
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw err('INVALID_VALUE', 'maxBytes must be a non-negative safe integer');
  }
  const fd = fs.openSync(p, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (st.size > maxBytes) {
      return { exceeded: true, size: st.size, content: null };
    }
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) {
        throw err('READ_FAILED',
          `read made no progress on ${p} (${off}/${st.size})`);
      }
      off += n;
    }
    const st2 = fs.fstatSync(fd);
    if (st2.size > maxBytes) {
      return { exceeded: true, size: st2.size, content: null };
    }
    if (st2.size !== st.size) {
      throw err('READ_FAILED',
        `${p} changed size during read (${st.size} -> ${st2.size})`);
    }
    return { exceeded: false, size: st.size, content: buf };
  } finally {
    fs.closeSync(fd);
  }
}

export function readJsonFile(p, label, maxBytes = 1048576) {
  let limited;
  try {
    limited = readFileLimited(p, maxBytes);
  } catch (e) {
    if (e && e.code === 'READ_FAILED') throw e;
    throw err('READ_FAILED', `cannot read ${label}: ${p}`);
  }
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE',
      `${label} exceeds ${maxBytes} bytes: ${p}`);
  }
  try {
    return JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('MALFORMED_JSON', `malformed JSON in ${label}: ${p}`);
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
