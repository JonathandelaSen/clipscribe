#!/usr/bin/env node

import {
  exportTimelineProjectWorkspace,
  getExportTimelineProjectHelpText,
  normalizeExportTimelineProjectOptions,
  parseExportTimelineProjectArgs,
} from "../src/lib/editor/workspace-cli";

let wantsJson = false;

async function main() {
  const parsed = parseExportTimelineProjectArgs(process.argv.slice(2));
  wantsJson = parsed.json;

  if (parsed.help) {
    console.log(getExportTimelineProjectHelpText());
    return;
  }

  const options = normalizeExportTimelineProjectOptions(parsed, process.cwd());
  const result = await exportTimelineProjectWorkspace(options);

  if (wantsJson) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else if (result.dryRun) {
    console.log(`Planned export for ${result.workspacePath}`);
    console.log(`Output: ${result.outputPath}`);
    console.log(`Resolution: ${result.resolution}`);
  } else {
    console.log(`Exported ${result.outputPath}`);
    console.log(`Resolution: ${result.resolution}`);
    console.log(`Size: ${result.sizeBytes} bytes`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
});
