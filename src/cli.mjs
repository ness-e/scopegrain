// CLI command surface. All results go to stdout as JSON; failures go to
// stderr as {error:{code,message}} with a non-zero exit code.
import path from 'node:path';
import readline from 'node:readline/promises';
import { err, toErrorPayload } from './core/errors.mjs';
import { DEFAULT_CONFIG_PATH, DEFAULT_PATH_PROPOSALS, PATH_KEYS, loadConfig } from './core/config.mjs';
import { resolveContext } from './core/context.mjs';
import { resolveProjectRoot } from './core/paths.mjs';
import { prepareInit, applyPlan } from './core/bootstrap.mjs';
import { runDoctor } from './core/doctor.mjs';
import { inspectProject } from './discovery/inspect.mjs';
import { createTask, getTask, listTasks } from './core/tasks.mjs';
import { transitionTask, checkAction } from './core/transition.mjs';
import { readJsonFile } from './core/fsx.mjs';

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
};

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

function readInputFile(file, label) {
  const abs = path.resolve(file);
  return readJsonFile(abs, label);
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
  const hostsRaw = await io.ask('Anfitriones (claude,codex,opencode,devin)',
    existing ? existing.hosts.join(',') : 'claude,codex,opencode,devin');
  answers.hosts = hostsRaw.split(',').map((h) => h.trim()).filter(Boolean);
  const configRel = await io.ask('Ruta de configuracion',
    configFlag || DEFAULT_CONFIG_PATH);
  answers.paths = {};
  for (const key of PATH_KEYS) {
    answers.paths[key] = await io.ask(PATH_LABELS[key],
      existing ? existing.paths[key] : DEFAULT_PATH_PROPOSALS[key]);
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
    warnings: prepared.discovery.warnings,
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
    const expectedRevision = Number(flags['--revision']);
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

export async function run(argv, io) {
  try {

    const { flags, positional } = parseArgs(argv);
    if (flags['--help'] || positional.length === 0) {
      io.stdout(JSON.stringify(helpResult(), null, 2));
      return 0;
    }
    const isTask = positional[0] === 'task';
    const cmdKey = isTask ? `task ${positional[1] || ''}`.trim() : positional[0];
    const spec = COMMANDS[cmdKey];
    if (!spec) {
      throw err('INVALID_ARGS',
        `unknown command '${cmdKey}'; run tasksystem --help`);
    }
    for (const name of Object.keys(flags)) {
      if (name !== '--help' && !spec.flags.includes(name)) {
        throw err('INVALID_ARGS', `${name} is not valid for ${cmdKey}`);
      }
    }
    const rest = isTask ? positional.slice(2) : positional.slice(1);
    if (rest.length !== spec.pos) {
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
    } else {
      result = await cmdTask(
        cmdKey.slice('task '.length), rest, flags, io);
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
