// Host integration proposals. These are reviewable FRAGMENTS, never merged
// into active host configuration by TaskSystem. serverPath and projectRoot
// inside are absolute and machine-local: regenerate after moving the
// installation. --config is rendered as the project-relative POSIX path that
// loadConfig accepts, validated as contained inside the project root.
import path from 'node:path';
import { err } from '../core/errors.mjs';
import { isInside, toCanonicalRelative } from '../core/paths.mjs';

// JSON.stringify output is compatible with TOML basic strings (both escape
// backslash, quote and control characters), so reuse it for TOML quoting.
function tomlString(s) {
  return JSON.stringify(s);
}

// Convert an absolute config path inside projectRoot to the relative POSIX
// token the CLI/MCP server expects after --config.
export function configArgToken(projectRoot, configAbs) {
  if (!isInside(projectRoot, configAbs) || configAbs === projectRoot) {
    throw err('INVALID_ADAPTER_INPUT',
      'configPath must be contained inside projectRoot');
  }
  const rel = path.relative(projectRoot, configAbs).split(path.sep).join('/');
  return toCanonicalRelative(rel, 'configPath');
}

function stdioArgs(serverPath, projectRoot, configRel) {
  return [serverPath, '--project', projectRoot, '--config', configRel];
}

function renderClaude(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      tasksystem: {
        type: 'stdio',
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

function renderDevin(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcpServers: {
      tasksystem: {
        command: 'node',
        args: stdioArgs(serverPath, projectRoot, configRel),
      },
    },
  }, null, 2) + '\n';
}

function renderCodex(serverPath, projectRoot, configRel) {
  const args = stdioArgs(serverPath, projectRoot, configRel)
    .map(tomlString).join(', ');
  return [
    '# Proposed fragment for .codex/config.toml (review before merging)',
    '[mcp_servers.tasksystem]',
    'command = "node"',
    `args = [${args}]`,
    '',
  ].join('\n');
}

function renderOpencode(serverPath, projectRoot, configRel) {
  return JSON.stringify({
    mcp: {
      tasksystem: {
        type: 'local',
        command: ['node', ...stdioArgs(serverPath, projectRoot, configRel)],
        enabled: true,
      },
    },
  }, null, 2) + '\n';
}

const RENDERERS = {
  claude: { file: 'claude-mcp.json', format: 'json', render: renderClaude },
  codex: { file: 'codex-mcp.toml', format: 'toml', render: renderCodex },
  opencode: { file: 'opencode-mcp.json', format: 'json', render: renderOpencode },
  devin: { file: 'devin-mcp.json', format: 'json', render: renderDevin },
};

// renderAdapters(config, {projectRoot, configPath, instructionsPath,
// serverPath}) -> {files, metadata}. projectRoot/configPath/serverPath must
// be absolute; configPath must be contained inside projectRoot. Fragments
// embed machine-local absolute server/root paths plus the project-relative
// --config token.
export function renderAdapters(config, opts) {
  const { projectRoot, configPath, instructionsPath, serverPath } = opts || {};
  for (const [k, v] of Object.entries({
    projectRoot, configPath, serverPath,
  })) {
    if (typeof v !== 'string' || !path.isAbsolute(v)) {
      throw err('INVALID_ADAPTER_INPUT',
        `${k} must be an absolute path string`);
    }
  }
  const configRel = configArgToken(projectRoot, path.resolve(configPath));
  const files = [];
  for (const host of config.hosts) {
    const spec = RENDERERS[host];
    if (!spec) throw err('UNKNOWN_HOST', `no adapter renderer for '${host}'`);
    files.push({
      host,
      relativePath: `integrations/${spec.file}`,
      format: spec.format,
      machineLocal: true,
      content: spec.render(serverPath, projectRoot, configRel),
    });
  }
  return {
    files,
    metadata: {
      machineLocal: true,
      instructionsPath: instructionsPath || null,
      note: 'proposal fragments only; review before merging into host config; '
        + 'regenerate after moving the installation or project',
    },
  };
}
