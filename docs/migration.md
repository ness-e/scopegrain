# Migracion y limitaciones conocidas

## Procedencia

Este repositorio procede de una copia local del harness original. La copia
se conserva intacta en `legacy/opencode/` (ver `legacy/README.md`): no esta
activa, ningun componente la carga y esta excluida del descubrimiento, de
los destinos permitidos y del control de versiones hasta completar la
revision de licencias, datos historicos y posibles secretos.

El puntero `.git` original apuntaba a un gitdir externo
(`../.git/modules/.opencode`); esta archivado en
`legacy/provenance/copied-git-pointer.txt`. El Git actual es independiente
(rama `develop`) y tiene raiz en esta carpeta.

## Que se migro y que no

- **No se importa el archivo original:** ningun recurso original se activa
  por copia ni por sustitucion masiva de nombres.
- **Fuentes nuevas:** procedimientos separados, roles neutrales, skills,
  reglas, referencias, prompts y perfiles en `resources/manifest.json`.
  Los aliases conservan compatibilidad sin duplicar la fuente editable.
  No certifican equivalencia con cada recurso original.
- **Nucleo nuevo:** CLI, descubrimiento, config, bootstrap, adaptadores,
  tareas, catalogo, workflows, planes, artefactos, sesiones, versionado,
  doctor y MCP son implementaciones nuevas; no son una traduccion directa
  del codigo anterior. Ver [workflows](workflows.md).
- **Procedencia:** el inventario captura individualmente 268 entradas
  de ocho tipos, hashes, indicadores y bloqueos de activacion, ademas del
  directorio de recursos sin SKILL.md. La clasificacion de las 197 skills
  es triage por identificador, no una auditoria semantica o de licencia.
- **Dependencias:** solo `@modelcontextprotocol/sdk` y `zod` declaradas,
  para el servidor MCP opcional. El CLI no las usa.

## Limitaciones conocidas

- La primera base supero 73 pruebas locales; no usar ese numero como total
  de la ampliacion. Resultados actuales y entorno en
  [verificacion](verification.md), sin certificacion multiplataforma.
- El descubrimiento cubre ocho stacks por manifiesto; herramientas sin
  manifiesto reconocido quedan desconocidas.
- Solo `package.json` genera comandos propuestos (test/lint/check/
  typecheck/build); otros stacks se reconocen sin proponer comandos.
- `verification.commands` de la config queda vacio al inicializar: ninguna
  verificacion se da por aprobada sin decision explicita.
- Los fragmentos MCP son propuestas; no hay escritura en `.mcp.json`,
  `.codex/config.toml`, `opencode.json` ni `.devin/mcp_config.json` del
  proyecto ni registro automatico.
- No hay migracion automatica desde configuraciones del material heredado.
- `doctor` informa estado, no repara; `legacy` nunca se auto-carga.
- Un `--input` cuyo archivo no existe puede devolver `INTERNAL` para el
  error `ENOENT`. Es una limitacion de taxonomia de errores pendiente de
  seguimiento, no una autorizacion ni una excepcion de permisos.
- Hay presupuesto de operaciones registradas por sesion y comprobacion de
  politica antes de agregarlas. No contabiliza todas las llamadas nativas,
  tokens ni gasto, y no bloquea herramientas usadas fuera de TaskSystem.
- Los nombres de archivos generados por el harness usan ASCII. Las rutas
  del proyecto con Unicode se conservan y se aceptan, pero su
  compatibilidad total con todos los anfitriones no esta certificada.

## Deuda heredada conservada, no corregida en el archivo

| Hallazgo previo | Tratamiento en esta base |
| --- | --- |
| Catalogos de skills con conteos distintos (197 archivos, manifiesto 196, indice 195) | Inventario individual congelado; fuentes activas registradas en manifest.json, no en indices manuales divergentes |
| C0 documentado con 15 llamadas y codigo con 40 | Limite de sesion explicito y acotado; no equivale a contar llamadas nativas |
| Nombres `metasearchmcp_*` antiguos mezclados con `metasearch_*` | No se importan listas heredadas; MCP propio de consulta, sin mutaciones |
| Sandbox de PowerShell sin aislamiento real | No se integra ni se presenta como garantia de seguridad |
| Reglas, comandos y rutas particulares de VantaDB | Core neutral y perfiles optativos nuevos; originales bloqueados fuera del runtime |

Estos defectos siguen presentes en el archivo original preservado. No se
declara una migracion completa de sus capacidades, agentes ni skills.

## Cambios futuros previstos (fuera de esta base)

- Revision semantica, licencias y dependencias de las especialidades
  originales no incorporadas; clasificar no equivale a portarlas.
- Politicas organizativas autenticadas y perfiles de dominio auditados.
- Instalacion supervisada de hooks nativos y ejecucion autorizada de
  verificaciones.
- Migracion asistida de configuraciones previas.
- Empaquetado y licencia de redistribucion tras auditar la procedencia.
