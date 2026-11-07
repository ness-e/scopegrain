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

// Tool descriptors shared by the real server and tests. Every handler closes
// over the bound ctx; no tool argument can redirect to another path.
export function createMCPTools(ctx, z) {
  return [
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
  ];
}

// Constructs the MCP server and registers all tools WITHOUT connecting a
// transport. Returns {server, ctx} so callers/tests can inspect registration.
export async function createMCPServer({ project, config }) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { z } = await import('zod');
  const ctx = resolveContext({ project, config });
  const server = new McpServer({ name: 'tasksystem', version: '0.1.0' });
  for (const tool of createMCPTools(ctx, z)) {
    server.registerTool(tool.name, tool.config, tool.handler);
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
