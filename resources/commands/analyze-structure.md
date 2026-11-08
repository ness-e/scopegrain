---
name: analyze-structure
description: Analyze structural impact with available graph and source evidence.
---
# Analyze Structure

Define the question and inspect actual graph-tool availability and index
scope/freshness. Use a graph only when its coverage is relevant and known.
Otherwise search sources and callers; explain the different limitations.

Trace entrypoints, public interfaces, dependencies, ownership, cycles,
generated code and dynamic registrations. Distinguish semantic risk from
style preferences. A missing static caller is not proof of dead code.

Return evidence-backed impact, uncertain edges and proposed checks.
Do not invent graph symbols, index statistics or tools.
This is analysis only: no reindexing, installation, deletion or refactoring
without separately applicable permission.
