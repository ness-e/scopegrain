// Runtime context: binds an explicit project root and config location.
// No path is ever derived by ascending from the TaskSystem installation.
import { DEFAULT_CONFIG_PATH, configDirOf, loadConfig } from './config.mjs';
import { resolveProjectRoot } from './paths.mjs';

export function resolveContext({ project, config: configPath }) {
  const projectRoot = resolveProjectRoot(project);
  const { config, configPath: configRel } = loadConfig(
    projectRoot, configPath || DEFAULT_CONFIG_PATH);
  return {
    projectRoot,
    configPath: configRel,
    configDir: configDirOf(configRel),
    config,
  };
}
