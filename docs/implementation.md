# Scopegrain: contrato de implementacion

Estado: aprobado como base de trabajo por la solicitud de crear el proyecto.
Scopegrain es el nombre del producto; TaskSystem se conserva como nombre
tecnico por compatibilidad. Esto no concede una licencia de redistribucion.

Este contrato documenta el nucleo inicial y sus invariantes. Las extensiones
vigentes se especifican en [workflows](workflows.md),
[integraciones nativas](native-hosts.md) y
[mapa de migracion](component-migration.md), con
[Organic y SDD](methodology.md) para los gates actuales. Los requisitos adicionales
incluyen catalogo canonico, planes DAG, artefactos, sesiones con presupuesto
registrado, workspace `.tasksystem/` y versionado preguntado por categoria.

## Limites de esta entrega

Las restricciones y autorizaciones narradas en esta seccion son historicas
del contrato inicial; no resumen las autorizaciones vigentes.

Crear una base nueva, ejecutable y generica en esta carpeta. Preservar la copia
heredada, pero no ejecutar ni convertir por sustitucion masiva sus instrucciones.
No tocar ninguna ruta de VantaDB ni su .opencode. En la construccion inicial
no se autorizaron tests, builds, linters, scripts, servicios ni instalaciones.
Posteriormente el propietario autorizo las pruebas y comprobaciones locales;
sus resultados estan en [verificacion](verification.md). En esa etapa, esas
pruebas no autorizaban instalaciones, publicacion, push ni creacion de
remotos. Se autorizo separadamente consultar documentacion oficial en modo
lectura para validar los formatos nativos; no activar integraciones externas.
Las pruebas y arranques posteriores requerian un comando propuesto y
ejecucion manual del propietario o autorizacion explicita acotada.

## Arquitectura decidida

Un paquete Node.js ESM, privado, Node >=22. CLI sin dependencias externas.
MCP opcional: usar las dependencias ya copiadas @modelcontextprotocol/sdk
1.27.1 y zod 4.5.4; no instalar. No implementar JSON-RPC a mano.
Nucleo sincronico pequeno con errores {code,message}; errores de CLI a stderr
y exitCode=1, JSON de resultados a stdout. No llamar child_process.

Separar src/core, src/discovery, src/hosts, src/mcp y bin; src/adapters
conserva entradas de compatibilidad. Toda ruta de
proyecto viene de --project y/o una configuracion explicitamente cargada,
nunca de ascender desde la instalacion. No depender del directorio .opencode.
Las instrucciones estan en resources/{commands,agents,skills,rules,references,
prompts}/ y templates/, indexadas en resources/manifest.json; no duplicarlas
como literales ejecutables.
La politica canonica es policy/workflow.json; no duplicar valores en el codigo.

## Conservacion

Mover los directorios copiados agents, commands, configs, locks, mcp,
mcp-profiles, opencode-loop, plugins, references, rules, skills y task-system
a legacy/opencode/ sin cambiar su contenido. Conservar alli tambien AGENTS.md,
SKILLS-MANIFEST.md, VANTADB-OPERATING-MANUAL.md, opencode.jsonc, .vanta_profile,
_typos.toml, .gitignore, package.json, package-lock.json y bun.lock.
No mover node_modules: es cache local ignorada, no forma parte del producto.
El lead conserva el puntero .git invalido en legacy/provenance/ y crea el Git
independiente. No seguir el puntero ni modificar metadatos externos.
El archivo heredado queda ignorado en Git por licencias, datos historicos y
posibles secretos. El nuevo README explica esta limitacion de distribucion.

## Descubrimiento

inspectProject(projectRoot) devuelve {schemaVersion:1, stacks:[], evidence:[],
commands:[], fingerprint, warnings:[]}. No writes ni shell ni red.
Recorrido por carpetas: profundidad maxima 4, maximo 1000 entradas; excluir
.git, node_modules, vendor, .venv, venv, target, dist, build, coverage, legacy,
.tasksystem y nombres que comiencen por punto excepto .github.
Nunca seguir symlinks/junctions. No leer .env, llaves ni credenciales.
Leer solamente manifiestos de lista permitida con limite de 128 KiB:
package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, composer.json,
Gemfile y archivos *.sln/*.csproj; reconocer AGENTS.md, CLAUDE.md y README.md
por existencia, sin copiar su texto a los resultados. Limitar profundidad,
tamano y numero de archivos incluso en monorepos.
Conservar referencias relativas como evidencia. Detectar Node.js, Rust,
Python, Go, Java, PHP, Ruby y .NET por manifiestos, no por src/.
Para package.json proponer solo scripts test, lint, check, typecheck y build
realmente presentes; command/cwd/source/approved:false. No copiar su expansion.
Usar npm/pnpm/yarn/bun segun packageManager o lockfile; senales contradictorias
producen advertencia. Un packageManager conocido declarado gana con warning
ante conflictos; sin declaracion valida, una unica senal de lockfile permite
proponer ese gestor. Una declaracion desconocida o senales ausentes/ambiguas
producen command:null y warning, sin fallback silencioso a npm.
Otros stacks: reconocer, sin inventar comandos. JSON malformado genera warning.
El fingerprint usa sha256 de rutas y contenido de manifiestos admitidos
y presencia de lockfiles reconocidos, ordenados; no fecha ni ruta absoluta.
Cambiar un manifiesto o agregar/quitar una senal de lockfile lo cambia.
La investigacion semantica posterior corresponde al agente, no a este scanner.

## Configuracion y rutas

createConfig(projectRoot, answers, discovery) produce:

```json
{
  "schemaVersion": 1,
  "project": {"name": "example", "root": "."},
  "locale": "es",
  "hosts": ["claude", "codex", "opencode", "devin"],
  "paths": {
    "plans": ".tasksystem/plans",
    "tasks": ".tasksystem/tasks",
    "reports": ".tasksystem/reports",
    "research": ".tasksystem/research",
    "decisions": ".tasksystem/decisions",
    "memory": ".tasksystem/memory",
    "state": ".tasksystem/state"
  },
  "verification": {"mode": "manual", "commands": []},
  "discovery": {"fingerprint": "", "stacks": [], "evidence": []}
}
```

El ejemplo son propuestas, NO rutas aceptadas implicitamente. Los prompts
interactivos deben preguntar por TODAS las categorias y la ruta de config.
answers admite name, locale, hosts, paths y versioning opcional.
Cuando versioning esta presente exige ocho booleanos: plans, tasks,
reports, reviews, research, decisions, memory y state. Ausente equivale
a false en todas las categorias para compatibilidad.
locale solo es es o en; hosts conocidos, no duplicados, al menos uno.
Validar tipos, version y claves; rechazar desconocidas en las respuestas y
en la configuracion para no ignorar errores tipograficos.
Config predeterminada .tasksystem/config.json, --config alternativo relativo
al project root. No guardar rutas absolutas al proyecto en config compartida.
loadConfig(projectRoot,configPath) valida sin mutar.
La configuracion y todos los destinos deben ser relativos, sin .., NUL,
colon, unidades Windows, UNC ni segmentos vacios; rechazar rutas absolutas
con POSIX Y win32 incluso al correr en otro sistema.
No permitir .git, node_modules, legacy o .opencode como destinos.
Comprobar lstat/realpath de todos los ancestros existentes y rechazar
symlinks/junctions, incluso si apuntan dentro. Verificar contencion real.
Las siete rutas no pueden ser iguales ni ancestros/descendientes entre si.
No pueden colisionar con config, bootstrap ni archivos de los adaptadores.
El project root explicitamente elegido debe existir y ser directorio real.
La comparacion portable es case-insensitive aun en POSIX. Rechazar segmentos
con punto/espacio final, nombres de dispositivos Windows incluso con extension,
controles ASCII y caracteres no portables < > : " | ? *. Unicode no queda
prohibido. La contencion real sigue usando rutas reales, no solo esta clave.

## Inicializacion y plan de archivos

CLI inspect --project PATH: solo stdout JSON.
CLI init --project PATH [--config REL] [--answers FILE] [--apply].
Interactivo: preguntar nombre, idioma, hosts, config, siete rutas y ocho
preferencias de versionado; mostrar
discovery y todos los destinos, luego confirmar. No preguntar por secretos.
Con --answers: default dry-run; --apply autoriza crear, no reemplazar.
No --yes, --force ni escritura implicita en sesiones sin TTY.
Generar junto a config: instructions.md, discovery.json, task-contract.md,
integrations/{host}-mcp.json o .toml. Todos los placeholders de templates
se resuelven; nombres de archivo no dependen de texto no confiable.
AGENTS.md es punto de entrada comun de codex, opencode y devin; CLAUDE.md
para claude. Si ambos son necesarios, no duplicar archivos en el plan.
Integraciones MCP son FRAGMENTOS PROPUESTOS, no archivos activos del host.
Crear archivos solo tras preflight completo. Un destino preexistente
identico es no-op; distinto, symlink o directorio bloquea TODO antes de
crear nada. Validar tambien colisiones entre archivos del propio plan y
ancestros. Escrituras exclusivas con flag wx; si hay una carrera, no
reemplazar. Llevar lista de archivos creados y retirar SOLO esos en rollback
si ocurre error; no borrar archivos ajenos ni directorios ajenos.
Reejecutar con una config existente valida es no-op; si las respuestas
difieren, error explicito: reconciliacion manual, no overwrite silencioso.
Con fingerprint sin cambios se conservan los bytes completos de config y
discovery, incluidas preferencias manuales y formato del usuario. El discovery
actual solo sirve para la vista previa. Defaults interactivos desde la config
existente, no desde propuestas genericas que sustituyan preferencias.
Antes de aplicar, repetir preflight/validacion de ancestros; detectar tambien
archivos planeados que sean ancestros de otros archivos. El seguimiento de
propiedad empieza al abrir exclusivamente, antes de escribir, para retirar
archivos propios parciales si falla una escritura.
No ejecutar comandos ni modificar el .gitignore de raiz o archivos host
existentes. Se genera un ignore anidado y una propuesta externa a partir
de las preferencias, sin comandos Git ni auto-untracking.

## Adaptadores

renderAdapters(config,{projectRoot,configPath,instructionsPath,serverPath})
devuelve archivos propuestos y metadata. serverPath absoluto apunta a la
instalacion LOCAL y no al proyecto. Etiquetar fragmentos como machine-local:
no commitearlos sin revisar; regenerar al mover la instalacion.
Serializar JSON con JSON.stringify; TOML strings con escaping compatible,
sin interpolacion de shell. No contruir comandos shell concatenados.
Siempre pasar --project y --config como args separados al servidor.
--project es absoluto; --config es relativo al root elegido. Aunque la API de
renderizado reciba configPath absoluto, comprobar contencion y convertirlo
antes de serializar, para respetar el contrato de loadConfig.
Claude: propuesta .mcp.json {"mcpServers":{"tasksystem":{"type":"stdio",
"command":"node","args":[SERVER,"--project",ROOT,"--config",CONFIG]}}}.
Devin Local/CLI: misma envoltura mcpServers y command/args, sin type.
Codex: fragmento para .codex/config.toml [mcp_servers.tasksystem] con command
y args. OpenCode: opencode.json formato {"mcp":{"tasksystem":{"type":"local",
"command":["node",SERVER,"--project",ROOT,"--config",CONFIG],"enabled":true}}}.
No prometer perfil de permisos ni subagentes equivalentes; no registrar
automaticamente servidores ni servicios terceros.

## Tareas y politica

Las tareas son JSON en paths.tasks/{UUID}.json. Validar IDs como UUID antes
de componer rutas; nunca usar un ID como ruta libre.
createTask(config,{title,contract,authorContext,scope:[]}) exige strings no
vacios y scope como lista de rutas relativas contenidas. Genera UUID,
state=PLAN, revision=0 y history inicial; no permite atributos arbitrarios.
transitionTask(config,{id,to,expectedRevision,verification?,review?}):
leer estado real, comprobar transicion contra workflow.json, CAS revision,
lock por tarea via open wx, write temporal exclusivo y rename.
Lock existente: error de conflicto, no recuperar automaticamente. Limpiar
solo locks/temporales propios con finally. Validar tareas leidas.
La revision debe ser entero no negativo y debe coincidir con la almacenada.
El cambio a ACCEPT revalida SIEMPRE la evidencia almacenada o suministrada,
no solo su presencia. Exige verificacion no vacia:
{checks:[{command,cwd,status:"pass",evidence:"referencia"}]} y review:
{mode:"fresh",reviewer,authorContext,reviewerContext,verdict:"approve"},
authorContext debe coincidir con el autor almacenado y reviewerContext
debe ser no vacio y diferente; o {mode:"waived",owner,reference,reason,
verdict:"approve"}. Son attestations: documentarlo.
ACT invalida verificacion y review previos; cambiar verificacion invalida
review. No arrastrar aprobaciones de una implementacion anterior.
checkAction(config,taskId,action) toma estado real almacenado y aplica
workflow.actions, rechazando desconocidos. No cuenta llamadas nativas ni
alega sandbox. No introducir presupuestos que no se midan.
listTasks/getTask de solo lectura; task malformed no se descarta en silencio.
El id interno debe coincidir con el nombre de archivo; timestamps, historial
y scope tienen tipos y rutas validos. Un archivo .json sin UUID es malformed.
CLI task create --title TEXT --contract TEXT --author CONTEXT; task list;
task show ID; task transition ID STATE --revision N [--evidence JSONFILE].
Evidence solo admite verification y review. CLI no ejecuta verificaciones.

## Doctor

Solo lectura: valida config, paths, plantillas instaladas, existencia del
bootstrap, fingerprint actual y propuestas MCP. Reporta changedDiscovery,
warnings y ready/needs-attention, sin ejecutar nada ni afirmar que el
anfitrion o servicios estan instalados. Config malformada causa error.

## MCP

Servidor opcional stdio con SDK, main guard para no arrancar al importarlo.
Config y project root ligados al arranque; no aceptar rutas desde cada tool.
createMCPServer({project,config}) construye sin conectar; startMCPServer
conecta por stdio. createMCPTools(ctx,z) devuelve descriptores
{name,config,handler} compartidos por registro real y pruebas de handlers.
Tools de SOLO LECTURA con readOnlyHint:true:
tasksystem_inspect {}, tasksystem_status {}, tasksystem_list_tasks {},
tasksystem_get_task {id}, tasksystem_check_action {taskId,action}.
Compartir implementaciones con CLI. JSON en text content; errores isError
sin filtrar secretos o stack. stdout exclusivo para protocolo, stderr logs.
No shell, red, escritura ni tools de aceptacion por MCP en esta base.

## Ajustes de revision inicial

- Leer manifiestos con descriptor y limite real de bytes, no readFile
  ilimitado despues de stat. Limitar tambien la enumeracion de directorios.
- Reportar limites de profundidad/entradas y fallos de lectura como warnings.
- doctor propaga advertencias y valida propuestas, no solo su existencia.
- CLI --help funciona; argumentos desconocidos, extras o sin valor fallan
  antes de escribir.
- Agregar regresiones de reinicio byte-estable, aliases Windows, colisiones
  entre archivos planeados, rollback propio, evidencia persistida corrupta,
  argumentos reales de adaptadores y handlers MCP efectivamente registrados.
- No confundir fixtures sinteticos con resultados de verificacion reales.

## Pruebas a escribir, NO ejecutar

Usar node:test y assert; fixtures TEMPORALES bajo tests/.tmp (no fuera de
TaskSystem). Limpiar solo lo creado por el test. Casos:
1. Descubrimiento Node y monorepo con paths con espacios y script real.
2. src/ sin Cargo.toml no implica Rust; proyecto vacio permanece desconocido.
3. JSON malformado y manifiesto grande reportados, nunca ejecutados.
4. Secretos, node_modules, legacy y symlinks no inspeccionados.
5. Fingerprint determinista y sensible a cambios de manifiestos.
6. Rutas ../, absolutas, Windows drive/UNC, colon, symlinks y solapamientos
   rechazadas; symlink tests omitidos con razon si Windows no lo permite.
7. Config version/tipos/host/locale/keys invalidos rechazados.
8. Init dry-run no escribe; apply crea; re-run no-op conserva bytes.
9. Conflicto AGENTS/CLAUDE/config bloquea sin escrituras parciales.
10. Adaptadores JSON parseables y TOML bien escapado, args separados, sin
    credenciales ni rutas VantaDB, sin activar configuracion del anfitrion.
11. Tareas transicion valida/invalida, UUID traversal, revision obsoleta,
    lock ocupado, JSON corrupto y desconocidos rechazados.
12. ACCEPT sin evidencia, evidencia fail, same-context y autor falso fallan;
    fresh valido o waiver completo pasa; ACT invalida evidencia anterior.
13. MCP herramientas read-only usan las mismas funciones, import no inicia.
14. Ninguna prueba usa el archivo legacy ni llama a herramientas anfitrion.

Crear docs de arquitectura, onboarding, compatibilidad, seguridad, migracion
y verificacion acordes al codigo real. No afirmar tests aprobados.
No generar otros prompts/politicas; cualquier duda del contrato se reporta.
