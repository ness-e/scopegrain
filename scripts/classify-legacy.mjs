// Triage routes based on identifiers in the frozen capture, not body approval.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const inventoryURL = new URL('../catalog/legacy-inventory.json', import.meta.url);
const outputURL = new URL('../catalog/legacy-classification.json', import.meta.url);
const bytes = fs.readFileSync(inventoryURL);
const capture = JSON.parse(bytes);
const project = new Set([
  'vantadb', 'vantadb-mcp', 'vanta-design-orchestrator', 'documentation-skill',
]);
const integration = new Set([
  'academy-guide', 'ai-sdk', 'claude-api', 'audit-website',
  'browser-testing-with-devtools', 'codebase-memory', 'coordinated-web-search',
  'figma-implement-design', 'icon-generator', 'imagegen-frontend-web',
  'mcp-builder', 'notion-mcp-master', 'playwright-cli', 'ponytail',
  'react-components', 'shadcn-ui', 'stitch-design-taste', 'stitch-loop',
  'web-artifacts-builder', 'webapp-testing',
]);
const engineering = new Set([
  'api-and-interface-design', 'api-design-principles', 'brainstorming',
  'campaign-executor', 'ci-cd-and-automation', 'code-review-and-quality',
  'code-simplification', 'constraint-driven-development', 'context-engineering',
  'debugging-and-error-recovery', 'deprecation-and-migration',
  'discernment-nudge', 'documentation-and-adrs', 'doubt-driven-development',
  'full-output-enforcement', 'git-workflow-and-versioning', 'idea-refine',
  'incremental-implementation', 'interview-me', 'observability-and-instrumentation',
  'performance-optimization', 'plan-design-review', 'planning-and-task-breakdown',
  'pr-feedback-quality-gate', 'progreso', 'release-notes-one-pager',
  'review-deep', 'security-and-hardening', 'shipping-and-launch',
  'source-driven-development', 'spec-driven-development', 'systematic-debugging',
  'test-driven-development', 'unified-review', 'using-agent-skills',
  'web-research', 'writing-plans',
]);
const documents = new Set(['doc-coauthoring', 'internal-comms', 'writing-guidelines', 'xlsx']);
const data = new Set(['database-design', 'database-schema-designer']);
const content = new Set(['ai-seo', 'seo-audit', 'screenshots-marketing', 'slack-gif-creator']);
const design = new Set([
  'awesome-claude-design', 'brand-guidelines', 'brandkit', 'color-expert',
  'design-audit-orchestrator', 'design-motion-principles', 'design-systems',
  'design-taste-frontend', 'design-taste-frontend-v1', 'emil-design-eng',
  'emilkowalski-motion', 'frontend-design', 'frontend-designer',
  'frontend-ui-engineering', 'gpt-taste', 'high-end-visual-design',
  'image-to-code', 'impeccable', 'impeccable-design-polish',
  'industrial-brutalist-ui', 'interaction-design', 'interface-design',
  'minimalist-ui', 'motion', 'motion-design', 'platform-design',
  'redesign-existing-projects', 'reference-design-contract', 'responsive-craft',
  'taste-skill', 'theme-factory', 'ui-design', 'ui-ux-pro-max',
  'ux-flow-designer', 'ux-heuristics', 'visual-critique', 'visual-review',
  'web-design-guidelines', 'wireframer',
]);

function route(id) {
  if (project.has(id)) return ['project-specific', 'private-project'];
  if (integration.has(id) || id.startsWith('understand')) {
    return ['external-integration', id === 'ponytail' ? 'opencode-plugin' : 'optional-tool'];
  }
  if (/^(?:gsap-|react-|vercel-)/.test(id)
      || ['next-best-practices', 'prisma-expert', 'supabase-postgres-best-practices'].includes(id)) {
    return ['stack-specific', 'javascript-data-stack'];
  }
  if (engineering.has(id)) return ['general-engineering', 'engineering'];
  if (/^(?:a11y-|incl-)/.test(id)) return ['domain-specific', 'accessibility'];
  if (documents.has(id)) return ['domain-specific', 'documents'];
  if (data.has(id)) return ['domain-specific', 'data-modeling'];
  if (content.has(id)) return ['domain-specific', 'content-media'];
  if (design.has(id)) return ['domain-specific', 'interface-design'];
  return ['unclassified', 'requires-triage'];
}

const entries = capture.entries.filter((e) => e.kind === 'skill').map((e) => {
  const [category, family] = route(e.id);
  return {
    id: e.id, category, family,
    basis: 'identifier-triage-not-semantic-audit',
    reviewRequired: true,
    originalActivation: e.originalActivation,
    freshReplacement: e.replacement,
    capturedIndicators: e.indicators.map((x) => x.code),
  };
});
const output = {
  schemaVersion: 1,
  source: 'catalog/legacy-inventory.json',
  sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  caveat: 'Routing aid only. Categories do not certify compatibility, safety, licensing or semantic equivalence.',
  counts: Object.fromEntries([...new Set(entries.map((e) => e.category))]
    .map((category) => [category, entries.filter((e) => e.category === category).length])),
  entries,
};
fs.writeFileSync(outputURL, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({
  output: fileURLToPath(outputURL), counts: output.counts,
  unclassified: entries.filter((e) => e.category === 'unclassified').map((e) => e.id),
}) + '\n');
