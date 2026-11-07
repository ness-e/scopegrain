# Componentes heredados y destino de la migracion

## Estado real

TaskSystem tiene un nucleo nuevo, no una conversion completa del harness
anterior. El contenido original de esta copia sigue en `legacy/opencode/`;
no se ha eliminado ni activado automaticamente. La carpeta `.opencode`
del proyecto de origen no se modifica.

Inventario por enumeracion local de archivos, no por los conteos antiguos
de los manifiestos:

| Componente heredado | Inventario capturado | Tratamiento actual |
| --- | --- | --- |
| `commands/` | 13 archivos Markdown | Trece procedimientos nuevos en catalogo y aliases CLI; no se ejecuta shell |
| `agents/` | 11 definiciones | Once roles neutrales y propuestas nativas, sin despacho automatico |
| `skills/` | 198 carpetas directas y 197 archivos `SKILL.md` | Inventario y triage individuales; cuarenta skills activas nuevas, no importacion masiva |
| `rules/` | 14 reglas y un README | Dieciocho reglas nuevas, seleccionadas por comando/perfil |
| `references/` | 24 archivos | Veinticuatro referencias neutrales nuevas, bajo demanda |
| `task-system/` | 82 archivos recursivos | Nucleo nuevo con tareas, planes, artefactos y sesiones; no replica todas las herramientas |
| `mcp/` | Un servidor de medios | No |
| `mcp-profiles/` | Tres JSON, README y script selector | No |
| `plugins/` | `ponytail.ts` | No |
| `opencode-loop/` | 52 archivos recursivos | No; son estado e historico, no una biblioteca portable |

La fuente activa es `catalog/manifest.json`: 111 recursos (13 comandos,
11 agentes, 40 skills, 18 reglas, 24 referencias y 5 perfiles).
Las tres skills iniciales se complementan con 37 procedimientos nuevos
de ingenieria general. No se certifica equivalencia textual o funcional
con cada original; se conservan los temas y los contratos neutrales.

El CLI incorpora `catalog`, `workflow`, `plan`, `artifact` y `session`
ademas de inspect/init/doctor/mcp/task. Los aliases de los trece comandos
producen paquetes para el anfitrion, no procesos LLM autonomos.
Ver [operaciones y formatos](workflows.md).

**Conservado no significa migrado.** `legacy/opencode/` esta ignorado por
Git mientras se revisan licencias y posibles secretos. Un clon del nuevo
repositorio no incluira ese archivo local. Antes de distribuir el catalogo
habra que incorporar expresamente cada pieza aprobada y su procedencia.

## Organizacion canonica implementada

```text
src/core/             Contratos, estado, configuracion y validaciones
src/discovery/        Evidencia del proyecto y propuestas
src/adapters/         Proyeccion segun capacidades del anfitrion
commands/             Intenciones y routers portables, no shell scripts
agents/               Roles canonicos sin nombres ni permisos de VantaDB
skills/               Procedimientos reutilizables cargados bajo demanda
rules/                Reglas generales y criterios de aplicacion
references/           Material de consulta, no instrucciones siempre activas
profiles/             Especializaciones optativas de stack, dominio y proyecto
templates/hosts/      Formatos nativos generados desde fuentes canonicas
policy/               Politicas que el codigo realmente valida
catalog/              Manifest activo e inventarios de procedencia/triage
docs/                 Documentacion del producto, no artefactos de tareas
.tasksystem/          Planes, task files, informes, reviews, memoria y estado
legacy/               Copia local de procedencia, nunca fuente activa implicita
```

La separacion conceptual se mantiene: comando = cuando y para que; agente =
responsabilidad; skill = procedimiento; regla = obligacion; referencia =
conocimiento; perfil = especializacion; adaptador = formato y capacidades
reales del anfitrion.

No conviene duplicar once agentes y todo el catalogo cuatro veces. La fuente
de cada comportamiento debe ser unica; el adaptador solo traduce el formato.

## Comandos: conservar las trece intenciones

Esta tabla define las intenciones de los procedimientos canonicos nuevos.
Ninguna fila afirma que ya esten activados dentro de un anfitrion.

| Comando heredado | Intencion conservada | Contrato neutral |
| --- | --- | --- |
| `/pipeline` | Planificar, ejecutar una tarea o recorrer un plan | Resolver rutas desde configuracion; delegar segun capacidades reales |
| `/spec` | Especificar antes de implementar | Investigar primero y preguntar solo lo que no responde el repositorio |
| `/backlog` | Consultar trabajo activo y recomendar prioridad | No asumir `docs/dev/Backlog.md` ni taxonomias de VantaDB |
| `/status` | Estado consolidado de trabajo y verificaciones | Leer los artefactos configurados; no archivos historicos de otro proyecto |
| `/audit` | Quick, certify, review y full | Un procedimiento comun con verificaciones aprobadas por proyecto; no imponer Cargo |
| `/harness` | Auditar la salud del propio sistema de agentes | Validar catalogos, enlaces, roles, perfiles y adaptadores; doctor actual es mas limitado |
| `/research` | Investigacion por area y sintesis de decisiones | Descubrir areas del proyecto y registrar fuentes; red requiere permiso |
| `/ship` | Preflight y decision de entrega con recuperacion prevista | Separar evaluar de publicar; aprobar cada operacion con efectos externos |
| `/rollback` | Recuperacion de una entrega fallida | Plan exacto y autorizacion; nunca inferir permiso para perder datos |
| `/code-simplify` | Simplificacion con comportamiento preservado | Aplicar convenciones y pruebas del proyecto, no una lista fija de modulos |
| `/codeGraph` | Analisis estructural y de impacto | Grafo opcional; informar degradacion si solo hay lectura o busqueda |
| `/cleanCA` | Revision de codigo y arquitectura, solo informe | Eliminar scopes fijos de crates y excepciones particulares de VantaDB |
| `/webperf` | Rendimiento web, solo cuando procede | Perfil web optativo; diferenciar hipotesis estaticas de mediciones reales |

Un comando conversacional y un comando de terminal son interfaces distintas.
Se generan propuestas con namespace `tasksystem-`, como comandos o skills
segun el anfitrion. No se promete una sintaxis slash identica ni se activan
esos archivos al inicializar. Ver [puentes nativos](native-hosts.md).

## Agentes: preservar responsabilidades, no acoplamientos

| Rol heredado | Rol neutral registrado | Responsabilidad |
| --- | --- | --- |
| `vanta-lead` | `lead` | Coordinacion, decisiones humanas y entrega autorizada |
| `vanta-arch` | `architect` | Arquitectura, interfaces y tradeoffs |
| `vanta-worker` | `implementer` | Implementacion dentro del contrato |
| `vanta-engine` | `algorithm-specialist` | Algoritmos del dominio; especializacion opcional |
| `vanta-audit` | `security-auditor` | Seguridad y riesgos, sin implementar sus propios fixes |
| `vanta-chaos` | `resilience-tester` | Fuzzing y fallos controlados en entornos autorizados |
| `vanta-tuner` | `performance-engineer` | Medicion, perfiles y optimizacion con evidencia |
| `vanta-docs` | `documentation` | Documentacion y coherencia con APIs reales |
| `vanta-research` | `researcher` | Investigacion y fuentes verificables |
| `vanta-review` | `reviewer` | Revision independiente de implementacion y contrato |
| `vanta-harness` | `harness-maintainer` | Salud y deriva del harness |

La configuracion no debe inventar permisos que el anfitrion no aplica. Un
rol escrito en Markdown no crea un subagente ni un aislamiento de contexto.
Si no existe delegacion o revision independiente real, el adaptador debera
declararlo y pedir intervencion humana o una excepcion explicita.

## Skills: catalogo amplio, carga selectiva

Se capturaron las 197 skills individualmente con hashes, indicadores y
bloqueos en `catalog/legacy-inventory.json`. El triage por identificador
esta en `catalog/legacy-classification.json`:

- **Ingenieria general (37):** planificacion, especificacion, implementacion
  incremental, debugging, revision, investigacion y documentacion.
- **Stack (16):** procedimientos de tecnologias concretas, solo si
  existen o fueron seleccionadas en el proyecto.
- **Dominio (112):** datos, accesibilidad, contenido, documentos o diseno,
  seleccionados segun la tarea, no siempre inyectados.
- **Integracion externa (28):** herramientas, MCP, servicios o plugins con
  dependencias y autorizaciones explicitas.
- **Proyecto (4):** `vantadb`, `vantadb-mcp`, `vanta-design-orchestrator`
  y `documentation-skill`, fuera del perfil generico.

Las categorias son rutas de revision, NO auditorias de los cuerpos,
licencias o dependencias. Los 197 originales siguen bloqueados; los
reemplazos frescos no autorizan su redistribucion. Las 160 especialidades
no generales no se activan de forma automatica por detectar un stack.
Los procedimientos nuevos son utilizables sin leer el archivo privado.

`catalog legacy [KIND]` consulta el inventario capturado sin servir cuerpos.
`catalog legacy-show KIND ID` muestra el detalle y, si existe, el recurso
actual relacionado. Captura historica y estado activo se distinguen.
Antes de activar un original faltan revision semantica, licencia,
dependencias, capacidades y pruebas de comportamiento.

## Rules y references

Las reglas mezclan principios generales con decisiones concretas. Por
ejemplo, `api-contract.md` contiene coherencia de APIs, pero tambien rutas,
versiones y bindings de VantaDB. No basta con quitar el prefijo del nombre.

Las fuentes nuevas separan reglas generales de contrato, evidencia,
revision y alcance de especializaciones optativas. Los perfiles core,
web, rust, python y database no imponen IQL, WAL ni un modelo comercial.
Core siempre complementa el perfil elegido, sin asumir herramientas.
Las politicas de release y licencias se acuerdan con el propietario.

Las 24 referencias activas son nuevas sintesis neutrales de consulta;
sus originales se conservan por separado. Una referencia no adquiere
autoridad de seguridad por ser citada.

## Otros componentes que no deben desaparecer silenciosamente

- **Campaign/C0:** tareas con estado, DAG, artefactos y sesiones nuevos.
  No se replica cada herramienta del servidor anterior.
- **Memoria y trazas:** usar destinos aprobados y procedencia por proyecto;
  no importar decisiones o sesiones de VantaDB como memoria de otro repo.
- **Presupuestos:** limite sobre operaciones registradas en sesiones,
  no sobre llamadas nativas, tokens, dinero o ejecuciones omitidas.
- **MCP y perfiles:** mantener definiciones neutrales y generar propuestas
  por host; no copiar servidores globales, credenciales o rutas personales.
- **Ponytail:** preservar sus principios si se eligen, pero el plugin
  `ponytail.ts` usa API y estado de OpenCode y depende de archivos globales.
  No se considera un plugin portable por cambiar de carpeta.
- **Sandbox:** no reutilizar el aislamiento debil como garantia fuerte.
- **Self-modification:** mantenimiento del harness con revision y permiso,
  no autorizacion implicita para que se cambie sus propias restricciones.
- **Historicos:** conservar sesiones y logs como archivo privado; no
  publicarlos ni migrarlos automaticamente a cada proyecto.

## Criterio de migracion completa

El nucleo permite el flujo vertical especificar -> planificar -> implementar
con el anfitrion -> verificar -> revisar -> cerrar -> recuperar contexto.
La evidencia ejecutada y sus huecos estan en [verificacion](verification.md).
No se declara equivalencia integral con plugins, sandbox o especialidades
que siguen archivados, ni certificacion real en los cuatro productos.

Una pieza solo cambia de pendiente a activa cuando sus referencias y
permisos son coherentes, no impone un dominio, conserva su procedencia y
tiene comprobaciones de comportamiento. Las pruebas del nucleo nuevo no
certifican automaticamente los comandos, agentes ni skills aun archivados.

Pruebas y estado del nucleo: [verificacion](verification.md).
Limites generales: [migracion](migration.md).
