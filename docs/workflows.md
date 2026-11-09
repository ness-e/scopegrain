---
title: Workflows, plans and operational continuity
kind: guide
---
# Workflows y continuidad

Todos los comandos sobre un proyecto reciben `--project P` y admiten
`--config ruta/relativa/config.json`. Los ejemplos son sintaxis y datos
sinteticos, no evidencia de ejecucion.

## Catalogo y procedimientos

```powershell
node bin/tasksystem.mjs catalog list
node bin/tasksystem.mjs catalog show agent reviewer
node bin/tasksystem.mjs catalog check
node bin/tasksystem.mjs catalog legacy skill
node bin/tasksystem.mjs catalog legacy-show skill ponytail
node bin/tasksystem.mjs workflow audit --project P --mode review --profile core
```

Un paquete resuelve comando, roles, skills, reglas, referencias, perfil,
rutas configuradas y, con `--task UUID`, estado y acciones permitidas.
Los paths de recursos son relativos a `resourceRoot`, que identifica
el directorio de configuracion dentro del proyecto. `paths` contiene
destinos de artefactos relativos a la raiz del proyecto.
El perfil core siempre complementa cualquier perfil elegido.
No se ejecuta automaticamente ninguna instruccion ni se crea un agente.

Los aliases compatibles usan la misma interfaz `workflow`, no implementaciones
divergentes. Los modos declarados se validan; nombres o modos desconocidos
se rechazan. Los perfiles web/rust/python/database son optativos y no
instalan stacks, herramientas ni servicios.

## Planes con dependencias

El siguiente ejemplo V1 de `plan create --input plan.json` requiere modo
`manual`. En modo Organic/SDD, usar referencias estructuradas reales
`specId`, `designId` y escenarios por tarea; ver [metodologia](methodology.md).

```json
{
  "key": "entrega",
  "title": "Cambio acotado",
  "authorContext": "implementacion-a",
  "tasks": [
    {"key": "base", "title": "Base", "contract": "Contrato verificable", "scope": ["src"], "dependsOn": []},
    {"key": "api", "title": "Interfaz", "contract": "Contrato de interfaz", "scope": ["src"], "dependsOn": ["base"]}
  ]
}
```

La previsualizacion no escribe. `--apply` crea exclusivamente plan y tareas.
No se sobrescribe un plan con la misma clave. Las claves son minusculas
alfanumericas con guiones, hasta 64 caracteres; se permiten 1..100 tareas.
Los ciclos, dependencias inexistentes y scopes inseguros se rechazan.
Tambien se revalidan los registros persistidos: alterar el JSON no evita
las comprobaciones de DAG, identidad, timestamps o tamano.

`plan list`, `plan show entrega` y `plan next entrega` leen registros
actuales. Una dependencia libera a su sucesora al llegar a CLOSE, no al
declararse terminada en una conversacion. Los estados ready, active,
blocked y closed no sustituyen la maquina de estados de cada tarea.
La ejecucion utiliza [transiciones y evidencias](task-workflow.md).

## Artefactos inmutables

```powershell
node bin/tasksystem.mjs artifact add review --project P --input review.json
node bin/tasksystem.mjs artifact list review --project P
node bin/tasksystem.mjs artifact show review UUID --project P
```

Entrada: `{"title":"Revision","body":"Hallazgos y limites","references":[]}`.
Las referencias son rutas relativas seguras del proyecto; las citas
externas pueden documentarse en el cuerpo. `--apply` autoriza la creacion.
La identidad es un UUID propio; no se edita un artefacto historico para
reescribir evidencia. La procedencia contextual se escribe en el cuerpo.
El limite de documento aplica al JSON serializado completo, no solo al
texto de entrada; un documento demasiado grande se rechaza antes de
persistirlo (`DOCUMENT_TOO_LARGE`).

| Tipo | Destino configurado |
| --- | --- |
| spec | plans/specs |
| design (V2) | plans/designs |
| report | reports |
| review | reports/reviews |
| research | research |
| decision | decisions |
| lesson | memory/lessons |
| handoff | memory/handoffs |

Por defecto, todos esos destinos viven bajo `.tasksystem/`, no `docs/`.
Un proyecto puede conservar rutas antiguas explicitamente elegidas; nunca
se mueven o eliminan archivos existentes por un cambio de defaults.

El `spec` generico V1 no satisface una referencia formal. Las operaciones
tipadas distinguen especificacion estructurada, design ligado a su digest
e informe `report` ligado a una revision REVIEW. Un outcome no es un nuevo
tipo de carpeta ni una certificacion de los archivos citados.

## Aprobaciones y acciones

La nueva superficie CLI/MCP tiene una tanda focalizada ejecutada y la suite
integral local se completo; sus resultados y limites se describen en
[verificacion](verification.md). Los pilotos nativos siguen pendientes.

Las operaciones `approval target/create/show/answer` separan identificacion
del contenido, pregunta, lectura y respuesta. Previsualizar una respuesta
no modifica el consentimiento persistido. Aplicarla requiere revision y
`expectedTargetDigest` actuales, revalidados bajo lock; no es un overwrite
generico ni una aprobacion de herramientas nativas.

`methodology check` consulta ACT o ACCEPT sin escribir. El paquete de
workflow incluye modo y resultado metodologico y obtiene sus acciones de
la misma evaluacion. Una revocacion elimina `edit` cuando corresponde;
consultar los metadatos no sustituye la arista del workflow o los permisos
del anfitrion. Los presupuestos de sesiones usan esas acciones efectivas.

## Sesiones y recuperacion

```powershell
node bin/tasksystem.mjs session create --project P --task UUID --limit 20
node bin/tasksystem.mjs session record SESSION_UUID --project P --revision 0 --input event.json
node bin/tasksystem.mjs session resume SESSION_UUID --project P
```

Evento: `{"action":"read","evidence":"Fuente inspeccionada","context":"paso-1"}`.
Crear o registrar requiere `--apply`. El registro usa CAS, lock exclusivo
y validacion de la accion contra el estado actual de la tarea.
El limite explicito es de 1..10000 operaciones registradas. Agotamiento,
revision antigua o accion no permitida no avanzan la sesion.
Un append cuyo reloj retrocede respecto del ultimo evento se rechaza,
sin reordenar la historia ni modificar los bytes existentes.

`resume` devuelve estado y evidencia actuales, eventos y presupuesto
restante; no repite comandos, limpia locks ni reactiva trabajo por su cuenta.
Los documentos operativos tienen un limite de 1 MiB. El presupuesto no
cuenta llamadas nativas no registradas, tokens, dinero ni tiempo.

## Integraciones

Los puentes nativos y fragmentos MCP se entregan para revision dentro de
`integrations/` del harness. Activarlos requiere copiar o fusionar lo
apropiado en el anfitrion tras revisar su version y permisos.
Ver [integraciones nativas](native-hosts.md) y
[modelo de seguridad](security.md). No existe una interceptacion universal.
