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

   - Interactivo: pregunta nombre, idioma, anfitriones, metodologia, ruta de
     configuracion, las siete rutas de artefactos y ocho decisiones de
     versionado (incluida la subcategoria reviews); muestra el plan de
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
   | `integrations/<host>-mcp.json` o `.toml` | `src/hosts/render.mjs` |
   | `catalog.json` | Manifest proyectado con rutas del espacio generado |
   | `commands/`, `agents/`, `skills/`, `rules/`, `references/`, `profiles/` | Fuentes canonicas del catalogo activo |
   | `policy/workflow.json`, `policy/operation-limits.json`, `policy/methodology.json` | Politicas canonicas de referencia, no overrides del runtime |
   | `.gitignore`, `integrations/gitignore-proposal.txt` | Preferencias por categoria; no alteran el ignore de raiz |
   | `integrations/native/` | Puentes nativos y plan de activacion manual |
   | `AGENTS.md` (raiz) | `templates/entrypoint.md`, segun anfitriones seleccionados |
   | `CLAUDE.md` (raiz) | `templates/entrypoint.md`, si hay host claude |

   Los fragmentos en `integrations/` son propuestas machine-local para
   revisar y fusionar manualmente en la configuracion del anfitrion; las
   skills portables se instalan como copias bajo el directorio de la config,
   no se registran en directorios nativos del anfitrion.
   Los puentes nativos tambien permanecen dentro de `integrations/native/`
   hasta su revision y activacion manual; no se copian a raices de host.

4. **Verificar estado**: `doctor` valida config, rutas, archivos generados y
   vigencia del fingerprint sin ejecutar nada.

   ```powershell
   node .\bin\tasksystem.mjs doctor --project "C:\ruta\mi-proyecto"
   ```

## Personalizacion

- La metodologia se pregunta despues de los anfitriones y antes de la ruta
  de configuracion. Para un proyecto interactivo nuevo se propone
  `organic-sdd`; una seleccion invalida se vuelve a preguntar y cancelar la
  confirmacion final no aplica archivos.
- Modos: `manual`, `organic-sdd`, `sdd`. Respuestas/config antiguas sin campo
  se normalizan a `manual` sin reescribir bytes. No se deben omitir respuestas
  para degradar un proyecto que ya usa otro modo: la diferencia es conflicto.
  Ver [Organic y SDD](methodology.md).

- Todos los artefactos operativos se proponen dentro de `.tasksystem/`:
  planes, task files, reports/reviews, research, decisions, memory y state.
  La documentacion destinada a usuarios del producto es un entregable
  distinto y conserva las convenciones de ese proyecto.
- Se pregunta por separado si versionar plans, tasks, reports, reviews,
  research, decisions, memory y state. La propuesta conservadora es no.
  El formato de respuestas usa ocho booleanos en `versioning`; los
  archivos antiguos sin ese campo siguen siendo validos con valores false.
- El `.gitignore` del espacio propio cubre categorias locales internas.
  Las rutas custom fuera del espacio producen propuestas para aplicar
  manualmente. Un ignore anidado no deshace un ignore del padre ni
  retira archivos que Git ya seguia; eso requiere decision del propietario.
- Config fuera de la ruta por defecto: `--config "ruta/relativa/config.json"`
  en `init` (pregunta interactiva o flag) y en los comandos posteriores.
- Las rutas de artefactos son relativas al proyecto; no se aceptan destinos
  reservados (`.git`, `node_modules`, `legacy`, `.opencode`). Los fragmentos
  MCP machine-local si pueden contener rutas absolutas de la instalacion y
  del proyecto. Moverlos requiere revision/rebind explicito, no sustitucion
  silenciosa ni una promesa de portabilidad de esas rutas.
- Cambiar respuestas despues de init requiere reconciliacion manual: una
  config existente con respuestas distintas produce error explicito.

## Re-init y cambios de manifiestos

- Reejecutar `init` con la misma config y respuestas es no-op.
- Esa propiedad supone las mismas fuentes canonicas del harness.
  Al actualizar TaskSystem pueden aparecer conflictos de contenido
  generado; no existe `--force` para sobrescribirlos ni migracion automatica.
- Si los manifiestos cambiaron (fingerprint distinto), `init` se detiene con
  conflicto sobre `config.json`/`discovery.json`; `doctor` ademas reporta
  `changedDiscovery:true` para avisar antes.
