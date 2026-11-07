# TaskSystem

Harness local de ingenieria para agentes de IA, independiente del proyecto
y con puntos de entrada para Claude Code, Codex, OpenCode y Devin Local/CLI.

**Estado: base inicial implementada; 73 pruebas locales correctas.**
Los workflows y roles heredados siguen pendientes de migracion, y las
integraciones reales con anfitriones aun no estan certificadas.
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
- Preguntar donde guardar cada categoria de artefactos.
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
anfitriones y rutas, presenta una previsualizacion y solicita confirmacion.
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
3. Preguntar por rutas de planes, tareas, informes, investigaciones,
   decisiones, memoria y estado operativo.
4. Seleccionar los agentes anfitriones; no asumir que estan instalados.
5. Revisar todos los archivos propuestos y sus posibles conflictos.
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
policy/               Politica y transiciones canonicas
templates/            Instrucciones portables y contratos
skills/               Procedimientos genericos seleccionados
docs/                 Arquitectura, incorporacion, seguridad y migracion
tests/                Pruebas del nuevo nucleo, no del archivo heredado
legacy/               Procedencia y material original fuera del circuito activo
```

## Compatibilidad y limites

- Claude Code: instrucciones de proyecto y propuesta de servidor MCP.
- Codex: instrucciones de proyecto y propuesta de configuracion MCP TOML.
- OpenCode: instrucciones de proyecto y propuesta MCP con formato documentado.
- Devin Local/CLI: instrucciones y propuesta MCP con formato documentado.
- Devin Cloud no se considera equivalente a Local/CLI.
- La configuracion MCP se entrega como propuesta para revision; no se
  mezcla automaticamente con configuraciones existentes.
- No se instalan hooks, permisos nativos ni perfiles de subagentes.
- El estado se controla para las operaciones que pasan por TaskSystem;
  no se interceptan todas las herramientas nativas del anfitrion.
- Las evidencias y revisiones aportadas por el usuario/agente son
  declaraciones registradas, no pruebas de identidad criptografica.
- El servidor MCP no ejecuta shell ni modifica las tareas.
- No se incluye una licencia de redistribucion del material heredado.
  El paquete permanece privado hasta resolver procedencia y licencias.

## Desarrollo y verificacion

Los comandos de pruebas se preparan para ejecucion manual:

```powershell
npm test
```

Con autorizacion expresa se ejecutaron las pruebas y smoke tests locales:
73 pruebas correctas, ninguna fallida ni omitida en la corrida final.
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
