---
name: deprecation-and-migration
description: Use when replacing behavior, configuration or stored data while preserving a recoverable upgrade path
---
# Controlled Migration

Inventory consumers, stored versions and actual behavior before changing them.
Define source/target contracts, compatibility period and recovery boundary.
Distinguish discovery, dry-run, approval and mutation.
Test old, new, partial and interrupted states in owned fixtures.
Never delete old data or rewrite user configuration without specific approval.
Document breaking cases and unresolved external consumers explicitly.
