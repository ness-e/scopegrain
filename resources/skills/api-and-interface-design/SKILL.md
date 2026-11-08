---
name: api-and-interface-design
description: Use when establishing a public interface or module boundary before implementation
---
# Interface Contract

Inspect existing consumers, naming and error conventions.
Define inputs, outputs, validation, authority and failure behavior.
Prefer additive changes; identify compatibility and migration obligations.
Keep implementation details out of observable contracts unless deliberate.
Specify exact boundary cases and examples before delegating implementation.
Do not invent an API, version or dependency from memory.
