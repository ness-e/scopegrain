// Shared test fixtures. Temporary projects live under tests/.tmp and every
// test removes only the directories it created.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_ROOT = fileURLToPath(new URL('./.tmp/', import.meta.url));

export function makeTempDir(name) {
  const dir = path.join(
    TMP_ROOT,
    `${name}-${process.pid}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFile(root, rel, content) {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

export function writeJson(root, rel, obj) {
  return writeFile(root, rel, JSON.stringify(obj, null, 2) + '\n');
}

export function readJson(root, rel) {
  return JSON.parse(
    fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8'));
}

export function exists(root, rel) {
  return fs.existsSync(path.join(root, ...rel.split('/')));
}

export const VALID_ANSWERS = {
  name: 'fixture-project',
  locale: 'es',
  hosts: ['claude', 'codex', 'opencode', 'devin'],
  paths: {
    plans: 'docs/agent/plans',
    tasks: 'docs/agent/tasks',
    reports: 'docs/agent/reports',
    research: 'docs/agent/research',
    decisions: 'docs/agent/decisions',
    memory: '.tasksystem/memory',
    state: '.tasksystem/state',
  },
};

// In-memory IO for run(): captures output, optionally answers prompts.
export function fakeIO({ tty = false, replies = {} } = {}) {
  const out = { stdout: [], stderr: [], asked: [] };
  return {
    isTTY: tty,
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
    ask: async (label, def) => {
      out.asked.push({ label, def });
      return Object.prototype.hasOwnProperty.call(replies, label)
        ? replies[label] : (def || '');
    },
    out,
  };
}

export function trySymlink(target, linkPath, type = 'junction') {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false; // Windows may deny symlink creation without privilege
  }
}
