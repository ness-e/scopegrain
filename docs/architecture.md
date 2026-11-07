# Arquitectura

TaskSystem es un paquete Node.js ESM privado (Node >=22). El nucleo es
sincronico, sin dependencias externas y sin `child_process`, red ni escritura
fuera del proyecto explicitamente indicado. El servidor MCP es opcional y
carga sus dependencias (`@modelcontextprotocol/sdk`, `zod`) de forma
perezosa al arrancar.

## Modulos

```text
bin/tasksystem.mjs        Entrada del binario; delega en src/cli.mjs
src/cli.mjs               Parser de comandos y flujos interactivos; IO inyectable
src/core/errors.mjs       Errores {code, message} (TaskError)
src/core/fsx.mjs          Helpers sincronicos de filesystem
src/core/paths.mjs        Rutas relativas seguras, contencion, anti-symlink
src/core/config.mjs       Contrato de config.json, answers y colisiones
src/core/context.mjs      Vincula project root explicito + config cargada
src/core/policy.mjs       Carga policy/workflow.json (fuente canonica)
src/core/tasks.mjs        Documentos de tarea, createTask, getTask, listTasks
src/core/catalog.mjs      Catalogo activo validado y proyeccion de recursos
src/core/workflows.mjs    Paquetes de procedimiento/contexto, sin ejecucion LLM
src/core/plans.mjs        Planes DAG y readiness desde tareas actuales
src/core/artifacts.mjs    Artefactos operativos inmutables por UUID
src/core/sessions.mjs     Operaciones registradas, CAS, presupuesto y resume
src/core/versioning.mjs   Ignore propio y propuestas externas por categoria
src/core/evidence.mjs     Validacion de verification/review (attestations)
src/core/transition.mjs   Transiciones CAS con lock por tarea, checkAction
src/core/bootstrap.mjs    Plan de init, preflight, apply con rollback
src/core/doctor.mjs       Chequeo de salud de solo lectura
src/discovery/inspect.mjs Escaneo acotado de manifiestos
src/adapters/render.mjs   Fragmentos de integracion por anfitrion
src/adapters/native.mjs   Puentes nativos y plan de activacion manual
src/mcp/server.mjs        Servidor MCP stdio de solo lectura
```

## Flujo de datos

```text
CLI (--project) -> resolveProjectRoot -> inspectProject -> answers
  -> createConfig -> buildInitPlan -> preflightPlan -> applyPlan
CLI task/doctor/mcp -> resolveContext -> loadConfig -> operaciones
```

- Toda ruta de proyecto viene de `--project` o de la configuracion cargada;
  nada se deriva ascendiendo desde la instalacion.
- `policy/workflow.json` es la unica fuente de estados, transiciones,
  acciones y reglas de aceptacion; el codigo no duplica esos valores.
- Las plantillas en `templates/` se renderizan con sustitucion de
  placeholders; despues del render se exige que no quede ningun `{{`.
- Los comandos descubiertos son propuestas (`approved:false`), jamas
  ejecutados por el harness.
- `catalog/manifest.json` indexa fuentes canonicas; el catalogo generado
  usa rutas proyectadas, no referencias a templates inexistentes.
- Los procedimientos los interpreta el anfitrion. TaskSystem no crea
  clientes LLM ni ejecuta subagentes por tener una definicion de rol.
- La politica de onboarding propone todos los artefactos dentro de
  `.tasksystem/`; las ocho preferencias de versionado no autorizan
  modificar el Git del proyecto ni publicar datos privados.

## Decisiones relevantes

- **Contencion real:** contencion lexica mas rechazo de symlinks/junctions en
  cada ancestro existente; el root elegido debe existir y ser directorio
  real. `project.root` queda fijado a `"."` para mantener la config
  reubicable; el root real se pasa siempre en runtime.
- **Escrituras:** solo despues de preflight completo, con flag exclusivo
  `wx`. Un destino identico es no-op; distinto, enlace o directorio bloquea
  todo el plan antes de escribir nada. El rollback retira unicamente los
  archivos creados por esa operacion; no borra directorios.
- **Re-init:** si la config existe y coincide con las respuestas, y el
  fingerprint de descubrimiento no cambio, se preserva el objeto config
  completo y los bytes originales de `config.json` y `discovery.json`
  (formato, orden, comandos de verificacion aprobados, evidencia original);
  la reejecucion es un no-op real. Si `discovery.json` fue borrado, se
  replantea como archivo nuevo con la serializacion actual. Si cambio el
  fingerprint, los contenidos difieren y el preflight bloquea con
  conflicto explicito (reconciliacion manual).
- **Tareas:** lock por archivo `<id>.json.lock` abierto con `wx`; un lock
  existente es conflicto y nunca se recupera automaticamente. Escritura
  atomica via temporal exclusivo + rename; `finally` solo limpia el lock y
  el temporal propios.
- **Evidencia:** verification y review son attestations declaradas; `ACT`
  las invalida y una verificacion nueva invalida la review previa.
- **Descubrimiento:** profundidad <=4, <=1000 entradas, manifiestos <=128
  KiB de una lista permitida; sin seguir enlaces; carpetas puntuales
  excluidas (`.git`, `node_modules`, `vendor`, `.venv`, `venv`, `target`,
  `dist`, `build`, `coverage`, `legacy`, `.tasksystem`, y todo nombre que
  comience por punto salvo `.github`).
- **Fingerprint:** sha256 sobre el arreglo ordenado de
  `JSON.stringify([ruta, tamano, contenido])` por manifiesto admitido, mas
  `JSON.stringify([ruta, 'lockfile'])` por cada lockfile reconocido
  (solo presencia; su contenido nunca se lee). No incluye fecha ni ruta
  absoluta; los manifiestos omitidos por tamano aportan `null` como
  contenido pero conservan ruta y tamano. Anadir o quitar un lockfile
  cambia el fingerprint, porque cambia las propuestas de comandos.

## Limites estructurales

- La deteccion de stack se basa en manifiestos, no en `src/`; un stack sin
  manifiesto reconocido permanece desconocido.
- El escaneo no comprende el proyecto: la investigacion semantica es labor
  del agente, exigida por las instrucciones generadas.
- Las propuestas MCP son fragmentos machine-local; no se fusionan con la
  configuracion activa del anfitrion ni se registran automaticamente.
- La proyeccion nativa usa formatos de permisos documentados por host,
  sin instalarlos. Sus alcances no son equivalentes ni constituyen
  aislamiento universal del harness; no se generan hooks ejecutables.
- El estado se controla solo para operaciones que pasan por TaskSystem; no
  se interceptan herramientas nativas.
