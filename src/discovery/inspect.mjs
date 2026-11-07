// Read-only project discovery. No writes, no shell, no network.
// Only allowlisted manifests are opened, with size, depth and entry bounds.
import path from 'node:path';
import crypto from 'node:crypto';
import { lstatOrNull, readDirBounded, readFileLimited } from '../core/fsx.mjs';
import { resolveProjectRoot } from '../core/paths.mjs';

const MAX_DEPTH = 4;
const MAX_ENTRIES = 1000;
const MAX_MANIFEST_BYTES = 128 * 1024;

const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', '.venv', 'venv', 'target', 'dist',
  'build', 'coverage', 'legacy', '.tasksystem',
]);

const MANIFEST_STACK = new Map([
  ['package.json', 'node'],
  ['Cargo.toml', 'rust'],
  ['pyproject.toml', 'python'],
  ['go.mod', 'go'],
  ['pom.xml', 'java'],
  ['composer.json', 'php'],
  ['Gemfile', 'ruby'],
]);

const INSTRUCTION_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md']);

const LOCKFILE_PM = new Map([
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]);

const PROPOSED_SCRIPTS = ['test', 'lint', 'check', 'typecheck', 'build'];
const KNOWN_PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);

function isDotnetManifest(name) {
  return name.endsWith('.sln') || name.endsWith('.csproj');
}

function isSkippableDir(name) {
  if (EXCLUDED_DIRS.has(name)) return true;
  if (name === '.github') return false;
  return name.startsWith('.');
}

function presentLockfiles(dirAbs) {
  const found = new Set();
  for (const [name, pm] of LOCKFILE_PM) {
    const st = lstatOrNull(path.join(dirAbs, name));
    if (st && st.isFile() && !st.isSymbolicLink()) found.add(pm);
  }
  return found;
}

// package-manager resolution, per the amended decision:
// - declared known packageManager wins; conflicting lockfiles warn.
// - otherwise exactly one recognized lockfile manager wins.
// - unknown declared manager, none or ambiguous signals: no manager is
//   chosen (command:null) plus an explicit warning. Never silently npm.
function resolvePackageManager(dirAbs, pkg, warnings, relDir) {
  const at = relDir || '.';
  const declared = typeof pkg.packageManager === 'string'
    ? pkg.packageManager.split('@')[0]
    : null;
  if (declared && !KNOWN_PM.has(declared)) {
    warnings.push({
      code: 'UNKNOWN_PACKAGE_MANAGER',
      message: `unrecognized packageManager '${declared}' at ${at}`,
      path: at,
    });
    return { pm: null, ambiguous: true };
  }
  const lockPms = presentLockfiles(dirAbs);
  if (declared) {
    const conflicts = [...lockPms].filter((pm) => pm !== declared);
    if (conflicts.length > 0) {
      warnings.push({
        code: 'CONTRADICTORY_PM',
        message: `packageManager declares '${declared}' but lockfiles suggest: ${conflicts.join(', ')}`,
        path: at,
      });
    }
    return { pm: declared, ambiguous: false };
  }
  if (lockPms.size === 1) return { pm: [...lockPms][0], ambiguous: false };
  if (lockPms.size > 1) {
    warnings.push({
      code: 'CONTRADICTORY_PM',
      message: `multiple lockfiles and no packageManager field at ${at}`,
      path: at,
    });
    return { pm: null, ambiguous: true };
  }
  warnings.push({
    code: 'PACKAGE_MANAGER_UNCONFIRMED',
    message: `no packageManager field or lockfile at ${at}; manager unknown`,
    path: at,
  });
  return { pm: null, ambiguous: true };
}

function inspectPackageJson(dirAbs, relDir, content, out) {
  let pkg;
  const source = relDir ? `${relDir}/package.json` : 'package.json';
  try {
    pkg = JSON.parse(content.toString('utf8'));
  } catch {
    out.warnings.push({
      code: 'MALFORMED_JSON',
      message: 'package.json is not valid JSON; scripts not proposed',
      path: source,
    });
    return;
  }
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    out.warnings.push({
      code: 'INVALID_MANIFEST',
      message: 'package.json is not an object; scripts not proposed',
      path: source,
    });
    return;
  }
  const scripts = (pkg.scripts && typeof pkg.scripts === 'object'
    && !Array.isArray(pkg.scripts)) ? pkg.scripts : {};
  const wanted = PROPOSED_SCRIPTS.filter((name) =>
    typeof scripts[name] === 'string' && scripts[name].trim() !== '');
  if (wanted.length === 0) return;
  const { pm, ambiguous } = resolvePackageManager(dirAbs, pkg, out.warnings, relDir);
  const cwd = relDir || '.';
  for (const name of wanted) {
    out.commands.push({
      command: ambiguous ? null : `${pm} run ${name}`,
      script: name,
      cwd,
      source,
      approved: false,
    });
  }
}

export function inspectProject(projectInput) {
  const root = resolveProjectRoot(projectInput);
  const out = {
    schemaVersion: 1,
    stacks: [],
    evidence: [],
    commands: [],
    fingerprint: '',
    warnings: [],
  };
  const stacksByName = new Map();
  const fingerprintParts = [];
  let visited = 0;
  let truncated = false;
  let depthLimited = false;

  const stack = [{ dir: root, rel: '', depth: 0 }];
  while (stack.length > 0) {
    if (visited >= MAX_ENTRIES) {
      truncated = true; // budget exhausted: queued dirs are never listed
      break;
    }
    const { dir, rel, depth } = stack.pop();
    const remaining = MAX_ENTRIES - visited;
    let listing;
    try {
      listing = readDirBounded(dir, remaining);
    } catch (e) {
      out.warnings.push({
        code: 'DIR_UNREADABLE',
        message: `cannot list directory: ${e.code || e.message}`,
        path: rel || '.',
      });
      continue;
    }
    if (listing.truncated) truncated = true;
    const dirents = listing.entries
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of dirents) {
      visited += 1;
      if (dirent.isSymbolicLink()) continue; // never follow links/junctions
      const relPath = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (isSkippableDir(dirent.name)) continue;
        if (depth < MAX_DEPTH) {
          stack.push({ dir: path.join(dir, dirent.name), rel: relPath, depth: depth + 1 });
        } else {
          depthLimited = true;
        }
        continue;
      }
      if (!dirent.isFile()) continue;

      if (INSTRUCTION_FILES.has(dirent.name)) {
        out.evidence.push({ type: 'instructions', path: relPath });
        continue;
      }
      if (LOCKFILE_PM.has(dirent.name)) {
        // Presence only: lockfiles are never opened, but their existence
        // changes command proposals and therefore the fingerprint.
        out.evidence.push({ type: 'lockfile', path: relPath });
        fingerprintParts.push(JSON.stringify([relPath, 'lockfile']));
        continue;
      }
      const stackName = MANIFEST_STACK.get(dirent.name)
        || (isDotnetManifest(dirent.name) ? 'dotnet' : null);
      if (!stackName) continue;

      const absPath = path.join(dir, dirent.name);
      if (!stacksByName.has(stackName)) {
        stacksByName.set(stackName, { name: stackName, manifests: [] });
      }
      stacksByName.get(stackName).manifests.push(relPath);
      let limited;
      try {
        limited = readFileLimited(absPath, MAX_MANIFEST_BYTES);
      } catch (e) {
        out.warnings.push({
          code: 'MANIFEST_UNREADABLE',
          message: `cannot read manifest: ${e.code || e.message}`,
          path: relPath,
        });
        out.evidence.push({ type: 'manifest', path: relPath, read: false });
        continue;
      }
      if (limited.exceeded) {
        out.warnings.push({
          code: 'MANIFEST_TOO_LARGE',
          message: `manifest exceeds ${MAX_MANIFEST_BYTES} bytes; content skipped`,
          path: relPath,
        });
        out.evidence.push({ type: 'manifest', path: relPath, read: false });
        fingerprintParts.push(JSON.stringify([relPath, limited.size, null]));
        continue;
      }
      out.evidence.push({ type: 'manifest', path: relPath, read: true });
      fingerprintParts.push(JSON.stringify([relPath, limited.size, limited.content.toString('utf8')]));
      if (dirent.name === 'package.json') {
        inspectPackageJson(dir, rel, limited.content, out);
      }
    }
  }
  if (truncated) {
    out.warnings.push({
      code: 'SCAN_TRUNCATED',
      message: `entry limit ${MAX_ENTRIES} reached; scan is partial`,
    });
  }
  if (depthLimited) {
    out.warnings.push({
      code: 'SCAN_PARTIAL_DEPTH',
      message: `directories deeper than ${MAX_DEPTH} were omitted; scan is partial`,
    });
  }

  out.stacks = [...stacksByName.values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  out.fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(fingerprintParts.sort())).digest('hex');
  return out;
}
