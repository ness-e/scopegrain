# legacy/

Esta carpeta conserva la copia local original del harness del que procede
TaskSystem. No forma parte del producto activo.

## Contenido

- `opencode/` — copia intacta del directorio heredado (agentes, comandos,
  skills, prompts, referencias, reglas y archivos de configuracion
  originales). No se ha modificado su contenido al moverlo.
- `provenance/` — registro de procedencia. `copied-git-pointer.txt`
  conserva el puntero `.git` original, que apuntaba a un gitdir externo
  (`../.git/modules/.opencode`) invalido dentro de esta copia. El Git
  actual de TaskSystem es independiente (rama `develop`).

## Estado de distribucion

Este material **no esta activo** y **no se distribuye** hasta completar una
revision de licencias, datos historicos y posibles secretos. Por ese motivo:

- `legacy/opencode/` esta ignorado por Git en el nuevo repositorio.
- Ningun componente de TaskSystem (CLI, discovery, doctor, MCP) lee ni
  carga esta carpeta; `legacy` es un prefijo excluido en el descubrimiento
  y un destino prohibido en la configuracion.
- El archivo puede contener instrucciones especificas del proyecto de
  origen; no son instrucciones vigentes de TaskSystem.
