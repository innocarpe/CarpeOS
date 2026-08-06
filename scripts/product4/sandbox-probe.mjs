#!/usr/bin/env node
/**
 * In-sandbox Product 4 control probe.
 *
 * Run only inside bubblewrap after setpriv --no-new-privs. Writes a measured
 * observation JSON (not claim-only static fields) to the output path.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSandboxProbeObservation } from "./p02-runner.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const outputPath = resolve(process.argv[2] ?? "/output/sandbox-probe.json");
    const observation = collectSandboxProbeObservation();
    writeFileSync(outputPath, `${JSON.stringify(observation)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 23;
  }
}
