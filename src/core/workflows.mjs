// Workflow packets: read-only bundles that hand a command declaration plus
// its catalog dependencies to a host interpreter. Resource bytes are data:
// never interpreted, executed or used to claim an agent ran.
import { err } from './errors.mjs';
import {
  catalogDestRel, getResource, loadCatalog, validateProfile,
} from './catalog.mjs';
import { actionsFor, loadLimits } from './policy.mjs';
import { getTask } from './tasks.mjs';

const PROFILE_LIST_KEYS = ['skills', 'rules', 'references'];

function resolveResources(kind, ids, catalog) {
  return ids.map((id) => {
    const r = getResource(kind, id, { catalog });
    return {
      kind, id,
      path: catalogDestRel(r), // generated config-relative destination
      description: r.description,
      content: r.content.toString('utf8'),
    };
  });
}

// buildWorkflowPacket(ctx, {command, mode, taskId, host, profile='core'}).
// Read-only: returns the declared resources (content + generated paths),
// configured artifact destinations, the task when supplied, allowed actions
// and explicit capability limitations. Never runs shell or creates clients.
export function buildWorkflowPacket(ctx, input) {
  const opts = input || {};
  for (const k of Object.keys(opts)) {
    if (!['command', 'mode', 'taskId', 'host', 'profile'].includes(k)) {
      throw err('UNKNOWN_KEY', `workflow input has unknown key '${k}'`);
    }
  }
  const catalog = loadCatalog({});
  const command = getResource('command', opts.command, { catalog });

  const mode = opts.mode === undefined ? command.modes[0] : opts.mode;
  if (!Array.isArray(command.modes) || !command.modes.includes(mode)) {
    throw err('INVALID_MODE',
      `mode '${mode}' is not declared for command '${opts.command}'`);
  }
  if (opts.host !== undefined && !ctx.config.hosts.includes(opts.host)) {
    throw err('INVALID_HOST',
      `host '${opts.host}' is not selected in project config`);
  }
  const profileId = opts.profile === undefined ? 'core' : opts.profile;
  const profileEntry = getResource('profile', profileId, { catalog });
  const profile = validateProfile(profileId, profileEntry.content);

  // The core profile's dependencies ALWAYS supplement the selected one;
  // a selected profile never removes safety resources.
  const merged = { skills: [], rules: [], references: [] };
  for (const lk of PROFILE_LIST_KEYS) {
    merged[lk] = [...new Set([...profile[lk],
      ...(profileId === 'core'
        ? []
        : validateProfile('core',
          getResource('profile', 'core', { catalog }).content)[lk])])];
  }
  const commandDeps = {
    agents: command.agents || [],
    skills: command.skills || [],
    rules: command.rules || [],
    references: command.references || [],
  };

  let task = null;
  let allowedActions = null;
  if (opts.taskId !== undefined) {
    task = getTask(ctx, opts.taskId);
    allowedActions = actionsFor(task.state);
  }

  const limits = loadLimits();
  return {
    schemaVersion: 1,
    command: {
      id: command.id,
      description: command.description,
      mode,
      modes: command.modes,
      path: catalogDestRel(command),
      content: command.content.toString('utf8'),
    },
    host: opts.host ?? null,
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
    },
    paths: { ...ctx.config.paths },
    resourceRoot: ctx.configDir,
    task,
    allowedActions,
    capabilities: {
      executesProjectCommands: limits.executesProjectCommands,
      authenticatesEvidence: limits.authenticatesEvidence,
      interceptsNativeTools: limits.interceptsNativeTools,
      executesWorkflowText: false,
      interpretsResourcesAsCode: false,
      executesAgent: false,
    },
    notes: [
      'Resource contents are verbatim data for a host to interpret; the '
        + 'harness never executes them.',
      'Dependency resources supplement the selected profile; core safety '
        + 'resources always apply.',
    ],
  };
}
