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

- **No se migro:** ningun prompt, agente, comando, skill ni configuracion
  del material heredado pasa al circuito activo por sustitucion. Solo tres
  skills portables nuevas (`templates/skills/*`) y las plantillas de
  `templates/` rigen el comportamiento.
- **Nucleo nuevo:** CLI, descubrimiento, config, bootstrap, adaptadores,
  tareas, doctor y MCP son implementaciones nuevas contra el contrato de
  `docs/implementation.md`; no son una traduccion del codigo anterior.
- **Dependencias:** solo `@modelcontextprotocol/sdk` y `zod` declaradas,
  para el servidor MCP opcional. El CLI no las usa.

## Limitaciones conocidas

- El nucleo supera las 73 pruebas locales en Windows/Node 26.8.1;
  no equivale a certificar todas las plataformas ni anfitriones. Ver
  [verificacion](verification.md).
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
- No hay presupuestos de acciones ni contabilidad de llamadas nativas;
  `checkAction` solo informa la politica sobre el estado almacenado.
- Los nombres de archivos generados por el harness usan ASCII. Las rutas
  del proyecto con Unicode se conservan y se aceptan, pero su
  compatibilidad total con todos los anfitriones no esta certificada.

## Deuda heredada conservada, no corregida en el archivo

| Hallazgo previo | Tratamiento en esta base |
| --- | --- |
| Catalogos de skills con conteos distintos (197 archivos, manifiesto 196, indice 195) | No se publica ese catalogo como activo; las tres skills nuevas tienen fuentes explicitas |
| C0 documentado con 15 llamadas y codigo con 40 | No se reutiliza ese presupuesto; no hay contabilidad de llamadas nativas en esta version |
| Nombres `metasearchmcp_*` antiguos mezclados con `metasearch_*` | No se cargan listas de herramientas heredadas; solo cinco herramientas MCP propias de consulta |
| Sandbox de PowerShell sin aislamiento real | No se integra ni se presenta como garantia de seguridad |
| Reglas, comandos y rutas particulares de VantaDB | Se conservan localmente para migracion selectiva posterior, fuera del runtime |

Estos defectos siguen presentes en el archivo original preservado. No se
declara una migracion completa de sus capacidades, agentes ni skills.

## Cambios futuros previstos (fuera de esta base)

- Politicas organizativas componibles y perfiles de dominio auditados.
- Instalacion supervisada de hooks nativos y ejecucion autorizada de
  verificaciones.
- Migracion asistida de configuraciones previas.
- Empaquetado y licencia de redistribucion tras auditar la procedencia.
