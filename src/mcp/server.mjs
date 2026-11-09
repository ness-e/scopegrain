// Optional read-only MCP server (stdio). Bound to one project root and one
// config at startup; tools never accept paths. Importing this module does
// not start the server and does not load the optional dependencies.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toErrorPayload } from '../core/errors.mjs';
import { resolveContext } from '../core/context.mjs';
import { runDoctor } from '../core/doctor.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { getTask, listTasks } from '../core/tasks.mjs';
import { checkAction } from '../core/transition.mjs';
import { catalogDestRel, getResource, loadCatalog, loadWorkspaceCatalog } from '../core/catalog.mjs';
import { diagnoseResource, findResources } from '../core/resource-recovery.mjs';
import { err } from '../core/errors.mjs';
import { buildWorkflowPacket } from '../core/workflows.mjs';
import { getPlan, nextPlanTasks } from '../core/plans.mjs';
import { getArtifact } from '../core/artifacts.mjs';
import { getSpecification } from '../core/specifications.mjs';
import { getApproval } from '../core/approvals.mjs';
import { checkMethodology } from '../core/methodology.mjs';
import { getSession, resumeSession } from '../core/sessions.mjs';

const PROTOCOL_NOTE = 'stdout is reserved for MCP protocol; logs go to stderr';

const READ_ONLY = {
  readOnlyHint: true, destructiveHint: false, openWorldHint: false,
};

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(e) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(toErrorPayload(e)) }],
  };
}

function wrap(fn) {
  return async (args) => {
    try {
      return textResult(await fn(args || {}));
    } catch (e) {
      return errorResult(e);
    }
  };
}

// Strict input: unknown tool arguments are rejected at the handler level,
// not silently stripped by schema parsing.
function strictify(tools) {
  for (const t of tools) {
    const allowed = new Set(Object.keys(t.config.inputSchema ?? {}));
    const inner = t.handler;
    t.handler = async (args) => {
      for (const k of Object.keys(args || {})) {
        if (!allowed.has(k)) {
          return errorResult(
            err('INVALID_ARGS', `unknown tool argument '${k}'`));
        }
      }
      return inner(args);
    };
  }
  return tools;
}

// Tool descriptors shared by the real server and tests. Every handler closes
// over the bound ctx; no tool argument can redirect to another path.
export function createMCPTools(ctx, z) {
  return strictify([
    {
      name: 'tasksystem_inspect',
      config: {
        description: 'Read-only manifest discovery for the bound project',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => inspectProject(ctx.projectRoot)),
    },
    {
      name: 'tasksystem_status',
      config: {
        description: 'Read-only doctor report for the bound project',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => runDoctor(ctx)),
    },
    {
      name: 'tasksystem_list_tasks',
      config: {
        description: 'List stored tasks and malformed entries',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => listTasks(ctx)),
    },
    {
      name: 'tasksystem_get_task',
      config: {
        description: 'Get one task by UUID',
        inputSchema: { id: z.string().describe('task UUID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getTask(ctx, id)),
    },
    {
      name: 'tasksystem_check_action',
      config: {
        description: 'Check whether policy allows an action in the task state',
        inputSchema: {
          taskId: z.string().describe('task UUID'),
          action: z.string().describe('action name, e.g. read, edit, verify'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ taskId, action }) => checkAction(ctx, taskId, action)),
    },
    {
      name: 'tasksystem_catalog_list',
      config: {
        description: 'List catalog entries, optionally filtered by kind',
        inputSchema: { kind: z.string().optional().describe('entry kind') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind }) => {
        const catalog = loadWorkspaceCatalog(ctx);
        const entries = kind
          ? catalog.entries.filter((e) => e.kind === kind) : catalog.entries;
        if (kind && !catalog.entries.some((e) => e.kind === kind)) {
          throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${kind}'`);
        }
        return {
          resourceRoot: ctx.configDir,
          entries: entries.map((e) => ({
            kind: e.kind, id: e.id, description: e.description,
            path: catalogDestRel(e), sourcePath: e.path,
          })),
          aliases: (catalog.aliases ?? []).map((a) => ({
            kind: a.kind, id: a.id, mode: a.mode ?? null,
            default: a.default === true, target: a.target,
            targetMode: a.targetMode ?? null, parameters: a.parameters ?? {},
          })),
        };
      }),
    },
    {
      name: 'tasksystem_catalog_get',
      config: {
        description: 'Get one catalog resource with verbatim content',
        inputSchema: {
          kind: z.string().describe('entry kind'),
          id: z.string().describe('entry id'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind, id }) => {
        const r = getResource(kind, id,
          { catalog: loadWorkspaceCatalog(ctx) });
        return {
          kind: r.kind, id: r.id,
          path: catalogDestRel(r), sourcePath: r.path,
          resourceRoot: ctx.configDir,
          description: r.description, content: r.content.toString('utf8'),
        };
      }),
    },
    {
      name: 'tasksystem_workflow_packet',
      config: {
        description: 'Read-only workflow packet for a catalog command',
        inputSchema: {
          command: z.string(),
          mode: z.string().optional(),
          taskId: z.string().optional(),
          host: z.string().optional(),
          profile: z.string().optional(),
          interaction: z.enum(['direct', 'guided']).optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => buildWorkflowPacket(ctx, a)),
    },
    {
      name: 'tasksystem_resource_search',
      config: {
        description: 'Search workspace snapshot resource metadata (read-only)',
        inputSchema: {
          kind: z.string().optional(),
          query: z.string().optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => findResources(ctx, a)),
    },
    {
      name: 'tasksystem_resource_diagnose',
      config: {
        description: 'Diagnose one snapshot resource vs its pinned hash (read-only)',
        inputSchema: { kind: z.string(), id: z.string() },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => diagnoseResource(ctx, a)),
    },
    {
      name: 'tasksystem_plan_get',
      config: {
        description: 'Get one stored plan by key',
        inputSchema: { key: z.string() },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => getPlan(ctx, key)),
    },
    {
      name: 'tasksystem_plan_next',
      config: {
        description: 'Dependency readiness of a plan from actual task state',
        inputSchema: { key: z.string() },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => ({ tasks: nextPlanTasks(ctx, key) })),
    },
    {
      name: 'tasksystem_artifact_get',
      config: {
        description: 'Get one stored artifact by kind and UUID',
        inputSchema: { kind: z.string(), id: z.string() },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind, id }) => getArtifact(ctx, kind, id)),
    },
    {
      name: 'tasksystem_specification_get',
      config: {
        description: 'Read a structured specification by UUID for the bound project.',
        inputSchema: { id: z.string().describe('structured specification UUID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getSpecification(ctx, id)),
    },
    {
      name: 'tasksystem_approval_get',
      config: {
        description: 'Read a stored content-bound approval by SHA-256 ID.',
        inputSchema: { id: z.string().describe('approval SHA-256 ID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getApproval(ctx, id)),
    },
    {
      name: 'tasksystem_methodology_check',
      config: {
        description: 'Check declared methodology gates for ACT or ACCEPT without writing.',
        inputSchema: {
          taskId: z.string().describe('task UUID'),
          to: z.enum(['ACT', 'ACCEPT']).optional().describe('methodology gate to inspect; defaults to ACT'),
          outcomeEvidenceId: z.string().optional().describe('optional outcome report UUID for an ACCEPT preview'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => checkMethodology(ctx, a)),
    },
    {
      name: 'tasksystem_session_get',
      config: {
        description: 'Get one stored session by UUID',
        inputSchema: { id: z.string() },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getSession(ctx, id)),
    },
    {
      name: 'tasksystem_session_resume',
      config: {
        description: 'Session usage plus actual task state and guidance reference',
        inputSchema: { id: z.string() },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => resumeSession(ctx, id)),
    },
  ]);
}

// Constructs the MCP server and registers all tools WITHOUT connecting a
// transport. Returns {server, ctx} so callers/tests can inspect registration.
export async function createMCPServer({ project, config }) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { z } = await import('zod');
  const ctx = resolveContext({ project, config });
  const server = new McpServer({ name: 'tasksystem', version: '0.1.0' });
  for (const tool of createMCPTools(ctx, z)) {
    // Explicit strict object schema: the SDK preserves it, so unknown wire
    // args are rejected BEFORE the handler (raw shape would strip them).
    server.registerTool(tool.name, {
      ...tool.config,
      inputSchema: z.object(tool.config.inputSchema ?? {}).strict(),
    }, tool.handler);
  }
  return { server, ctx };
}

export async function startMCPServer({ project, config }) {
  const { StdioServerTransport } =
    await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { server } = await createMCPServer({ project, config });
  process.stderr.write(`tasksystem mcp: ${PROTOCOL_NOTE}\n`);
  await server.connect(new StdioServerTransport());
  return server;
}

// Main guard: running `node src/mcp/server.mjs --project P [--config C]`
// starts the server; importing the module does not.
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs && invokedAs === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const pIdx = argv.indexOf('--project');
  const project = pIdx >= 0 ? argv[pIdx + 1] : null;
  const cIdx = argv.indexOf('--config');
  const config = cIdx >= 0 ? argv[cIdx + 1] : undefined;
  startMCPServer({ project, config }).catch((e) => {
    const payload = toErrorPayload(e);
    process.stderr.write(JSON.stringify({ error: payload }) + '\n');
    process.exitCode = 1;
  });
}
