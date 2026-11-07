# Informe de implementacion

Alcance: `docs/implementation.md` mas las correcciones mecanicas aprobadas
en la revision de la primera pasada. En el commit inicial las pruebas
quedaron sin ejecutar. Posteriormente, con autorizacion expresa, se
ejecutaron: 73 correctas en el gate final, tras corregir un argumento
omitido en una prueba del CLI. Smoke tests locales correctos; no se
certificaron integraciones reales con anfitriones.
Detalle y limites: [verificacion](verification.md).

## Movimientos mecanicos (sin cambio de contenido)

- `agents/ commands/ configs/ locks/ mcp/ mcp-profiles/ opencode-loop/
  plugins/ references/ rules/ skills/ task-system/` -> `legacy/opencode/`
- `AGENTS.md SKILLS-MANIFEST.md VANTADB-OPERATING-MANUAL.md opencode.jsonc
  .vanta_profile _typos.toml .gitignore package.json package-lock.json
  bun.lock` -> `legacy/opencode/`
- `node_modules/` intacto en raiz. `legacy/provenance/` creado; el puntero
  `.git` original esta archivado en `copied-git-pointer.txt`; se creo el
  Git independiente (rama `develop`).
- Se retiro un archivo `nul` de 0 bytes en raiz creado por un comando
  propio (redireccion `2>nul` en bash). Artefacto propio, eliminado.

## Archivos creados / reescritos

| Archivo | Proposito |
| --- | --- |
| `package.json`, `.gitignore` | Metadata y contenido exactos especificados |
| `AGENTS.md`, `CLAUDE.md`, `skills/{project-onboarding,contract-execution,independent-review}/SKILL.md` | Copias verbatim de `templates/` |
| `legacy/README.md` | Estado del archivo heredado |
| `bin/tasksystem.mjs` | Entrada CLI; delega en `src/cli.mjs` |
| `src/cli.mjs` | Parser con `--help`, whitelist de flags por comando, valores no consumen `--flag`, positionals exactos; defaults interactivos desde config existente |
| `src/core/errors.mjs` | `TaskError {code,message}` |
| `src/core/fsx.mjs` | `readFileLimited` acotado por descriptor+fstat, `readDirBounded` por opendir |
| `src/core/paths.mjs` | Relativas canonicas; comparacion portable case-insensitive; device names, control chars, `<>:"|?*`, trailing space/dot; FILE_ANCESTOR |
| `src/core/config.mjs` | answers/config estrictas; 7 rutas; colisiones |
| `src/core/context.mjs` | projectRoot + configPath + config |
| `src/core/policy.mjs` | `policy/workflow.json` canonico |
| `src/core/tasks.mjs` | Tasks JSON; filename==id; scope canonico y resuelto; evidencia almacenada validada; malformed reportado |
| `src/core/evidence.mjs` | Validacion verification/review (attestations) |
| `src/core/transition.mjs` | Transiciones CAS con lock `wx` + tmp + rename; ACCEPT re-valida evidencia efectiva |
| `src/core/bootstrap.mjs` | Plan init; preservacion total en re-init; preflight pairwise-ancestor + re-verificacion inmediata; `applyPlan(projectRoot, files)` con open exclusivo y ownership antes de escribir |
| `src/core/doctor.mjs` | Compara contenido generado vs esperado, templates instaladas (installRoot inyectable), propaga warnings de discovery |
| `src/discovery/inspect.mjs` | Escaneo acotado (prof. 4, 1000 entradas, 128 KiB, opendir acotado); lockfiles por stat fijo; fingerprint incluye presencia de lockfiles; warnings explicitos |
| `src/adapters/render.mjs` | Fragmentos MCP; `--config` como token relativo POSIX validado contenido |
| `src/mcp/server.mjs` | `createMCPTools(ctx,z)` descriptores, `createMCPServer` sin connect, `startMCPServer` stdio |
| `tests/*.test.mjs` + `tests/helpers.mjs` | Casos del contrato + correcciones de revision |
| `docs/{architecture,onboarding,compatibility,security,migration,verification,task-workflow}.md` | Documentacion factual |

## Correcciones de la revision aplicadas

1. `--config` en fragmentos MCP ahora es el token relativo POSIX validado
   contenido; la prueba extrae args y llama `resolveContext`.
   Esta comprobacion pasa en el entorno local registrado.
2. Re-init: con config valida + answers iguales + fingerprint igual se
   preserva el objeto config completo y los bytes originales de
   `config.json` y `discovery.json` (formato, orden, `verification.commands`
   aprobados, evidencia original). Defaults interactivos desde la config
   existente.
3. Comparacion portable case-insensitive en reservados/overlaps/colisiones;
   segmentos con espacio/punto final, device names y caracteres de control
   o `<>:"|?*` rechazados. Unicode se conserva.
4. Preflight pairwise same-or-ancestor entre destinos planeados;
   `applyPlan` re-verifica todo inmediatamente antes de escribir; open
   exclusivo registra ownership antes del write para rollback exacto.
5. Tareas: id vs filename, timestamps/history, scope canonico + resuelto,
   evidencia almacenada re-validada (leida y en ACCEPT); fallos dejan bytes
   intactos.
6. Discovery: `null`/array manifest -> `INVALID_MANIFEST`; lecturas
   acotadas por descriptor; `opendir` con presupuesto; warnings
   `DIR_UNREADABLE`/`MANIFEST_UNREADABLE`/`SCAN_TRUNCATED`/
   `SCAN_PARTIAL_DEPTH`; lockfiles por stat y en fingerprint por presencia;
   no se asume un gestor cuando faltan senales (command:null + warning).
7. Tests corregidos: import `writeJson`, malformed via `writeFile` crudo,
   sin scans de substrings en rutas del llamante, `t.skip` real para
   symlinks (EPERM/EACCES/ENOTSUP/ENOSYS).
8. MCP: descriptores `createMCPTools` + `createMCPServer` sin connect;
   tests verifican 5 tools readOnly y llaman handlers.
9. CLI: `--help` real; flags fuera de comando y positionals extra
   rechazados; `--flag` sin valor no consume el siguiente flag.
10. Doctor: compara bytes generados vs esperados; templates requeridas;
    warnings de discovery propagados.
11. Docs: legacy/provenance actualizado, sin afirmacion ASCII en rutas,
    TOCTOU como proceso local con escritura, humo dividido
    lectura/escritura con fixtures en `tests/.tmp`, fuentes como enlaces
    HTTPS, nuevo `docs/task-workflow.md`, README con estado implementado.
12. Se actualizo `templates/project-instructions.md` con las ubicaciones
    de las skills portables; se respeta verbatim.

## Revision estatica realizada

- `grep` confirma: sin `child_process`, `eval`, `execSync`, `spawn` ni
  `require()` en `src/`, `bin/`, `tests/`. Imports revisados modulo a
  modulo; 0 bytes de control en todos los archivos nuevos.
- Sin comandos de host, sin rutas de terceros, sin escritura fuera de
  TaskSystem.

## Items incompletos / pendientes

- Las pruebas pasan en el entorno registrado; faltan Node.js 22, otros
  sistemas operativos y casos de integracion con anfitriones reales.
- El registro de herramientas MCP se construyo en pruebas con SDK 1.27.1;
  la conexion real del protocolo no fue verificada.
- No se ejecuto `node --check` por separado; los modulos cubiertos se
  cargaron durante las pruebas. No hay un gate adicional de lint o build.
