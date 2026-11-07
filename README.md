# TaskSystem

Harness local de ingenieria para agentes de IA, independiente del proyecto
y con puntos de entrada para Claude Code, Codex, OpenCode y Devin Local/CLI.

**Estado: nucleo portable, catalogo y continuidad verificados localmente.**
Hay trece procedimientos de comando, once roles neutrales, cuarenta
skills de ingenieria, dieciocho reglas y cinco perfiles optativos.
El estado exacto de pruebas se registra en [verificacion](docs/verification.md);
las integraciones reales con anfitriones aun no estan certificadas.
No se debe interpretar la compatibilidad documental como una certificacion
de comportamiento equivalente entre productos.

## Identidad

TaskSystem convierte solicitudes en tareas con contrato, alcance, estado,
evidencia de verificacion, revision y continuidad entre sesiones.
Separa el nucleo operativo de las convenciones del agente anfitrion y de
la configuracion particular del repositorio gestionado.

El nombre es provisional. Alternativas:

| Nombre | Idea |
| --- | --- |
| TaskSystem | Continuidad con el proyecto actual; descriptivo |
| Workframe | Marco comun para organizar el trabajo de agentes |
| AgentFoundry | Construccion y coordinacion de capacidades |
| RelayForge | Handoffs y ejecucion encadenada |
| PraxisHarness | Procedimientos convertidos en trabajo verificable |

No se ha comprobado disponibilidad de marcas, dominios ni paquetes.

## Principios

- Investigar antes de configurar; distinguir evidencias de inferencias.
- Guardar los artefactos operativos por defecto dentro de `.tasksystem/`
  en cada proyecto, nunca dispersos en su documentacion.
- Preguntar que categorias versionar antes de generar reglas de exclusion.
- Mostrar el plan de archivos antes de escribir.
- No sobrescribir instrucciones, configuraciones ni trabajo existentes.
- No ejecutar scripts descubiertos ni instalar dependencias automaticamente.
- Mantener las reglas del proyecto y los permisos humanos por encima de
  las sugerencias del harness.
- No presentar instrucciones de texto como aislamiento de seguridad.
- No activar servicios, red, publicacion ni operaciones Git por defecto.

## Inicio

Requisito previsto: Node.js 22 o posterior. El CLI usa modulos nativos.
El servidor MCP es opcional y requiere sus dependencias declaradas.

Desde la carpeta de TaskSystem:

```powershell
node .\bin\tasksystem.mjs inspect --project "C:\ruta\mi-proyecto"
node .\bin\tasksystem.mjs init --project "C:\ruta\mi-proyecto"
node .\bin\tasksystem.mjs doctor --project "C:\ruta\mi-proyecto"
```

`inspect` es de solo lectura. `init` pregunta por identidad, idioma,
anfitriones, rutas y versionado por categoria, presenta una previsualizacion
y solicita confirmacion.
No ejecuta los comandos que encuentre en el proyecto.

Para automatizar la configuracion, se admite un archivo de respuestas:

```powershell
node .\bin\tasksystem.mjs init --project "C:\ruta\mi-proyecto" --answers "C:\ruta\respuestas.json"
```

Sin `--apply` solo muestra el plan. Con `--answers ... --apply` se autoriza
exclusivamente la creacion de los archivos mostrados, no la ejecucion de
comandos ni el reemplazo de archivos existentes.

Una configuracion fuera de la ruta predeterminada se indica con
`--config "ruta/relativa/config.json"` en los comandos posteriores.
Las rutas de artefactos deben permanecer dentro del proyecto en esta version.

## Incorporacion de un proyecto

1. Inspeccionar manifiestos e instrucciones con limites de lectura.
2. Reconocer stacks y proponer verificaciones con su archivo de origen.
3. Confirmar rutas en el espacio del harness para planes, tareas, informes,
   reviews, investigaciones, decisiones, memoria y estado operativo.
4. Seleccionar los agentes anfitriones; no asumir que estan instalados.
5. Elegir categorias que se versionan; revisar archivos, exclusiones Git
   propuestas y posibles conflictos, sin alterar el `.gitignore` de raiz.
6. Confirmar y crear la configuracion y los puntos de entrada.
7. Abrir una sesion del agente y confirmar que cargo las instrucciones.
8. Aprobar y ejecutar manualmente las verificaciones apropiadas.

El descubrimiento de manifiestos no sustituye una investigacion semantica
del codigo. Las instrucciones generadas exigen completar esa investigacion
con el agente antes de implementar una tarea.

## Estructura

```text
bin/                  Entrada del CLI
src/core/             Configuracion, rutas y estado de tareas
src/discovery/        Inspeccion local sin ejecutar codigo del proyecto
src/adapters/         Renderizado de integraciones por anfitrion
src/mcp/              Herramientas MCP de consulta, opcionales
catalog/              Recursos activos y procedencia heredada con hashes
commands/             Los trece procedimientos portables
agents/               Once responsabilidades neutrales
rules/                Obligaciones generales y especificas optativas
references/           Guias de consulta, no politicas implicitas
profiles/             Core, web, Rust, Python y bases de datos
policy/               Transiciones, limites, defaults y proyeccion nativa
templates/            Instrucciones portables y contratos
skills/               Procedimientos genericos seleccionados
docs/                 Arquitectura, incorporacion, seguridad y migracion
tests/                Pruebas del nuevo nucleo, no del archivo heredado
legacy/               Procedencia y material original fuera del circuito activo
```

## Comandos y continuidad

```powershell
node .\bin\tasksystem.mjs catalog list command
node .\bin\tasksystem.mjs catalog legacy skill
node .\bin\tasksystem.mjs pipeline --project "C:\ruta\mi-proyecto" --mode plan
node .\bin\tasksystem.mjs plan create --project "C:\ruta\mi-proyecto" --input plan.json
node .\bin\tasksystem.mjs plan next entrega --project "C:\ruta\mi-proyecto"
```

Los aliases `pipeline`, `spec`, `backlog`, `status`, `audit`, `harness`,
`research`, `ship`, `rollback`, `code-simplify`, `codeGraph`, `cleanCA` y
`webperf` entregan un paquete de procedimiento y contexto. No ejecutan una
LLM ni scripts: el anfitrion interpreta el trabajo autorizado.

`plan` persiste un DAG de tareas; `artifact` guarda specs, informes, reviews,
investigacion, decisiones, lecciones y handoffs; `session` registra
operaciones con un presupuesto explicito y recupera contexto real.
Salvo las operaciones historicas de tarea, las nuevas escrituras requieren
`--apply`; sin el flag se validan y previsualizan sin escribir.

La [guia de workflows](docs/workflows.md) detalla formatos y limites.
El [mapa de migracion](docs/component-migration.md) distingue recursos
activos, reemplazos nuevos y material original todavia no aprobado.

## Compatibilidad y limites

- Claude Code: instrucciones de proyecto y propuesta de servidor MCP.
- Codex: instrucciones de proyecto y propuesta de configuracion MCP TOML.
- OpenCode: instrucciones de proyecto y propuesta MCP con formato documentado.
- Devin Local/CLI: instrucciones y propuesta MCP con formato documentado.
- Devin Cloud no se considera equivalente a Local/CLI.
- La configuracion MCP se entrega como propuesta para revision; no se
  mezcla automaticamente con configuraciones existentes.
- Se generan puentes nativos revisables, no se instalan hooks ni se activan
  perfiles/permisos automaticamente. Ver [formatos nativos](docs/native-hosts.md).
- El estado se controla para las operaciones que pasan por TaskSystem;
  no se interceptan todas las herramientas nativas del anfitrion.
- Las evidencias y revisiones aportadas por el usuario/agente son
  declaraciones registradas, no pruebas de identidad criptografica.
- El servidor MCP no ejecuta shell ni modifica las tareas.
- Los presupuestos cuentan operaciones registradas, no todas las llamadas
  del anfitrion, tokens ni gasto monetario.
- No se incluye una licencia de redistribucion del material heredado.
  El paquete permanece privado hasta resolver procedencia y licencias.

## Desarrollo y verificacion

Los comandos de pruebas se preparan para ejecucion manual:

```powershell
npm test
```

Con autorizacion expresa se ejecutaron las pruebas y smoke tests de la
primera base: 73 pruebas correctas, ninguna fallida ni omitida.
La ampliacion supera 145 pruebas y 41 comprobaciones end-to-end, incluido
MCP por stdio. No confundir esos resultados con certificacion dentro de
los cuatro anfitriones ni con auditoria de las skills originales.
Consultar [verificacion](docs/verification.md) para entorno, evidencia y
limites. No instalar ni arrancar el servidor MCP sin revisar sus dependencias.

## Documentacion

- [Arquitectura](docs/architecture.md)
- [Incorporacion y personalizacion](docs/onboarding.md)
- [Compatibilidad y fuentes oficiales](docs/compatibility.md)
- [Seguridad y modelo de confianza](docs/security.md)
- [Migracion y limitaciones conocidas](docs/migration.md)
- [Destino de comandos, agentes, skills, reglas y referencias](docs/component-migration.md)
- [Flujo de tareas y evidencias](docs/task-workflow.md)
- [Verificacion: resultados y reproduccion](docs/verification.md)
- [Contrato del producto](docs/product-contract.md)
- [Contrato de implementacion](docs/implementation.md)
- [Ejemplo de respuestas](examples/answers.json) ·
  [esquema de respuestas](schemas/answers.schema.json)

Este proyecto procede de una copia del harness original. La carpeta
`.opencode` de VantaDB no forma parte de este trabajo y no debe modificarse.
