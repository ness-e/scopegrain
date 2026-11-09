# Compatibilidad y fuentes oficiales

Alcance: puntos de entrada, catalogo portable, CLI/MCP de consulta y
propuestas de puentes nativos para cinco anfitriones. La compatibilidad documental no
certifica comportamiento equivalente entre productos.

## Matriz por anfitrion

| Anfitrion | Punto de entrada | Propuesta MCP generada | Estado |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (raiz) | `integrations/claude-mcp.json` con `mcpServers.tasksystem` (`type: stdio`) | Documental; requiere aprobacion del usuario en el anfitrion |
| Codex | `AGENTS.md` (raiz) | `integrations/codex-mcp.toml` (`[mcp_servers.tasksystem]`) | Documental; el proyecto requiere trust en Codex |
| OpenCode V2 | `AGENTS.md` (raiz) | `integrations/opencode-mcp.json` (`mcp.servers.tasksystem`, `disabled:true`) | Documental; propuesta V1 separada, no activar ambas |
| Devin Local/CLI | `AGENTS.md` (raiz) | `integrations/devin-mcp.json` (`mcpServers.tasksystem` sin `type`) | Documental para Local/CLI; Devin Cloud no se considera equivalente |
| Google Antigravity | Propuestas App/CLI e IDE diferenciadas | `integrations/antigravity-mcp.json` y propuesta nativa revisable | Generacion local; sin piloto nativo ni agentes asumidos en IDE |

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
  usa el formato V2 `mcp.servers.<name>` con `type:"local"`,
  `command:[...]`, `disabled:true`. El formato V1 anterior queda en
  `opencode-v1-mcp.json` con `enabled:false`.
- **Devin Local/CLI:** `AGENTS.md` en la raiz es la recomendacion oficial;
  Local comparte las customizaciones del CLI. El fragmento sigue la forma
  `mcpServers` con `command`/`args` del archivo de configuracion MCP
  documentado. No se afirma paridad con Devin Cloud.
- **Antigravity:** App/CLI e IDE no se equiparan. La propuesta App/CLI
  incluye roles; la de IDE solo skills. La convencion `.agents/` compartida
  con otros productos no da aislamiento. Ver
  [variantes, permisos y fuentes](native-hosts.md).

## Lo que NO se hace

- Los puentes nativos se generan como propuestas bajo el espacio propio;
  no se instalan hooks ni se activan permisos, subagentes o perfiles.
- Las diferencias de schemas y alcance de permisos estan documentadas
  en [integraciones nativas](native-hosts.md); no se presupone equivalencia.
- No se mezclan fragmentos con configuraciones existentes del anfitrion.
- No se registra ningun servidor ni servicio; el usuario revisa y aplica
  cada propuesta manualmente.
- `serverPath` y la ruta del proyecto (`--project`) son absolutas y
  machine-local; `--config` va como token relativo POSIX contenido en el
  proyecto (es lo que `loadConfig` acepta):
  revisar y reconciliar las propuestas tras mover la instalacion o el
  proyecto. `doctor` informa las referencias obsoletas; no las corrige
  silenciosamente ni activa el destino nuevo.

## Fuentes oficiales consultadas

- [Claude Code — memory](https://code.claude.com/docs/en/memory) — memoria de proyecto `./CLAUDE.md`
- [Claude Code — MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart) — `.mcp.json` `mcpServers` stdio
- [openai/codex — agents_md.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs) — `AGENTS.md` raiz->cwd
- [openai/codex — mcp_types.rs](https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs) — `[mcp_servers.*]` command/args
- [OpenCode — rules](https://opencode.ai/docs/rules) — `AGENTS.md` (redirect a [docs.opencode.ai](https://docs.opencode.ai/docs/rules/))
- [OpenCode — MCP servers](https://opencode.ai/docs/mcp-servers/) — V2 `mcp.servers.<name>`, `disabled`; no confundir con V1
- [Devin — rules](https://docs.devin.ai/cli/extensibility/rules) — `AGENTS.md` en raiz
- [Devin — MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration) — `mcp_config.json` `mcpServers`
- [Devin — local customizations](https://docs.devin.ai/desktop/devin-local/customizations.md) — Local comparte CLI
