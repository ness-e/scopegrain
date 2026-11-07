#!/usr/bin/env node
// Entry point: delegates to src/cli.mjs so tests can call run() in-process.
import { run, defaultIO } from '../src/cli.mjs';

process.exitCode = await run(process.argv.slice(2), defaultIO());
