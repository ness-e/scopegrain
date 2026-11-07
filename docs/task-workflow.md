# Flujo de tareas y evidencias

Descripcion factual de los comandos de tarea, la progresion de revision y el
formato de evidencias segun `policy/workflow.json` y
`docs/implementation.md`. Los ejemplos son sinteticos: no son resultados de
ejecucion.

## Estados y transiciones

La maquina de estados canonica esta en `policy/workflow.json`:

```text
PLAN -> ACT | RESEARCH | STALL
ACT -> VERIFY | STALL
VERIFY -> COLLATERAL | EVALUATE | ACT | STALL
COLLATERAL -> RESEARCH | ACT | EVALUATE | STALL
RESEARCH -> PLAN | ACT | STALL
EVALUATE -> REVIEW | ACT | STALL
REVIEW -> ACCEPT | ACT | STALL
ACCEPT -> CLOSE | ACT | STALL
STALL -> PLAN
CLOSE -> (terminal)
```

Acciones permitidas por estado (tambien en la politica): `read` en todos;
`research` en PLAN/COLLATERAL/RESEARCH; `propose` en PLAN/ACT/VERIFY/
COLLATERAL/RESEARCH; `edit` solo en ACT; `verify` en VERIFY; `evaluate` en
EVALUATE; `review` en REVIEW.

## Comandos CLI

```powershell
# Crear (estado PLAN, revision 0, UUID propio)
node .\bin\tasksystem.mjs task create --project P --title "T" --contract "C" --author "ctx-a" [--scope "a,b"]

# Listar / mostrar
node .\bin\tasksystem.mjs task list --project P
node .\bin\tasksystem.mjs task show --project P <UUID>

# Transicionar (CAS obligatorio con --revision N)
node .\bin\tasksystem.mjs task transition --project P <UUID> ACT --revision 0
node .\bin\tasksystem.mjs task transition --project P <UUID> VERIFY --revision 1 [--evidence evidence.json]

# Comprobar una accion en el estado actual
node .\bin\tasksystem.mjs task check-action --project P <UUID> edit
```

`--config` apunta a una config alternativa en cualquiera de ellos.
`--evidence` solo acepta las claves `verification` y/o `review`.

## Progresion tipica

1. `create` -> PLAN, revision 0.
2. `transition ... ACT --revision 0` -> ACT, revision 1.
3. `VERIFY --revision 1` -> revision 2.
4. `EVALUATE --revision 2` -> revision 3.
5. `REVIEW --revision 3` -> revision 4.
6. `ACCEPT --revision 4 --evidence e.json` -> revision 5, exige evidencia.
7. `CLOSE --revision 5` -> revision 6, terminal.

Si la revision esperada no coincide con la almacenada: `REVISION_MISMATCH`.
Una transicion prohibida por la politica: `INVALID_TRANSITION`. Un lock
existente (`<id>.json.lock`): `TASK_LOCKED`, nunca recuperado
automaticamente.

## Formato de evidencia (attestations declaradas)

`verification` exige checks no vacios; cada check requiere `command`, `cwd`,
`status:"pass"` (unico aceptado por la politica) y `evidence` no vacio.
`review` admite dos modos, ambos con `verdict:"approve"`:

```json
{
  "verification": {
    "checks": [
      {"command": "npm test", "cwd": ".", "status": "pass", "evidence": "salida.log"}
    ]
  },
  "review": {
    "mode": "fresh", "reviewer": "agente-b",
    "authorContext": "ctx-a", "reviewerContext": "ctx-b",
    "verdict": "approve"
  }
}
```

Alternativa `waived`: `{"mode":"waived","owner":"...","reference":"...",
"reason":"...","verdict":"approve"}`. En modo `fresh`, `authorContext` debe
coincidir con el autor almacenado y `reviewerContext` debe ser no vacio y
distinto. Son
declaraciones registradas, no identidad autenticada.

## Invalidacion

- Volver a `ACT` borra `verification` y `review` almacenados; no se puede
  arrastrar aprobacion de una implementacion anterior.
- Adjuntar una nueva `verification` sin `review` en la misma llamada
  invalida la review previa.
- Una transicion rechazada por validacion o por la politica deja el
  archivo, el estado y la revision intactos. Esto no promete recuperacion
  ante fallos de hardware o corte de energia a mitad de escritura.

## Alcance y lecturas

`scope` es una lista de rutas relativas contenidas y seguras (se validan
como destinos: sin `..`, enlaces ni prefijos reservados). `list` devuelve
`{tasks, malformed}`; los archivos corruptos o con nombre no-UUID se
reportan, nunca se descartan en silencio.
