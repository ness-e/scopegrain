// CLI command surface. All results go to stdout as JSON; failures go to
// stderr as {error:{code,message}} with a non-zero exit code.
import path from 'node:path';
import readline from 'node:readline/promises';
import { err, toErrorPayload } from './core/errors.mjs';
import { DEFAULT_CONFIG_PATH, DEFAULT_PATH_PROPOSALS, KNOWN_HOSTS, PATH_KEYS, VERSIONING_KEYS, loadConfig, validateMethodologyMode } from './core/config.mjs';
import { resolveContext } from './core/context.mjs';
import { resolveProjectRoot } from './core/paths.mjs';
import { prepareInit, applyPlan, preflightPlan } from './core/bootstrap.mjs';
import { runDoctor } from './core/doctor.mjs';
import { inspectProject } from './discovery/inspect.mjs';
import { createTask, getTask, listTasks } from './core/tasks.mjs';
import { transitionTask, checkAction } from './core/transition.mjs';
import { readFileLimited } from './core/fsx.mjs';
import fs from 'node:fs';
import { loadLimits, loadMethodologyPolicy } from './core/policy.mjs';
import { checkCatalog, getResource, legacyGet, legacyList, loadCatalog, loadWorkspaceCatalog } from './core/catalog.mjs';
import { applyResourceRestore, diagnoseResource, findResources, prepareResourceRestore } from './core/resource-recovery.mjs';
import { buildWorkflowPacket } from './core/workflows.mjs';
import {
  getPlan, listPlans, nextPlanTasks, preparePlan,
} from './core/plans.mjs';
import {
  getArtifact, listArtifacts, prepareArtifact,
} from './core/artifacts.mjs';
import {
  ensureSessionsDir, getSession, prepareSession, prepareSessionRecord,
  recordSession, resumeSession,
} from './core/sessions.mjs';

const PATH_LABELS = {
  plans: 'Ruta de planes',
  tasks: 'Ruta de tareas',
  reports: 'Ruta de informes',
  research: 'Ruta de investigaciones',
  decisions: 'Ruta de decisiones',
  memory: 'Ruta de memoria',
  state: 'Ruta de estado operativo',
};

const VALUE_FLAGS = new Set([
  '--project', '--config', '--answers', '--evidence',
  '--title', '--contract', '--author', '--scope', '--revision',
  '--input', '--task', '--mode', '--host', '--profile', '--limit',
  '--query', '--interaction',
]);
const BOOL_FLAGS = new Set(['--apply', '--help']);
const REJECTED_FLAGS = new Set(['--yes', '--force']);

// Per-command flag whitelist and exact positional count (after 'task <sub>').
const COMMANDS = {
  inspect: { flags: ['--project'], pos: 0, usage: 'inspect --project PATH' },
  init: {
    flags: ['--project', '--config', '--answers', '--apply'],
    pos: 0,
    usage: 'init --project PATH [--config REL] [--answers FILE] [--apply]',
  },
  doctor: {
    flags: ['--project', '--config'],
    pos: 0,
    usage: 'doctor --project PATH [--config REL]',
  },
  mcp: {
    flags: ['--project', '--config'],
    pos: 0,
    usage: 'mcp --project PATH [--config REL]',
  },
  'task create': {
    flags: ['--project', '--config', '--title', '--contract', '--author', '--scope'],
    pos: 0,
    usage: 'task create --project PATH --title T --contract C --author A [--scope a,b]',
  },
  'task list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'task list --project PATH',
  },
  'task show': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'task show --project PATH ID',
  },
  'task transition': {
    flags: ['--project', '--config', '--revision', '--evidence'], pos: 2,
    usage: 'task transition --project PATH ID STATE --revision N [--evidence FILE]',
  },
  'task check-action': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'task check-action --project PATH ID ACTION',
  },
  'catalog list': {
    flags: ['--project', '--config'], pos: -1,
    usage: 'catalog list [KIND] [--project PATH]',
  },
  'catalog show': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'catalog show KIND ID [--project PATH]',
  },
  'catalog check': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'catalog check [--project PATH]',
  },
  'resource search': {
    flags: ['--project', '--config', '--query'], pos: -1,
    usage: 'resource search [KIND] --project PATH [--query Q]',
  },
  'resource diagnose': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'resource diagnose KIND ID --project PATH',
  },
  'resource restore-plan': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'resource restore-plan --project PATH --input FILE',
  },
  'resource restore': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'resource restore --project PATH --input FILE [--apply]',
  },
  'catalog legacy': {
    flags: [], pos: -1,
    usage: 'catalog legacy [KIND]  (frozen provenance metadata only)',
  },
  'catalog legacy-show': {
    flags: [], pos: 2,
    usage: 'catalog legacy-show KIND ID',
  },
  workflow: {
    flags: ['--project', '--config', '--mode', '--task', '--host', '--profile', '--interaction'],
    pos: 1,
    usage: 'workflow COMMAND [--mode M] [--task UUID] [--host H] [--profile ID] [--interaction direct|guided]',
  },
  'plan create': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'plan create --project PATH --input FILE [--apply]',
  },
  'plan list': { flags: ['--project', '--config'], pos: 0, usage: 'plan list' },
  'plan show': {
    flags: ['--project', '--config'], pos: 1, usage: 'plan show KEY',
  },
  'plan next': {
    flags: ['--project', '--config'], pos: 1, usage: 'plan next KEY',
  },
  'artifact add': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 1,
    usage: 'artifact add KIND --input FILE [--apply]',
  },
  'artifact list': {
    flags: ['--project', '--config'], pos: 1, usage: 'artifact list KIND',
  },
  'artifact show': {
    flags: ['--project', '--config'], pos: 2, usage: 'artifact show KIND UUID',
  },
  'session create': {
    flags: ['--project', '--config', '--task', '--limit', '--apply'], pos: 0,
    usage: 'session create --task UUID --limit N [--apply]',
  },
  'session show': {
    flags: ['--project', '--config'], pos: 1, usage: 'session show UUID',
  },
  'session record': {
    flags: ['--project', '--config', '--revision', '--input', '--apply'], pos: 1,
    usage: 'session record UUID --revision N --input FILE [--apply]',
  },
  'session resume': {
    flags: ['--project', '--config'], pos: 1, usage: 'session resume UUID',
  },
};

// Aliases are derived from canonical catalog command ids at dispatch time;
// the flag set is fixed by the settled interface.
const WORKFLOW_ALIAS_FLAGS = [
  '--project', '--config', '--mode', '--task', '--host', '--profile',
  '--interaction',
];

function helpResult() {
  return {
    usage: 'tasksystem <command> [options]  |  tasksystem --help',
    commands: Object.entries(COMMANDS).map(([name, c]) => ({
      command: c.usage,
      description: name,
    })),
    notes: [
      '--yes and --force are not supported; confirmation is always explicit',
      'results are JSON on stdout; errors are JSON on stderr with exit code 1',
    ],
  };
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REJECTED_FLAGS.has(a)) {
      throw err('INVALID_ARGS',
        `${a} is not supported; confirmation is always explicit`);
    }
    if (BOOL_FLAGS.has(a)) {
      flags[a] = true;
    } else if (VALUE_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw err('INVALID_ARGS', `${a} requires a value`);
      }
      flags[a] = argv[++i];
    } else if (a.startsWith('--')) {
      throw err('INVALID_ARGS', `unknown flag ${a}`);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function requireFlag(flags, name) {
  if (!flags[name]) throw err('INVALID_ARGS', `${name} is required`);
  return flags[name];
}

// CLI JSON inputs are bounded by the authored document limit.
function readInputFile(file, label) {
  const abs = path.resolve(file);
  const st = fs.lstatSync(abs);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw err('READ_FAILED', `${label} is not a regular file: ${abs}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('INPUT_TOO_LARGE',
      `${label} exceeds ${loadLimits().maxDocumentBytes} bytes`);
  }
  try {
    return JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('MALFORMED_JSON', `malformed JSON in ${label}: ${abs}`);
  }
}

function validateEvidenceArg(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw err('INVALID_EVIDENCE', 'evidence file must contain a JSON object');
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'verification' && key !== 'review') {
      throw err('INVALID_EVIDENCE',
        `evidence file may only contain verification/review, got '${key}'`);
    }
  }
  return raw;
}

// Interactive defaults prefer an existing valid config over generic
// proposals, so re-init never conflicts with saved preferences.
async function askInteractive(io, projectRoot, configFlag, existing) {
  const answers = {};
  answers.name = await io.ask('Nombre del proyecto',
    existing ? existing.project.name : path.basename(projectRoot));
  answers.locale = await io.ask('Idioma (es/en)',
    existing ? existing.locale : 'es');
  const hostList = KNOWN_HOSTS.join(',');
  const hostsRaw = await io.ask(`Anfitriones (${hostList})`,
    existing ? existing.hosts.join(',') : hostList);
  answers.hosts = hostsRaw.split(',').map((h) => h.trim()).filter(Boolean);
  // Methodology question: existing normalized mode wins, otherwise the
  // authored interactive default (organic-sdd). Re-prompt on invalid.
  const existingMode = existing
    ? validateMethodologyMode(existing.methodology) : null;
  const modeDefault = existingMode
    ?? loadMethodologyPolicy().interactiveDefault;
  for (;;) {
    const reply = (await io.ask(
      'Metodologia: manual (V1), organic-sdd (proporcional), sdd (formal)',
      modeDefault)).trim();
    if (loadMethodologyPolicy().modes.includes(reply)) {
      answers.methodology = reply;
      break;
    }
    io.stderr('Metodo invalido: use manual, organic-sdd o sdd.');
  }
  const configRel = await io.ask('Ruta de configuracion',
    configFlag || DEFAULT_CONFIG_PATH);
  answers.paths = {};
  for (const key of PATH_KEYS) {
    answers.paths[key] = await io.ask(PATH_LABELS[key],
      existing ? existing.paths[key] : DEFAULT_PATH_PROPOSALS[key]);
  }
  // Optional versioning: eight yes/no questions, never guessed defaults.
  answers.versioning = {};
  for (const key of VERSIONING_KEYS) {
    const def = existing ? (existing.versioning[key] ? 'yes' : 'no') : 'no';
    let reply;
    for (;;) {
      reply = (await io.ask(`Versionar ${key}? (yes/no)`, def))
        .trim().toLowerCase();
      if (reply === 'yes' || reply === 'no') break;
      io.stderr('responda yes o no');
    }
    answers.versioning[key] = reply === 'yes';
  }
  return { answers, configRel };
}

function planJson(prepared) {
  return {
    files: prepared.files.map((f) => ({ path: f.rel, action: f.action })),
    discovery: {
      stacks: prepared.discovery.stacks,
      commands: prepared.discovery.commands,
      fingerprint: prepared.discovery.fingerprint,
    },
    methodology: prepared.config.methodology,
    warnings: [
      ...(prepared.warnings ?? []),
      ...(prepared.discovery.warnings ?? []),
    ],
  };
}

async function cmdInit(flags, io) {
  const projectRoot = resolveProjectRoot(requireFlag(flags, '--project'));
  let answers;
  let configRel = flags['--config'] || null;
  const interactive = !flags['--answers'];
  let existing = null;
  if (interactive) {
    if (!io.isTTY) {
      throw err('INTERACTIVE_REQUIRED',
        'init without --answers requires a terminal; no implicit writes');
    }
    const cfgCandidate = configRel || DEFAULT_CONFIG_PATH;
    try {
      existing = loadConfig(projectRoot, cfgCandidate).config;
    } catch (e) {
      if (e.code !== 'CONFIG_NOT_FOUND') throw e;
    }
    const got = await askInteractive(io, projectRoot, configRel, existing);
    answers = got.answers;
    configRel = got.configRel;
  } else {
    answers = readInputFile(flags['--answers'], 'answers file');
  }
  const prepared = prepareInit({ projectRoot, configRel, answers });
  if (interactive) {
    io.stdout(JSON.stringify({ mode: 'plan', ...planJson(prepared) }, null, 2));
    const confirm = await io.ask('Crear estos archivos? (yes/no)', 'no');
    if (confirm.trim().toLowerCase() !== 'yes') {
      return { mode: 'dry-run', applied: false };
    }
    const result = applyPlan(projectRoot, prepared.files);
    return { mode: 'applied', applied: true, ...result };
  }
  if (flags['--apply']) {
    const result = applyPlan(projectRoot, prepared.files);
    return { mode: 'applied', applied: true, ...result };
  }
  return { mode: 'dry-run', applied: false, ...planJson(prepared) };
}

async function cmdTask(sub, positional, flags, io) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const scope = flags['--scope']
      ? flags['--scope'].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return createTask(ctx, {
      title: requireFlag(flags, '--title'),
      contract: requireFlag(flags, '--contract'),
      authorContext: requireFlag(flags, '--author'),
      scope,
    });
  }
  if (sub === 'list') return listTasks(ctx);
  if (sub === 'show') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task show requires exactly one ID');
    }
    return getTask(ctx, positional[0]);
  }
  if (sub === 'transition') {
    if (positional.length !== 2) {
      throw err('INVALID_ARGS', 'task transition requires ID and STATE');
    }
    if (!flags['--revision']) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const expectedRevision = decimalInt(flags['--revision'], '--revision');
    const evidence = flags['--evidence']
      ? validateEvidenceArg(readInputFile(flags['--evidence'], 'evidence file'))
      : {};
    return transitionTask(ctx, {
      id: positional[0],
      to: positional[1],
      expectedRevision,
      ...evidence,
    });
  }
  if (sub === 'check-action') {
    if (positional.length !== 2) {
      throw err('INVALID_ARGS', 'task check-action requires ID and ACTION');
    }
    return checkAction(ctx, positional[0], positional[1]);
  }
  throw err('INVALID_ARGS', `unknown task subcommand '${sub}'`);
}

// Strict non-negative decimal parsing for CLI integer flags.
function decimalInt(value, label) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw err('INVALID_ARGS', `${label} must be a non-negative decimal integer`);
  }
  return Number(value);
}

function cmdCatalog(sub, positional, flags) {
  if (flags['--config'] && !flags['--project']) {
    throw err('INVALID_ARGS', '--config requires --project');
  }
  // --project binds to the workspace snapshot; otherwise installation
  // (labelled so the two sources are never confused).
  const ctx = flags['--project']
    ? resolveContext({ project: flags['--project'], config: flags['--config'] })
    : null;
  const bound = ctx ? loadWorkspaceCatalog(ctx) : null;
  const source = ctx ? 'workspace-snapshot' : 'installation';
  if (sub === 'legacy') {
    return { source, ...legacyList({ kind: positional[0] }, {}) };
  }
  if (sub === 'legacy-show') {
    return { source, ...legacyGet(positional[0], positional[1], {}) };
  }
  if (sub === 'list') {
    const catalog = bound ?? loadCatalog({});
    const kind = positional[0];
    const entries = kind
      ? catalog.entries.filter((e) => e.kind === kind)
      : catalog.entries;
    if (kind && !catalog.entries.some((e) => e.kind === kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${kind}'`);
    }
    return {
      source,
      entries: entries.map(({ kind: k, id, description, path: p }) =>
        ({ kind: k, id, description, path: p })),
      aliases: (catalog.aliases ?? []).map((a) => ({
        kind: a.kind, id: a.id, mode: a.mode ?? null,
        default: a.default === true, target: a.target,
        targetMode: a.targetMode ?? null, parameters: a.parameters ?? {},
      })),
    };
  }
  if (sub === 'show') {
    const r = bound
      ? getResource(positional[0], positional[1], { catalog: bound })
      : getResource(positional[0], positional[1], {});
    return {
      source,
      kind: r.kind, id: r.id, path: r.path,
      requestedId: r.requestedId, canonicalId: r.canonicalId,
      resolvedVia: r.resolvedVia,
      description: r.description,
      content: r.content.toString('utf8'),
    };
  }
  if (sub === 'check') {
    const report = bound
      ? { ok: true, issues: [], entries: bound.entries.length,
          integrity: bound.integrity, warnings: bound.warnings }
      : checkCatalog({});
    if (!report.ok) {
      throw err('CATALOG_INVALID',
        `catalog check failed: ${report.issues.map((i) => i.message).join(' | ')}`);
    }
    return { source, ...report };
  }
  throw err('INVALID_ARGS', `unknown catalog subcommand '${sub}'`);
}

function cmdResource(sub, rest, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (sub === 'search') {
    return findResources(ctx, { kind: rest[0], query: flags['--query'] });
  }
  if (sub === 'diagnose') {
    return diagnoseResource(ctx, { kind: rest[0], id: rest[1] });
  }
  if (!flags['--input']) {
    throw err('INVALID_ARGS', `${sub} requires --input FILE`);
  }
  const input = readInputFile(flags['--input'], 'resource input');
  if (sub === 'restore-plan') {
    return prepareResourceRestore(ctx, input);
  }
  if (sub === 'restore') {
    if (flags['--apply'] !== true) {
      return { mode: 'dry-run', ...prepareResourceRestore(ctx, input) };
    }
    return { mode: 'apply', ...applyResourceRestore(ctx, input) };
  }
  throw err('INVALID_ARGS', `unknown resource subcommand '${sub}'`);
}

function cmdWorkflow(command, flags) {
  return buildWorkflowPacket(resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  }), {
    command,
    mode: flags['--mode'],
    taskId: flags['--task'],
    host: flags['--host'],
    profile: flags['--profile'],
    interaction: flags['--interaction'],
  });
}

function cmdPlan(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const input = readInputFile(requireFlag(flags, '--input'), 'plan input');
    const prepared = preparePlan(ctx, input);
    const planned = preflightPlan(ctx.projectRoot, prepared.files);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false, plan: prepared.plan,
        files: planned.map((f) => ({ path: f.rel, action: f.action })),
      };
    }
    const result = applyPlan(ctx.projectRoot, planned);
    return { mode: 'applied', applied: true, plan: prepared.plan, ...result };
  }
  if (sub === 'list') return listPlans(ctx);
  if (sub === 'show') return getPlan(ctx, positional[0]);
  if (sub === 'next') return { tasks: nextPlanTasks(ctx, positional[0]) };
  throw err('INVALID_ARGS', `unknown plan subcommand '${sub}'`);
}

function cmdArtifact(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'add') {
    const input = readInputFile(requireFlag(flags, '--input'), 'artifact input');
    const prepared = prepareArtifact(ctx, positional[0], input);
    const planned = preflightPlan(ctx.projectRoot, [prepared.file]);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false, artifact: prepared.artifact,
        files: planned.map((f) => ({ path: f.rel, action: f.action })),
      };
    }
    const result = applyPlan(ctx.projectRoot, planned);
    return {
      mode: 'applied', applied: true, artifact: prepared.artifact, ...result,
    };
  }
  if (sub === 'list') return listArtifacts(ctx, positional[0]);
  if (sub === 'show') return getArtifact(ctx, positional[0], positional[1]);
  throw err('INVALID_ARGS', `unknown artifact subcommand '${sub}'`);
}

function cmdSession(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const prepared = prepareSession(ctx, {
      taskId: requireFlag(flags, '--task'),
      limit: decimalInt(requireFlag(flags, '--limit'), '--limit'),
    });
    const planned = preflightPlan(ctx.projectRoot, [prepared.file]);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false, session: prepared.session,
        files: planned.map((f) => ({ path: f.rel, action: f.action })),
      };
    }
    ensureSessionsDir(ctx);
    const result = applyPlan(ctx.projectRoot, planned);
    return {
      mode: 'applied', applied: true, session: prepared.session, ...result,
    };
  }
  if (sub === 'show') return getSession(ctx, positional[0]);
  if (sub === 'record') {
    const input = readInputFile(requireFlag(flags, '--input'), 'record input');
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw err('INVALID_SESSION', 'record input must be an object');
    }
    for (const k of Object.keys(input)) {
      if (!['action', 'evidence', 'context'].includes(k)) {
        throw err('UNKNOWN_KEY', `record input has unknown key '${k}'`);
      }
    }
    const recordInput = {
      id: positional[0],
      expectedRevision: decimalInt(
        requireFlag(flags, '--revision'), '--revision'),
      action: input.action,
      evidence: input.evidence,
      context: input.context,
    };
    // Dry-run validates against CURRENT state exactly like apply does.
    const prep = prepareSessionRecord(ctx, recordInput);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        session: { id: prep.session.id, used: prep.session.used,
          limit: prep.session.limit, revision: prep.session.revision },
      };
    }
    return recordSession(ctx, recordInput);
  }
  if (sub === 'resume') return resumeSession(ctx, positional[0]);
  throw err('INVALID_ARGS', `unknown session subcommand '${sub}'`);
}

export async function run(argv, io) {
  try {

    const { flags, positional } = parseArgs(argv);
    if (flags['--help'] || positional.length === 0) {
      io.stdout(JSON.stringify(helpResult(), null, 2));
      return 0;
    }
    const GROUPED = new Set(['task', 'catalog', 'plan', 'artifact', 'session', 'resource']);
    let cmdKey;
    let spec;
    let aliasCommand = null;
    if (GROUPED.has(positional[0])) {
      cmdKey = `${positional[0]} ${positional[1] || ''}`.trim();
      spec = COMMANDS[cmdKey];
    } else if (Object.hasOwn(COMMANDS, positional[0])) {
      cmdKey = positional[0];
      spec = COMMANDS[cmdKey];
    } else {
      // Aliases derive from canonical catalog command ids; catalog is only
      // loaded on this path so inspect/init stay independent of it. With
      // --project the alias set comes from the workspace snapshot.
      const cat = flags['--project']
        ? loadWorkspaceCatalog(resolveContext({
          project: flags['--project'], config: flags['--config'] }))
        : loadCatalog({});
      if (cat.byKey.has(`command/${positional[0]}`.toLowerCase())
          || cat.aliases?.some(
            (a) => a.kind === 'command'
              && a.id.toLowerCase() === positional[0].toLowerCase())) {
        aliasCommand = positional[0];
        cmdKey = positional[0];
        spec = { flags: WORKFLOW_ALIAS_FLAGS, pos: 0,
          usage: `${positional[0]} --project PATH [--mode M] [--task UUID] [--host H] [--profile ID]` };
      }
    }
    if (!spec) {
      throw err('INVALID_ARGS',
        `unknown command '${positional.slice(0, 2).join(' ')}'; run tasksystem --help`);
    }
    for (const name of Object.keys(flags)) {
      if (name !== '--help' && !spec.flags.includes(name)) {
        throw err('INVALID_ARGS', `${name} is not valid for ${cmdKey}`);
      }
    }
    const isAlias = aliasCommand !== null;
    const grouped = GROUPED.has(positional[0]);
    const rest = grouped ? positional.slice(2) : positional.slice(1);
    const [minP, maxP] = spec.pos === -1 ? [0, 1] : [spec.pos, spec.pos];
    if (rest.length < minP || rest.length > maxP) {
      throw err('INVALID_ARGS',
        `wrong argument count for ${cmdKey}: ${spec.usage}`);
    }
    let result;
    if (cmdKey === 'inspect') {
      result = inspectProject(requireFlag(flags, '--project'));
    } else if (cmdKey === 'init') {
      result = await cmdInit(flags, io);
    } else if (cmdKey === 'doctor') {
      result = runDoctor(resolveContext({
        project: requireFlag(flags, '--project'),
        config: flags['--config'],
      }));
    } else if (cmdKey === 'mcp') {
      const { startMCPServer } = await import('./mcp/server.mjs');
      await startMCPServer({
        project: requireFlag(flags, '--project'),
        config: flags['--config'],
      });
      return 0;
    } else if (isAlias) {
      result = cmdWorkflow(aliasCommand, flags);
    } else if (cmdKey === 'workflow') {
      result = cmdWorkflow(rest[0], flags);
    } else if (cmdKey.startsWith('task ')) {
      result = await cmdTask(cmdKey.slice(5), rest, flags, io);
    } else if (cmdKey.startsWith('catalog ')) {
      result = cmdCatalog(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('resource ')) {
      result = cmdResource(cmdKey.slice(9), rest, flags);
    } else if (cmdKey.startsWith('plan ')) {
      result = cmdPlan(cmdKey.slice(5), rest, flags);
    } else if (cmdKey.startsWith('artifact ')) {
      result = cmdArtifact(cmdKey.slice(9), rest, flags);
    } else {
      result = cmdSession(cmdKey.slice(8), rest, flags);
    }
    io.stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {

    const payload = toErrorPayload(e);
    if (e.conflicts) payload.conflicts = e.conflicts;
    io.stderr(JSON.stringify({ error: payload }, null, 2));
    return 1;
  } finally {
    if (typeof io.close === 'function') io.close();
  }
}

// Default IO bound to real stdio; the interactive ask uses readline.
export function defaultIO() {
  let rl = null;
  return {
    isTTY: !!process.stdin.isTTY,
    stdout: (s) => process.stdout.write(s + '\n'),
    stderr: (s) => process.stderr.write(s + '\n'),
    ask: async (label, def) => {
      rl = rl || readline.createInterface({
        input: process.stdin, output: process.stdout,
      });
      const suffix = def ? ` [${def}]` : '';
      const answer = await rl.question(`${label}${suffix}: `);
      return answer.trim() === '' ? (def || '') : answer.trim();
    },
    close: () => { if (rl) rl.close(); },
  };
}
