// Read-only health check: validates config, paths, generated file CONTENTS,
// installed templates, discovery freshness and warnings. Executes nothing
// and never asserts that a host or service is installed.
import fs from 'node:fs';
import path from 'node:path';
import { lstatOrNull } from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { PATH_KEYS, configDirOf } from './config.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { buildInitPlan, INSTALL_ROOT } from './bootstrap.mjs';

const REQUIRED_TEMPLATES = [
  'entrypoint.md',
  'project-instructions.md',
  'task-contract.md',
  'skills/project-onboarding/SKILL.md',
  'skills/contract-execution/SKILL.md',
  'skills/independent-review/SKILL.md',
];

function statusOf(abs) {
  const st = lstatOrNull(abs);
  if (!st) return 'missing';
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  return 'file';
}

function bytesEqualOnDisk(abs, content) {
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) return false;
  const incoming = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return fs.readFileSync(abs).equals(incoming);
}

// ctx: {projectRoot, configPath, configDir, config} from resolveContext.
// A malformed config fails in resolveContext before doctor runs.
// opts.installRoot allows tests to simulate a missing-template install.
export function runDoctor(ctx, opts = {}) {
  const { projectRoot, config, configPath } = ctx;
  const installRoot = opts.installRoot || INSTALL_ROOT;
  const warnings = [];
  const checks = [];

  const push = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) warnings.push(`${name}: ${detail}`);
  };

  push('config', true, `valid configuration at ${configPath}`);

  // Required installed templates must exist to produce/verify generated files.
  let templatesOk = true;
  const templatesDir = path.join(installRoot, 'templates');
  for (const rel of REQUIRED_TEMPLATES) {
    const st = lstatOrNull(path.join(templatesDir, ...rel.split('/')));
    if (!st || !st.isFile()) {
      templatesOk = false;
      push('templates', false, `missing template ${rel}`);
    }
  }
  if (templatesOk) push('templates', true, 'required templates installed');

  for (const key of PATH_KEYS) {
    const rel = config.paths[key];
    const abs = resolveInside(projectRoot, rel, `paths.${key}`);
    const s = statusOf(abs);
    push(`paths.${key}`, s === 'directory' || s === 'missing', `${rel} -> ${s}`);
  }

  // Compare every generated file's bytes against what init would produce
  // today. config.json and discovery.json are exempt: preserved re-init
  // bytes are legitimate, and fingerprint freshness is checked separately.
  const cfgDir = configDirOf(configPath);
  const discoveryRel = cfgDir === '.' ? 'discovery.json' : `${cfgDir}/discovery.json`;
  const discoveryAbs = resolveInside(projectRoot, discoveryRel);

  // discovery.json is required as a valid record: present regular file,
  // parseable JSON, schemaVersion 1, fingerprint matching the config.
  {
    const st = lstatOrNull(discoveryAbs);
    if (!st || st.isSymbolicLink() || !st.isFile()) {
      push('discovery', false, `${discoveryRel} -> ${statusOf(discoveryAbs)}`);
    } else {
      let rec;
      try {
        rec = JSON.parse(fs.readFileSync(discoveryAbs, 'utf8'));
      } catch {
        push('discovery', false, `${discoveryRel} contains malformed JSON`);
      }
      if (rec !== undefined) {
        if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
          push('discovery', false, `${discoveryRel} must contain an object`);
        } else if (rec.schemaVersion !== 1) {
          push('discovery', false, `${discoveryRel} schemaVersion is not 1`);
        } else if (rec.fingerprint !== config.discovery.fingerprint) {
          push('discovery', false,
            `${discoveryRel} fingerprint does not match config`);
        } else {
          push('discovery', true, `${discoveryRel} valid record`);
        }
      }
    }
  }

  let expected = [];
  try {
    const plan = buildInitPlan({
      projectRoot,
      configRel: configPath,
      config,
      configContent: fs.readFileSync(resolveInside(projectRoot, configPath)),
      discovery: null,
      discoveryContent: (st => (st && st.isFile() && !st.isSymbolicLink()
        ? fs.readFileSync(discoveryAbs) : undefined))(lstatOrNull(discoveryAbs)),
    });
    expected = plan.files;
  } catch (e) {
    push('generated', false, `cannot regenerate expected files: ${e.message}`);
  }
  for (const f of expected) {
    if (f.rel === configPath || f.rel === discoveryRel) continue;
    const abs = resolveInside(projectRoot, f.rel);
    const s = statusOf(abs);
    if (s !== 'file') {
      push('generated', false, `${f.rel} -> ${s}`);
    } else if (!bytesEqualOnDisk(abs, f.content)) {
      push('generated', false, `${f.rel} -> content differs from generated fragment`);
    }
  }
  if (expected.length > 0
      && !warnings.some((w) => w.startsWith('generated'))) {
    push('generated', true, 'generated files match current fragments');
  }

  let current = null;
  try {
    current = inspectProject(projectRoot);
  } catch (e) {
    warnings.push(`discovery failed: ${e.message}`);
  }
  if (current) {
    for (const w of current.warnings) {
      warnings.push(`discovery:${w.code} ${w.message}`);
    }
  }
  const changedDiscovery = !!current
    && current.fingerprint !== config.discovery.fingerprint;
  if (changedDiscovery) {
    warnings.push('manifest fingerprint changed since init; consider re-discovery');
  }

  const ok = warnings.length === 0;
  return {
    schemaVersion: 1,
    status: ok ? 'ready' : 'needs-attention',
    changedDiscovery,
    checks,
    warnings,
  };
}
