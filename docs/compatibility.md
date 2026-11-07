# Compatibilidad y fuentes oficiales

Alcance real de esta base: puntos de entrada de instrucciones y propuestas
de integracion MCP para cuatro anfitriones. La compatibilidad documental no
certifica comportamiento equivalente entre productos.

## Matriz por anfitrion

| Anfitrion | Punto de entrada | Propuesta MCP generada | Estado |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (raiz) | `integrations/claude-mcp.json` con `mcpServers.tasksystem` (`type: stdio`) | Documental; requiere aprobacion del usuario en el anfitrion |
| Codex | `AGENTS.md` (raiz) | `integrations/codex-mcp.toml` (`[mcp_servers.tasksystem]`) | Documental; el proyecto requiere trust en Codex |
| OpenCode | `AGENTS.md` (raiz) | `integrations/opencode-mcp.json` (`mcp.tasksystem` tipo `local`) | Documental; compatibilidad nativa no certificada |
| Devin Local/CLI | `AGENTS.md` (raiz) | `integrations/devin-mcp.json` (`mcpServers.tasksystem` sin `type`) | Documental para Local/CLI; Devin Cloud no se considera equivalente |

## Notas por fuente

- **Claude Code:** la memoria de proyecto es `./CLAUDE.md`. El soporte de
  AGENTS.md varia por precedencia de nombre entre productos, por eso se
  conserva un entrypoint explicito por anfitrion. El fragmento usa el
  formato `.mcp.json` documentado (`mcpServers.<name>.type=stdio`,
  `command`, `args`); el primer arranque pide aprobacion en el anfitrion.
- **Codex:** `AGENTS.md` se carga desde la raiz del proyecto. El fragmento
  TOML replica la forma `[mcp_servers.<name>]` con `command` y `args`; se
  usan rutas absolutas porque el contexto de cwd no esta garantizado.
- **OpenCode:** `AGENTS.md` es el punto de entrada documentado. Las
  referencias externas en texto plano no se expanden automaticamente, por
  eso el entrypoint instruye leer el archivo de instrucciones. El fragmento
  usa el formato documentado `mcp.<name>` con `type:"local"`,
  `command:[...]`, `enabled:true`.
- **Devin Local/CLI:** `AGENTS.md` en la raiz es la recomendacion oficial;
  Local comparte las customizaciones del CLI. El fragmento sigue la forma
  `mcpServers` con `command`/`args` del archivo de configuracion MCP
  documentado. No se afirma paridad con Devin Cloud.

## Lo que NO se hace

- No se instalan hooks, permisos nativos, subagentes ni perfiles.
- No se mezclan fragmentos con configuraciones existentes del anfitrion.
- No se registra ningun servidor ni servicio; el usuario revisa y aplica
  cada propuesta manualmente.
- `serverPath` y la ruta del proyecto (`--project`) son absolutas y
  machine-local; `--config` va como token relativo POSIX contenido en el
  proyecto (es lo que `loadConfig` acepta):
  regenerarlas tras mover la instalacion o el proyecto.

## Fuentes oficiales consultadas

- [Claude Code — memory](https://code.claude.com/docs/en/memory) — memoria de proyecto `./CLAUDE.md`
- [Claude Code — MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart) — `.mcp.json` `mcpServers` stdio
- [openai/codex — agents_md.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs) — `AGENTS.md` raiz->cwd
- [openai/codex — mcp_types.rs](https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs) — `[mcp_servers.*]` command/args
- [OpenCode — rules](https://opencode.ai/docs/rules) — `AGENTS.md` (redirect a [docs.opencode.ai](https://docs.opencode.ai/docs/rules/))
- [OpenCode — MCP servers](https://opencode.ai/docs/mcp-servers) — `mcp.<name>` tipo `local`
- [Devin — rules](https://docs.devin.ai/cli/extensibility/rules) — `AGENTS.md` en raiz
- [Devin — MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration) — `mcp_config.json` `mcpServers`
- [Devin — local customizations](https://docs.devin.ai/desktop/devin-local/customizations.md) — Local comparte CLI
