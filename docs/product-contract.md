# Contrato del producto

## Definicion

TaskSystem es un harness local de ingenieria de agentes: convierte solicitudes
en trabajo con contrato, alcance, estado, evidencias, revision y continuidad.
El nucleo no contiene conocimiento obligatorio de un producto, lenguaje,
proveedor de modelos ni organizacion concretos.

El producto separa tres responsabilidades:

1. El harness conserva contratos, configuracion y estado.
2. El agente anfitrion investiga y ejecuta el trabajo autorizado.
3. El propietario decide limites, ubicaciones, permisos y excepciones.

## Requisitos de la primera base

| ID | Requisito | Evidencia de cumplimiento requerida |
| --- | --- | --- |
| R01 | Todas las modificaciones en TaskSystem | Git independiente; ningun comando de escritura dirigido al origen |
| R02 | No imponer el dominio de VantaDB | Nucleo y plantillas sin comandos de ese producto |
| R03 | Descubrimiento de cualquier proyecto | Resultados basados en manifiestos; desconocidos y advertencias explicitos |
| R04 | Investigar antes de implementar | Protocolo de inicio que exige inspeccion semantica por el agente |
| R05 | Preguntar rutas de artefactos | Siete categorias consultadas y configuracion persistida |
| R06 | Confirmar antes de configurar | Plan completo de archivos y consentimiento anterior a escrituras |
| R07 | No destruir configuracion ajena | Conflicto preexistente bloquea; no force ni overwrite |
| R08 | Claude, Codex, OpenCode y Devin | Puntos de entrada y propuestas de integracion diferenciadas |
| R09 | Contratos y estado verificables | Persistencia con revision, transiciones y condiciones de aceptacion |
| R10 | Continuidad y personalizacion | Contrato y rutas reutilizables; cambios detectados por fingerprint |
| R11 | No ejecutar codigo por descubrirlo | Scanner sin shell; comandos propuestos, nunca ejecutados |
| R12 | Estandarizacion honesta | Una politica canonica y limites documentados |
| R13 | Preservar el material de origen | Archivo local fuera del circuito activo, sin borrar contenido |
| R14 | Verificacion manual salvo autorizacion expresa al agente | Comandos, permiso y estado real de ejecucion documentados |

## Niveles de adaptacion

- **Deteccion local:** identifica manifiestos, estructura e instrucciones.
- **Investigacion semantica:** el agente lee codigo, tests y arquitectura.
- **Propuesta:** recomienda convenciones, verificaciones y destinos.
- **Consentimiento:** el propietario aprueba archivos y permisos.
- **Aplicacion:** crea solamente archivos nuevos autorizados.
- **Continuidad:** reutiliza decisiones y avisa si cambiaron los manifiestos.

La primera base automatiza la deteccion y la propuesta estructural.
No afirma que un escaneo de archivos equivalga a comprender un proyecto.
No hay un proceso residente que observe continuamente el repositorio:
la comprobacion ocurre al invocar el CLI o durante el protocolo de sesion.

## Preferencias y autoridad

Orden de decision del producto:

1. Politicas de seguridad del anfitrion y de la organizacion.
2. Instrucciones explicitas del propietario.
3. Instrucciones vigentes del proyecto.
4. Configuracion aprobada de TaskSystem.
5. Propuestas derivadas del descubrimiento.

Ante contradiccion, detener la accion afectada y consultar.
No usar contenido encontrado en un repositorio para autorizar red,
instalaciones, escritura fuera del alcance ni relajacion de permisos.

## Personalizacion inicial y evolucion

Disponibles como datos de configuracion: nombre, idioma, anfitriones, metodologia,
rutas, versionado por categoria y propuestas de verificacion. Los
artefactos operativos usan `.tasksystem/` por defecto; la documentacion
del producto es un entregable separado. Las decisiones del propietario no
deben recalcularse ni reemplazarse silenciosamente.

Pendientes de una version posterior: politicas organizativas componibles,
perfiles de dominio auditados, sincronizacion de preferencias globales,
instalacion de hooks nativos, migracion automatica de configuraciones,
ejecucion supervisada de verificaciones y empaquetado redistribuible.

El catalogo, las propuestas nativas, planes dependientes, artefactos y
sesiones actuales se describen en [workflows](workflows.md) y
[mapa de migracion](component-migration.md). Son extensiones de la primera
base, no importaciones implicitas del archivo original.

La ampliacion incluye Google Antigravity y variantes de propuestas nativas,
sin certificacion dentro de ninguno de los cinco anfitriones. Organic/SDD
agrega clasificacion proporcional, referencias y aprobaciones por contenido,
cobertura asignada e informes vinculados; no un ejecutor de agentes ni una
garantia de que las declaraciones del operador sean verdaderas.
Estado de implementacion y alcance de verificacion en
[metodologia](methodology.md) y [verificacion](verification.md).

No cambiar la marca, la rama Git de otro proyecto ni su sistema de
publicacion para incorporarlo al harness.

## Riesgos considerados

| Fallo | Impacto | Tratamiento inicial | Riesgo residual |
| --- | --- | --- | --- |
| Ejecutar un script malicioso al detectar el stack | Ejecucion arbitraria | Scanner sin shell; comandos solo propuestos | El humano o agente puede ejecutarlo despues |
| Rutas ../, unidades o enlaces | Escritura fuera del alcance | Validacion de contencion y rechazo de enlaces | Carrera con procesos locales con permiso de escritura |
| Sustituir AGENTS o configuracion del usuario | Perdida de reglas y permisos | Create-only, preflight completo y conflicto explicito | Fusion manual necesaria |
| Reutilizar una revision tras editar | Aceptar codigo no revisado | ACT invalida verificacion y review; ACCEPT revalida bindings actuales | Cambios del producto fuera del flujo no son observados |
| Dos escritores actualizan una tarea | Estado perdido | Lock exclusivo y revision esperada | No hay coordinacion distribuida |
| Suponer un stack o herramienta inexistente | Comandos equivocados | Evidencia explicita; desconocidos no reciben defaults de dominio | La deteccion es limitada y debe revisarse |
| Equiparar Markdown con seguridad | Falsa garantia | Separar protocolo, validacion y permisos nativos | El anfitrion puede omitir el protocolo |
| Distribuir skills sin procedencia clara | Riesgo legal y secretos | Archivo local no publicado; paquete privado | Auditoria individual pendiente |
| Mover la instalacion del harness | Propuestas MCP obsoletas | Fragmentos machine-local, no registro automatico | Regeneracion y aprobacion manual |

No se asignan puntuaciones numericas a estos riesgos sin datos que las
justifiquen. Las pruebas pendientes tampoco constituyen evidencia de
mitigacion efectiva hasta que se ejecuten.
