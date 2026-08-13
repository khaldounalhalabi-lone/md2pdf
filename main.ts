#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys
/**
 * CLI entry point. Kept at the repository root so a raw URL to this file works
 * as an install target:
 *
 *   deno install -grfA --name md2pdf https://raw.githubusercontent.com/…/main.ts
 *
 * The implementation lives in ./src; import ./mod.ts to use it as a library.
 */
import { runCli } from "./src/cli.ts";

if (import.meta.main) {
  await runCli();
}
