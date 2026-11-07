# Verificacion manual

Las pruebas estan escritas pero **ninguna se ha ejecutado** durante la
construccion de esta base. Este documento lista los comandos exactos para
que el propietario los ejecute y reporte los resultados.

## Requisito

```powershell
node --version   # se espera >= 22
```

El CLI no requiere dependencias. Los tests de MCP requieren `node_modules`
con `@modelcontextprotocol/sdk` 1.27.1 y `zod` 4.5.4; sin instalar, ese
archivo de test se salta con razon documentada.

## Suite completa

Desde la raiz de TaskSystem:

```powershell
npm test
# equivalente:
node --test tests/*.test.mjs
```

## Verificacion por area (mas acotada)

```powershell
node --test tests/paths.test.mjs      # contencion, traversal, symlinks
node --test tests/discovery.test.mjs  # stacks, limites, fingerprint
node --test tests/config.test.mjs     # contrato de config y respuestas
node --test tests/bootstrap.test.mjs  # plan, preflight, create-only
node --test tests/adapters.test.mjs   # fragmentos por anfitrion
node --test tests/tasks.test.mjs      # transiciones, CAS, evidencias
node --test tests/cli.test.mjs        # superficie CLI, JSON, exit codes
node --test tests/doctor.test.mjs     # doctor: contenido, templates, warnings
node --test tests/mcp.test.mjs        # opcional; requiere dependencias
```

Las pruebas de symlink se omiten con mensaje si Windows no permite crear
enlaces sin privilegio.

## Humo de solo lectura (no escribe nada)

Desde la raiz de TaskSystem:

```powershell
node .\bin\tasksystem.mjs --help
node .\bin\tasksystem.mjs inspect --project .
```

Para el plan dry-run de `init` usar un fixture vacio pre-creado (sobre este
repo `init` terminaria en `PLAN_CONFLICT`, porque los `AGENTS.md`/`CLAUDE.md`
existentes difieren deliberadamente del contenido generado):

```powershell
mkdir .\tests\.tmp\humo-vacio
node .\bin\tasksystem.mjs init --project .\tests\.tmp\humo-vacio --answers .\examples\answers.json
```

Imprime el plan sin escribir nada.

## Humo con escritura (mutante, solo en fixture desechable)

Crear un proyecto vacio dentro de `tests/.tmp` y aplicar ahi, nunca sobre
un proyecto real ni sobre este repo:

```powershell
mkdir .\tests\.tmp\humo-proyecto
node .\bin\tasksystem.mjs init --project .\tests\.tmp\humo-proyecto --answers .\examples\answers.json --apply
node .\bin\tasksystem.mjs doctor --project .\tests\.tmp\humo-proyecto
node .\bin\tasksystem.mjs task create --project .\tests\.tmp\humo-proyecto --title "Prueba" --contract "C" --author "ctx-a"
node .\bin\tasksystem.mjs task list --project .\tests\.tmp\humo-proyecto
```

Tambien se puede ejecutar `init` interactivo sobre el fixture (en una
terminal real): pregunta nombre, idioma, anfitriones, ruta de config y las
siete rutas, muestra el plan y solo escribe tras `yes` explicito.

## Humo del MCP (opcional, con dependencias instaladas)

```powershell
node .\src\mcp\server.mjs --project .\tests\.tmp\humo-proyecto --config ".tasksystem/config.json"
```

Debe quedar a la espera por stdio (protocolo MCP); cerrar con Ctrl+C.
El log de arranque va a stderr.

## Que reportar

- Salida completa de `npm test` (o de cada archivo acotado).
- Cualquier `FAIL`, `ERR` o skip inesperado.
- Para el humo: el JSON emitido por stdout y cualquier error en stderr.
