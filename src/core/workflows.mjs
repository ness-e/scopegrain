// Workflow packets: read-only bundles that hand a command declaration plus
// its resolved dependencies to a host. Project-bound: content comes from
// the workspace snapshot, never silently from the installation.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import {
  catalogDestRel, getResource, loadWorkspaceCatalog, resolveInvocation,
  validateProfile,
} from './catalog.mjs';
import { loadLimits, loadPolicy } from './policy.mjs';
import { getTask } from './tasks.mjs';
import { KNOWN_HOSTS, validateMethodologyMode } from './config.mjs';
import { evaluateTaskActions } from './methodology.mjs';

const ALLOWED = new Set([
  'command', 'mode', 'taskId', 'host', 'profile', 'interaction',
]);
const INTERACTIONS = new Set(['direct', 'guided']);

function resolveResources(kind, ids, catalog) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const r = getResource(kind, id, { catalog });
    const canon = r.canonicalId ?? r.id;
    const k = `${kind}/${canon}`.toLowerCase();
    if (seen.has(k)) continue; // alias+target dedupe post-resolution
    seen.add(k);
    out.push({
      kind, id: canon,
      description: r.description, path: catalogDestRel(r),
      content: r.content.toString('utf8'),
    });
  }
  return out;
}

// buildWorkflowPacket(ctx, {command, mode, taskId, host, profile='core',
//   interaction='direct'}).
export function buildWorkflowPacket(ctx, opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw err('INVALID_ARGS', 'workflow options must be an object');
  }
  for (const k of Object.keys(opts)) {
    if (!ALLOWED.has(k)) {
      throw err('UNKNOWN_KEY', `unknown workflow option '${k}'`);
    }
  }
  const catalog = loadWorkspaceCatalog(ctx);
  const inv = resolveInvocation(catalog, {
    command: opts.command, mode: opts.mode,
  });
  const interaction = opts.interaction ?? inv.parameters.interaction ?? 'direct';
  if (!INTERACTIONS.has(interaction)) {
    throw err('INVALID_ARGS',
      `interaction must be one of: ${[...INTERACTIONS].join(', ')}`);
  }
  if (inv.parameters.interaction === 'guided' && opts.interaction === 'direct') {
    throw err('INVALID_ARGS',
      `alias '${opts.command}' requires guided interaction; direct conflicts`);
  }
  const command = getResource('command', inv.canonicalId, { catalog });
  const mode = inv.requestedMode;
  const profileId = opts.profile === undefined ? 'core' : opts.profile;
  if (typeof profileId !== 'string' || profileId === '') {
    throw err('INVALID_PROFILE', 'profile must be a non-empty id');
  }
  const profileEntry = getResource('profile', profileId, { catalog });
  const profile = validateProfile(
    profileEntry.canonicalId ?? profileEntry.id, profileEntry.content);
  const coreEntry = getResource('profile', 'core', { catalog });
  const core = validateProfile('core', coreEntry.content);
  // Core profile always supplements the selected profile.
  const merged = { skills: [], rules: [], references: [] };
  for (const lk of ['skills', 'rules', 'references']) {
    merged[lk] = [...new Set([...profile[lk], ...core[lk]])];
  }
  const commandDeps = {
    agents: command.agents || [],
    skills: command.skills || [],
    rules: command.rules || [],
    references: command.references || [],
    prompts: command.prompts || [],
    mcps: command.mcps || [],
  };
  if (opts.host !== undefined && !ctx.config.hosts.includes(opts.host)) {
    throw err('INVALID_HOST', `host '${opts.host}' is not selected`);
  }
  let task = null;
  let allowedActions = null;
  const methodology = {
    mode: validateMethodologyMode(ctx.config.methodology, 'config.methodology'),
    available: true, taskCheck: null,
    authenticatesEvidence: false, interceptsNativeTools: false,
  };
  if (opts.taskId !== undefined) {
    task = getTask(ctx, opts.taskId);
    const effective = evaluateTaskActions(ctx, task);
    allowedActions = effective.permitted;
    methodology.taskCheck = effective.methodology;
  }
  const alias = catalog.aliases.find(
    (a) => a.kind === 'command'
      && a.id.toLowerCase() === String(opts.command).toLowerCase());
  const limits = loadLimits();
  const packet = {
    schemaVersion: 1,
    authority: {
      resourceSource: catalog.snapshot ? 'workspace-snapshot' : 'installation',
      snapshotIntegrity: catalog.integrity,
      runtimePolicySource: 'installed-runtime',
      policyDigest: crypto.createHash('sha256')
        .update(JSON.stringify(loadPolicy())).digest('hex'),
    },
    warnings: catalog.warnings,
    command: {
      id: opts.command,
      requestedMode: inv.requestedMode,
      canonicalId: inv.canonicalId,
      canonicalMode: inv.canonicalMode,
      canonicalModes: command.modes,
      deprecated: inv.deprecated,
      parameters: inv.parameters,
      mode,
      modes: alias ? [...new Set(catalog.aliases
        .filter((a) => a.id === alias.id).map((a) => a.mode))] : command.modes,
      description: command.description,
      path: catalogDestRel(command),
      content: command.content.toString('utf8'),
    },
    interaction,
    host: opts.host ?? null,
    locale: ctx.config.locale,
    profile: {
      id: profile.id,
      description: profile.description,
      path: catalogDestRel(profileEntry),
      activation: profile.activation,
      externalServices: profile.externalServices,
    },
    resources: {
      agents: resolveResources('agent', commandDeps.agents, catalog),
      skills: resolveResources('skill',
        [...new Set([...commandDeps.skills, ...merged.skills])], catalog),
      rules: resolveResources('rule',
        [...new Set([...commandDeps.rules, ...merged.rules])], catalog),
      references: resolveResources('reference',
        [...new Set([...commandDeps.references, ...merged.references])],
        catalog),
      prompts: resolveResources('prompt', commandDeps.prompts, catalog),
      mcps: resolveResources('mcp', commandDeps.mcps, catalog),
    },
    paths: { ...ctx.config.paths },
    resourceRoot: ctx.configDir,
    task,
    allowedActions,
    methodology,
    capabilities: {
      executesProjectCommands: limits.executesProjectCommands,
      authenticatesEvidence: limits.authenticatesEvidence,
      interceptsNativeTools: limits.interceptsNativeTools,
      executesWorkflowText: false,
      interpretsResourcesAsCode: false,
      executesAgent: false,
      appliesHostRoots: false,
      callsModels: false,
      networkAccess: false,
    },
    notes: [
      'Resource contents are verbatim data for a host to interpret; the '
        + 'harness never executes them.',
      'Dependency resources supplement the selected profile; core safety '
        + 'resources always apply.',
    ],
  };
  const bytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  if (bytes > limits.maxDocumentBytes) {
    throw err('CONTEXT_TOO_LARGE',
      `workflow packet exceeds ${limits.maxDocumentBytes} bytes`);
  }
  return packet;
}
