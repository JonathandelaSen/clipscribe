#!/usr/bin/env node

import {
  createAndExportTimelineProject,
  getCreateAndExportTimelineProjectHelpText,
  parseCreateAndExportTimelineProjectArgs,
  prepareCreateAndExportTimelineProjectOptions,
} from "../src/lib/editor/create-and-export-cli";
import { createCliProgressBar } from "../src/lib/editor/cli-progress";

let wantsJson = false;
let progressBar: ReturnType<typeof createCliProgressBar> | null = null;

async function main() {
  const parsed = parseCreateAndExportTimelineProjectArgs(process.argv.slice(2));
  wantsJson = parsed.json;

  if (parsed.help) {
    console.log(getCreateAndExportTimelineProjectHelpText());
    return;
  }

  const options = await prepareCreateAndExportTimelineProjectOptions(parsed, process.cwd());
  progressBar = wantsJson ? null : createCliProgressBar({ label: "Create+Export" });

  const result = await createAndExportTimelineProject(options, {
    onProgress: (update) => {
      progressBar?.setPercent(update.percent, update.message);
    },
  });

  if (wantsJson) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (result.dryRun) {
    console.log(`Planned export for ${result.bundlePath}`);
  } else {
    console.log(`Exported ${result.outputPath}`);
  }
  console.log(`Bundle: ${result.bundlePath}`);
  console.log(`Workspace: ${result.workspacePath}`);
  console.log(`Resolution: ${result.resolution}`);
  console.log(`Clips: ${result.clipCount}`);
  console.log(`Assets: ${result.assetCount}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (wantsJson) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    progressBar?.fail("Failed");
    console.error(message);
  }
  process.exitCode = 1;
});
