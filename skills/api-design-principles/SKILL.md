---
name: api-design-principles
description: Use to review an HTTP or GraphQL API for consistency, authority boundaries and evolution
---
# API Review

Read the actual routes or schema and consumers. Check identity,
authorization, input validation, error semantics and compatibility.
For collections define pagination and resource limits where relevant.
For partial updates distinguish omission, null and explicit removal.
Test success and failure examples against implementation.
Do not impose REST conventions on an unrelated protocol.
