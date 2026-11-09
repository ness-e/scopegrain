# Scopegrain

Harness portable de ingenieria proporcional para agentes de IA.

Scopegrain ayuda a equipos y operadores que usan agentes de codigo a
organizar trabajo entre proyectos y sesiones sin depender de un unico
anfitrion. Separa el contexto y los contratos de trabajo de las
convenciones de cada herramienta, y ofrece una ruta ligera o formal segun
los hechos y riesgos declarados.

El producto se llama Scopegrain. Los nombres tecnicos existentes
`tasksystem`, `tasksystem-harness`, `.tasksystem` y los prefijos MCP
`tasksystem_` se mantienen por compatibilidad; no son comandos nuevos ni
una promesa de publicacion de paquetes.

## Flujo de trabajo

1. **Descubrimiento de solo lectura.** Inspeccionar manifiestos e
   instrucciones con limites de lectura; los comandos encontrados se
   presentan como propuestas y no se ejecutan automaticamente.
2. **Incorporacion y aprobacion.** Elegir anfitriones, metodologia, rutas y
   preferencias de versionado. Revisar la vista previa y confirmar antes de
   crear archivos. La aprobacion de archivos no autoriza otras operaciones.
3. **Contexto y snapshots.** Consultar el catalogo de procedimientos, roles,
   skills, reglas y perfiles. El proyecto conserva un snapshot de recursos
   para construir paquetes de contexto sin activar agentes.
4. **Tareas y planes proporcionales.** Registrar contratos, alcance y estado;
   organizar dependencias en un DAG. Organic Driven Development (ODD) usa
   una ruta ligera o SDD formal segun los hechos declarados.
5. **Evidencia, revision y aceptacion.** Registrar verificaciones y review
   o waiver. La ruta formal vincula especificacion, design, asignaciones,
   aprobaciones e informe vigente antes de aceptar una tarea.
6. **Continuidad y recuperacion.** Consultar el estado, reanudar sesiones
   registradas y diagnosticar recursos del snapshot sin repetir comandos ni
   activar trabajo automaticamente.

El descubrimiento no demuestra comprension semantica del codigo. La persona
o el agente debe investigar y decidir que verificaciones son apropiadas.
Las reglas del proyecto y los permisos del propietario prevalecen sobre las
sugerencias del harness.

## Inicio

Se requiere Node.js 22 o posterior. El CLI usa modulos nativos; el servidor
MCP opcional requiere las dependencias declaradas en `package.json`.

Desde la raiz del repositorio:

```powershell
node ./bin/tasksystem.mjs inspect --project "C:\ruta\mi-proyecto"
node ./bin/tasksystem.mjs init --project "C:\ruta\mi-proyecto"
node ./bin/tasksystem.mjs doctor --project "C:\ruta\mi-proyecto"
```

`inspect` no escribe ni ejecuta los comandos que descubre. `init` interactivo
pregunta por la configuracion, muestra los archivos propuestos y solicita
confirmacion explicita; la respuesta por defecto es no. `doctor` revisa el
estado de la configuracion y los archivos generados.

Tambien se puede usar un archivo de respuestas:

```powershell
node ./bin/tasksystem.mjs init --project "C:\ruta\mi-proyecto" --answers "C:\ruta\respuestas.json"
```

Con `--answers` y sin `--apply`, `init` solo presenta el plan. Agregar
`--apply` autoriza la creacion de los archivos propuestos, no la ejecucion
de comandos ni el reemplazo de contenido existente. `--yes` y `--force` no
son opciones de bypass. Las rutas de artefactos deben permanecer dentro del
proyecto; una configuracion alternativa se indica con `--config`.
Consultar el [ejemplo de respuestas](examples/answers.json) y su
[esquema](schemas/answers.schema.json).

## Organic y SDD

La metodologia se selecciona al incorporar el proyecto:

| Modo | Uso |
| --- | --- |
| `manual` | Compatibilidad con tareas V1, sin migracion implicita. |
| `organic-sdd` | Ruta ligera o formal segun los hechos declarados. |
| `sdd` | Referencias formales para trabajo de cambio. |

Una configuracion antigua sin metodologia se interpreta como `manual` sin
reescribir sus bytes. En un proyecto interactivo nuevo se propone
`organic-sdd`, sujeto a confirmacion. Los controles de una tarea V2 no se
desactivan por cambiar el modo del proyecto a `manual`.

La clasificacion considera intencion, autorizacion, comprension,
incertidumbre, riesgo y continuidad declarados; no se basa en el numero de
lineas del diff. Una consulta de solo lectura no autoriza cambios. La
autorizacion ausente o rechazada, la comprension insuficiente, la
incertidumbre pendiente o el riesgo desconocido bloquean la ruta de cambio.
Una tarea ligera no requiere inventar artefactos formales.

En SDD, cada tarea formal, incluidas las preparatorias, necesita al menos un
escenario asignado. Un plan debe cubrir todos los escenarios de su
especificacion; las tareas comprueban sus propias asignaciones y sus
dependencias. ACT y ACCEPT revalidan las condiciones y aprobaciones
aplicables. Una consulta metodologica no sustituye permisos humanos ni
permisos del anfitrion. Ver [Organic y SDD](docs/methodology.md).

## Comandos y continuidad

```powershell
node ./bin/tasksystem.mjs catalog list command
node ./bin/tasksystem.mjs pipeline --project "C:\ruta\mi-proyecto" --mode plan
node ./bin/tasksystem.mjs plan create --project "C:\ruta\mi-proyecto" --input plan.json
node ./bin/tasksystem.mjs plan next entrega --project "C:\ruta\mi-proyecto"
```

Los aliases de workflow, como `pipeline`, `spec`, `audit` o `research`,
entregan procedimientos y contexto; no ejecutan modelos, agentes ni scripts.
Los planes guardan dependencias; los artefactos conservan especificaciones,
designs, informes y otros registros. Las sesiones registran operaciones y
presupuesto explicito; reanudarlas recupera contexto, no repite acciones.
Las creaciones JSON usan vista previa por defecto y requieren `--apply`;
las operaciones historicas de tarea mantienen su comportamiento previo.

Los ejemplos antiguos de tareas y planes sin referencias formales
corresponden a `manual`; el ejemplo de respuestas incluido selecciona
`organic-sdd`. Consultar [workflows y continuidad](docs/workflows.md) y
[flujo de tareas](docs/task-workflow.md) antes de aplicar operaciones.

## Anfitriones y limites de confianza

Se generan propuestas, comprobadas en fixtures locales, para Claude Code,
Codex, OpenCode, Devin Local/CLI y Google Antigravity. Los puentes nativos
y fragmentos MCP son propuestas para revision y activacion manual, no
integraciones certificadas ni una garantia de equivalencia de permisos o
comportamiento. Devin Cloud no se considera equivalente a Local/CLI. Ver
[formatos nativos](docs/native-hosts.md).

- No hay ejecutor de modelos ni ejecucion automatica de agentes o SDK de
  anfitriones. Las instrucciones no son un sandbox ni interceptan todas las
  herramientas nativas.
- El MCP opcional ofrece consultas de solo lectura; no ejecuta shell ni
  modifica tareas. Los presupuestos cuentan operaciones registradas, no
  todas las llamadas del anfitrion, tokens ni gasto.
- Los hashes vinculan registros y evidencia declarada; no prueban ejecucion
  real, identidad de actores o revisores, ni el contenido completo del
  worktree. Una review independiente o waiver es una declaracion del proceso.
- Las comprobaciones de rutas y locks no constituyen una transaccion
  serializable entre todos los archivos ni aislamiento del sistema operativo.
  Los cuerpos libres pueden contener datos sensibles y deben revisarse antes
  de persistirse o compartirse.
- No se ejecutan automaticamente comandos descubiertos, instalaciones,
  publicaciones u operaciones Git. Ver el
  [modelo de seguridad](docs/security.md).

## Verificacion

La suite local completa termino con 522 pruebas aprobadas y ninguna fallida
en Windows, Node.js v26.8.1 y npm 11.6.0; la tanda focalizada CLI/MCP
registro 31 aprobadas. El alcance, los resultados historicos y la reproduccion
se documentan en [verificacion](docs/verification.md). Estas pruebas no
certifican los cinco anfitriones ni una ejecucion real del trabajo declarado.
El [workflow de GitHub Actions](.github/workflows/verify.yml) se activa solo
manualmente y aun no se ha ejecutado.

## Codigo y licencia

El repositorio puede estar disponible para lectura de su codigo fuente, pero
esa disponibilidad no concede una licencia de codigo abierto ni de
redistribucion. `package.json` conserva `private: true` y `UNLICENSED`;
no se publica un paquete npm. El material heredado permanece fuera del
circuito activo y sujeto a revision de procedencia y derechos.

## Documentacion

- [Arquitectura](docs/architecture.md)
- [Incorporacion y personalizacion](docs/onboarding.md)
- [Compatibilidad y fuentes oficiales](docs/compatibility.md)
- [Seguridad y modelo de confianza](docs/security.md)
- [Migracion y limitaciones conocidas](docs/migration.md)
- [Destino de comandos, agentes, skills, reglas y referencias](docs/component-migration.md)
- [Flujo de tareas y evidencias](docs/task-workflow.md)
- [Organic, SDD, aprobaciones y limites de evidencia](docs/methodology.md)
- [Workflows y continuidad](docs/workflows.md)
- [Verificacion y reproduccion](docs/verification.md)
- [Informe completo del sistema](docs/system-report.md)
- [Contrato del producto](docs/product-contract.md)
- [Contrato de implementacion](docs/implementation.md)
