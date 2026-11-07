// Mechanical provenance capture, not a semantic, security or license audit.
// No archived instruction is imported or executed; raw bodies never enter output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'legacy', 'opencode');
const maxBytes = 1048576;
const agentMap = {
  'vanta-lead': 'lead', 'vanta-arch': 'architect',
  'vanta-worker': 'implementer', 'vanta-engine': 'algorithm-specialist',
  'vanta-audit': 'security-auditor', 'vanta-chaos': 'resilience-tester',
  'vanta-tuner': 'performance-engineer', 'vanta-docs': 'documentation',
  'vanta-research': 'researcher', 'vanta-review': 'reviewer',
  'vanta-harness': 'harness-maintainer',
};
const indicators = [
  ['project-domain', /\bvanta(?:db|-)/i],
  ['opencode-path', /\.opencode[\\/]/i],
  ['machine-path', /[A-Za-z]:[\\/]/],
  ['global-dependency', /~[\\/]|\.agents[\\/]|homedir/],
  ['native-agent-format', /^\s*(?:permission:|subagent_type:|mode:\s*subagent)/],
  ['execution-api', /\b(?:execSync|spawnSync|child_process|eval)\b/],
  ['external-link', /https?:\/\//],
];

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safePath(base, rel) {
  if (!rel || path.isAbsolute(rel) || rel.includes('\\')
      || rel.split('/').some((s) => !s || s === '.' || s === '..')) {
    throw new Error(`unsafe relative path: ${rel}`);
  }
  let p = base;
  for (const segment of rel.split('/')) {
    p = path.join(p, segment);
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) {
      throw new Error(`link is not inventoried: ${rel}`);
    }
  }
  return p;
}

function list(rel) {
  return fs.readdirSync(safePath(source, rel), { withFileTypes: true })
    .filter((e) => !e.isSymbolicLink())
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function boundedRead(abs) {
  const fd = fs.openSync(abs, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error(`non-file or file exceeds inventory limit: ${abs}`);
    }
    const buf = Buffer.alloc(stat.size);
    let n = 0;
    while (n < buf.length) {
      const read = fs.readSync(fd, buf, n, buf.length - n, n);
      if (read === 0) throw new Error('source changed during inventory');
      n += read;
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

const catalog = JSON.parse(boundedRead(path.join(root, 'catalog', 'manifest.json')));
const active = new Map(catalog.entries.map((e) => [`${e.kind}:${e.id}`, e.path]));
const entries = [];

function capture(kind, rel, id) {
  const abs = safePath(source, rel);
  const bytes = boundedRead(abs);
  const text = bytes.toString('utf8');
  const flags = [];
  const lines = text.split(/\r?\n/);
  for (const [code, pattern] of indicators) {
    const positions = [];
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) positions.push(i + 1);
    }
    if (positions.length) {
      flags.push({ code, count: positions.length, lines: positions.slice(0, 64) });
    }
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const declaredLicense = !!fm && /^\s*license:/m.test(fm[1]);
  const adjacentLicenses = fs.readdirSync(path.dirname(abs))
    .filter((n) => /^(?:license|copying|notice)(?:\.[a-z0-9]+)?$/i.test(n))
    .sort();
  const replacementId = kind === 'agent' ? agentMap[id] : id;
  entries.push({
    kind, id, source: `legacy/opencode/${rel}`,
    bytes: bytes.length, sha256: hash(bytes),
    reviewStatus: 'mechanical-inventory-only',
    originalActivation: 'blocked',
    redistribution: 'unreviewed',
    licenseEvidence: { frontmatterDeclaration: declaredLicense, adjacentFiles: adjacentLicenses },
    replacement: active.get(`${kind}:${replacementId}`) || null,
    replacementMeaning: 'fresh-portable-procedure-not-verbatim-equivalence',
    indicators: flags,
  });
}

for (const [kind, folder] of [
  ['command', 'commands'], ['agent', 'agents'], ['rule', 'rules'],
  ['reference', 'references'],
]) {
  for (const e of list(folder)) {
    if (e.isFile() && e.name.endsWith('.md')
        && !(folder === 'rules' && e.name === 'README.md')) {
      capture(kind, `${folder}/${e.name}`, e.name.slice(0, -3));
    }
  }
}
const resourceOnly = [];
for (const e of list('skills')) {
  if (!e.isDirectory()) continue;
  const rel = `skills/${e.name}/SKILL.md`;
  const abs = safePath(source, rel);
  if (fs.existsSync(abs)) capture('skill', rel, e.name);
  else resourceOnly.push({ path: `legacy/opencode/skills/${e.name}`, status: 'resource-only-no-SKILL.md' });
}
for (const [kind, folder, extension] of [
  ['workflow', 'task-system/workflows', '.json'],
  ['plugin', 'plugins', '.ts'],
  ['mcp-profile', 'mcp-profiles', '.json'],
]) {
  for (const e of list(folder)) {
    if (e.isFile() && e.name.endsWith(extension)) {
      capture(kind, `${folder}/${e.name}`, e.name.slice(0, -extension.length));
    }
  }
}
entries.sort((a, b) => {
  const x = `${a.kind}:${a.id}`, y = `${b.kind}:${b.id}`;
  return x < y ? -1 : x > y ? 1 : 0;
});
const result = {
  schemaVersion: 1,
  method: 'bounded-local-primary-files-no-execution',
  claim: 'inventory-and-review-indicators-only-not-semantic-audit',
  privateHistory: 'preserved-locally-not-read-or-published',
  sourceBodiesIncluded: false,
  counts: Object.fromEntries([...new Set(entries.map((e) => e.kind))]
    .map((kind) => [kind, entries.filter((e) => e.kind === kind).length])),
  resourceOnly,
  entries,
};
const content = JSON.stringify(result, null, 2) + '\n';
const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stdout.write(content);
} else if (argv.length === 2 && argv[0] === '--output') {
  const output = safePath(root, argv[1]);
  fs.writeFileSync(output, content, { flag: 'wx' });
  process.stdout.write(JSON.stringify({
    output: argv[1], sha256: hash(content), counts: result.counts,
    resourceOnly: resourceOnly.length,
  }) + '\n');
} else {
  throw new Error('usage: node scripts/inventory-legacy.mjs [--output REL]');
}
