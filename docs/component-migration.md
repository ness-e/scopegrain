# Componentes heredados y destino de la migracion

## Estado real

TaskSystem tiene un nucleo nuevo, no una conversion completa del harness
anterior. El contenido original de esta copia sigue en `legacy/opencode/`;
no se ha eliminado ni activado automaticamente. La carpeta `.opencode`
del proyecto de origen no se modifica.

Inventario por enumeracion local de archivos, no por los conteos antiguos
de los manifiestos:

| Componente heredado | Inventario | Activo ahora |
| --- | --- | --- |
| `commands/` | 13 archivos Markdown | No; el CLI nuevo es otra interfaz |
| `agents/` | 11 definiciones | No hay registro ni despacho de estos roles |
| `skills/` | 198 carpetas directas y 197 archivos `SKILL.md` | Solo tres skills nuevas, no sustituyen el catalogo |
| `rules/` | 14 reglas y un README | No; la politica nueva solo cubre su propio flujo |
| `references/` | 24 archivos | No se cargan como referencias del producto nuevo |
| `task-system/` | 82 archivos recursivos | No; solo se implemento una parte de sus conceptos |
| `mcp/` | Un servidor de medios | No |
| `mcp-profiles/` | Tres JSON, README y script selector | No |
| `plugins/` | `ponytail.ts` | No |
| `opencode-loop/` | 52 archivos recursivos | No; son estado e historico, no una biblioteca portable |

Las tres skills activas son `project-onboarding`, `contract-execution` e
`independent-review`. El CLI actual expone `inspect`, `init`, `doctor`,
`mcp`, `task create`, `task list`, `task show`, `task transition` y
`task check-action`. No ofrece aun `/pipeline`, `/audit` ni los demas
comandos de trabajo heredados.

**Conservado no significa migrado.** `legacy/opencode/` esta ignorado por
Git mientras se revisan licencias y posibles secretos. Un clon del nuevo
repositorio no incluira ese archivo local. Antes de distribuir el catalogo
habra que incorporar expresamente cada pieza aprobada y su procedencia.

## Organizacion objetivo: propuesta, no implementada

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
docs/                 Arquitectura, contratos, estado y evidencia de migracion
legacy/               Copia local de procedencia, nunca fuente activa implicita
```

La separacion conceptual se mantiene: comando = cuando y para que; agente =
responsabilidad; skill = procedimiento; regla = obligacion; referencia =
conocimiento; perfil = especializacion; adaptador = formato y capacidades
reales del anfitrion.

No conviene duplicar once agentes y todo el catalogo cuatro veces. La fuente
de cada comportamiento debe ser unica; el adaptador solo traduce el formato.

## Comandos: conservar las trece intenciones

Esta tabla define el destino propuesto. Ninguna fila afirma que el comando
ya este registrado en Claude, Codex, OpenCode o Devin.

| Comando heredado | Comportamiento a conservar | Cambio necesario |
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
Donde el anfitrion permita registrar comandos nativos se generara esa
integracion; donde no, la misma intencion debe poder invocarse como
procedimiento o skill. No se promete una sintaxis slash identica en todos.

## Agentes: preservar responsabilidades, no acoplamientos

| Rol heredado | Nombre neutral propuesto | Responsabilidad |
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

No se ha hecho una auditoria semantica individual de las 197 skills en esta
etapa. Se propone clasificar cada una antes de activarla:

- **Ingenieria general:** planificacion, especificacion, implementacion
  incremental, debugging, revision, investigacion y documentacion.
- **Stack:** React, Next.js, Python, Rust y otras tecnologias, solo si
  existen o fueron seleccionadas en el proyecto.
- **Dominio:** bases de datos, indices, accesibilidad, medios o diseno,
  seleccionados segun la tarea, no siempre inyectados.
- **Integracion externa:** herramientas, MCP, servicios o plugins con
  dependencias y autorizaciones explicitas.
- **Proyecto:** `vantadb`, `vantadb-mcp` y reglas especificas quedan fuera
  del perfil generico; podran ser un perfil optativo auditado.
- **Solapamiento o shim:** comparar variantes, preservar procedencia y no
  borrar o fusionar solo porque los nombres se parecen.

Cada entrada futura necesita origen/licencia, capacidades requeridas,
dependencias, alcance y estado de validacion. El catalogo y sus indices
deben generarse de una sola fuente, no mantener tres conteos manuales.

## Rules y references

Las reglas mezclan principios generales con decisiones concretas. Por
ejemplo, `api-contract.md` contiene coherencia de APIs, pero tambien rutas,
versiones y bindings de VantaDB. No basta con quitar el prefijo del nombre.

Se propone extraer reglas generales de contrato, evidencia, revisiones y
alcance; mover restricciones de Tokio/PyO3/JS a perfiles de stack; dejar
semantica de WAL, IQL, indices y modelo comercial en perfiles de dominio o
proyecto. Las politicas de release y licencias se acuerdan con cada usuario,
no se deducen solamente de que exista un manifiesto.

Las 24 referencias se conservaran como conocimiento de consulta, despues
de separar checklists reutilizables de arquitectura, rutas, herramientas y
runbooks particulares. Una referencia no adquiere autoridad de seguridad
por ser citada.

## Otros componentes que no deben desaparecer silenciosamente

- **Campaign/C0:** recuperar discovery, planificacion, recuperacion y
  continuidad de forma incremental. La maquina de estados nueva no replica
  todas las herramientas del servidor anterior.
- **Memoria y trazas:** usar destinos aprobados y procedencia por proyecto;
  no importar decisiones o sesiones de VantaDB como memoria de otro repo.
- **Presupuestos:** definir contabilidad y mecanismos observables antes de
  prometer limites sobre llamadas nativas del anfitrion.
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

La etapa siguiente es portar primero un flujo vertical: especificar,
planificar, implementar, verificar, revisar y guardar continuidad. Despues
se incorporan roles especializados, catalogo y extensiones por lotes.

Una pieza solo cambia de pendiente a activa cuando sus referencias y
permisos son coherentes, no impone un dominio, conserva su procedencia y
tiene comprobaciones de comportamiento. Las pruebas del nucleo nuevo no
certifican automaticamente los comandos, agentes ni skills aun archivados.

Pruebas y estado del nucleo: [verificacion](verification.md).
Limites generales: [migracion](migration.md).
