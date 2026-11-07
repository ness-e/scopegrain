# Incorporacion y personalizacion

Guia para incorporar un proyecto a TaskSystem. Todo comando se ejecuta
manualmente; el harness propone, el propietario decide.

## Prerequisito

Node.js 22 o posterior. No hace falta instalar dependencias para usar el
CLI; el servidor MCP si requiere las dependencias declaradas en
`package.json` (`npm install` previo, bajo decision del propietario).

## Flujo recomendado

1. **Inspeccionar** (solo lectura):

   ```powershell
   node .\bin\tasksystem.mjs inspect --project "C:\ruta\mi-proyecto"
   ```

   El JSON resultante muestra stacks detectados por manifiestos, evidencia
   (rutas relativas), comandos propuestos con `approved:false`, fingerprint
   y advertencias. Nada se ejecuta ni se escribe.

2. **Inicializar** (interactivo o con respuestas):

   ```powershell
   node .\bin\tasksystem.mjs init --project "C:\ruta\mi-proyecto"
   node .\bin\tasksystem.mjs init --project "C:\ruta\mi-proyecto" --answers "C:\ruta\answers.json"
   node .\bin\tasksystem.mjs init --project "C:\ruta\mi-proyecto" --answers "C:\ruta\answers.json" --apply
   ```

   - Interactivo: pregunta nombre, idioma, anfitriones, ruta de
     configuracion y las siete rutas de artefactos; muestra el plan de
     archivos completo y pide `Crear estos archivos? (yes/no)` (defecto:
     `no`).
   - Con `--answers`: sin `--apply` es solo vista previa (dry-run);
     `--apply` autoriza exclusivamente la creacion de archivos nuevos.
   - No existen `--yes` ni `--force`; se rechazan explicitamente.
   - Ejemplo de respuestas: `examples/answers.json`; estructura:
     `schemas/answers.schema.json`. El esquema solo documenta forma; la
     contencion y los symlinks se validan en runtime.

3. **Archivos generados** (junto a la config, por defecto `.tasksystem/`):

   | Archivo | Origen |
   | --- | --- |
   | `config.json` | Respuestas validadas + resumen de discovery |
   | `instructions.md` | `templates/project-instructions.md` |
   | `discovery.json` | Resultado completo de inspect |
   | `task-contract.md` | `templates/task-contract.md` (verbatim) |
   | `integrations/<host>-mcp.json|.toml` | `src/adapters/render.mjs` |
   | `skills/<name>/SKILL.md` | `templates/skills/*` (verbatim) |
   | `AGENTS.md` (raiz) | `templates/entrypoint.md`, si hay host codex/opencode/devin |
   | `CLAUDE.md` (raiz) | `templates/entrypoint.md`, si hay host claude |

   Los fragmentos en `integrations/` son propuestas machine-local para
   revisar y fusionar manualmente en la configuracion del anfitrion; las
   skills portables se instalan como copias bajo el directorio de la config,
   no se registran en directorios nativos del anfitrion.

4. **Verificar estado**: `doctor` valida config, rutas, archivos generados y
   vigencia del fingerprint sin ejecutar nada.

   ```powershell
   node .\bin\tasksystem.mjs doctor --project "C:\ruta\mi-proyecto"
   ```

## Personalizacion

- Config fuera de la ruta por defecto: `--config "ruta/relativa/config.json"`
  en `init` (pregunta interactiva o flag) y en los comandos posteriores.
- Las rutas guardadas son siempre relativas al proyecto; nunca se almacenan
  rutas absolutas ni se aceptan destinos reservados (`.git`, `node_modules`,
  `legacy`, `.opencode`).
- Cambiar respuestas despues de init requiere reconciliacion manual: una
  config existente con respuestas distintas produce error explicito.

## Re-init y cambios de manifiestos

- Reejecutar `init` con la misma config y respuestas es no-op.
- Si los manifiestos cambiaron (fingerprint distinto), `init` se detiene con
  conflicto sobre `config.json`/`discovery.json`; `doctor` ademas reporta
  `changedDiscovery:true` para avisar antes.
