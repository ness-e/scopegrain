# Seguridad y modelo de confianza

## Controles implementados; pendientes de verificacion

Los siguientes controles estan implementados en el codigo; su
comportamiento efectivo queda pendiente de la ejecucion de las pruebas
descritas en `docs/verification.md`.

- **Sin ejecucion:** el nucleo no usa `child_process`; el scanner no ejecuta
  ni expande comandos descubiertos. Las propuestas llegan con
  `approved:false`.
- **Sin red:** ningun modulo abre sockets; el servidor MCP usa stdio.
- **Rutas contenidas:** toda ruta almacenada es relativa al proyecto, sin
  `..`, NUL, dos puntos (unidades/ADS), absolutas POSIX ni win32, UNC ni
  segmentos vacios o `.`. Los prefijos `.git`, `node_modules`, `legacy` y
  `.opencode` estan vetados como destinos.
- **Anti-enlaces:** `lstat` en cada ancestro existente; symlinks/junctions
  se rechazan incluso cuando apuntan dentro. El root elegido debe existir y
  ser directorio real (no enlace).
- **Lectura acotada:** solo manifiestos de lista permitida, <=128 KiB,
  profundidad <=4, <=1000 entradas. Nunca se leen `.env`, llaves ni
  credenciales, ni el texto de AGENTS/CLAUDE/README hacia los resultados.
- **Create-only:** preflight completo antes de escribir; conflictos
  (distinto, enlace, directorio) bloquean todo el plan. Escrituras con flag
  exclusivo `wx`; el rollback solo retira lo creado por esa operacion.
- **Estado consistente:** lock exclusivo por tarea + CAS de revision +
  temporal exclusivo y rename. Un lock ajeno es conflicto, no se recupera.
- **Sin secretos en artefactos:** los fragmentos MCP contienen solo rutas y
  nombres; init nunca pregunta por secretos.
- **Sin flags de bypass:** `--yes` y `--force` se rechazan; no hay escritura
  implicita en sesiones sin TTY.

## Lo que el codigo NO garantiza

- **Markdown no es enforcement.** Las instrucciones generadas son
  convenciones que el agente puede ignorar; no hay sandbox sobre las
  herramientas nativas del anfitrion.
- **Attestations, no identidad.** `authorContext`/`reviewerContext` y las
  evidencias son declaraciones registradas; no hay autenticacion
  criptografica ni observacion de lo que el anfitrion hizo fuera del flujo.
- **Contencion vs. escritura in-situ.** La validacion se repite justo antes
  de escribir, pero sigue existiendo una ventana residual: cualquier
  proceso local con capacidad de escritura (no necesariamente privilegiado
  ni malicioso) podria crear enlaces o ficheros entre la comprobacion y la
  escritura.
- **Sin coordinacion distribuida.** El lock cubre procesos que usan
  TaskSystem; otras herramientas pueden editar los archivos de tareas.
- **Scope y evidencia declarados.** Que un check figure como `pass` no
  prueba que se ejecuto; la confianza la aporta el proceso humano.
- **El archivo legacy no es seguro por omission.** `legacy/opencode/` puede
  contener secretos historicos; esta fuera del circuito activo y de Git,
  pendiente de auditoria antes de cualquier distribucion.

## Recomendaciones de despliegue

- Revisar `integrations/*.json|toml` antes de fusionarlos en el anfitrion.
- No commitear fragmentos machine-local sin revisar las rutas absolutas.
- Mantener `tests/.tmp/`, `.tasksystem/` y `legacy/opencode/` fuera de
  control de versiones (ya cubierto por `.gitignore`).
- Tratar cualquier output de discovery como evidencia, no como autorizacion
  para ejecutar comandos.
