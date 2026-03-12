#!/usr/bin/env node

import {
  exportTimelineProjectWorkspace,
  getExportTimelineProjectHelpText,
  normalizeExportTimelineProjectOptions,
  parseExportTimelineProjectArgs,
} from "../src/lib/editor/workspace-cli";
import { createCliProgressBar } from "../src/lib/editor/cli-progress";
import { promptForExportResolution, promptForWorkspaceProjectPath } from "../src/lib/editor/node-interactive";

let wantsJson = false;
let progressBar: ReturnType<typeof createCliProgressBar> | null = null;

async function main() {
  const parsed = parseExportTimelineProjectArgs(process.argv.slice(2));
  wantsJson = parsed.json;

  if (parsed.help) {
    console.log(getExportTimelineProjectHelpText());
    return;
  }

  if (!parsed.projectPath) {
    if (parsed.json) {
      throw new Error("--project is required when using --json.");
    }

    parsed.projectPath = await promptForWorkspaceProjectPath(process.cwd());
    if (!parsed.resolution) {
      parsed.resolution = await promptForExportResolution("1080p");
    }
  }

  const options = normalizeExportTimelineProjectOptions(parsed, process.cwd());
  progressBar = wantsJson ? null : createCliProgressBar({ label: "Export" });
  const result = await exportTimelineProjectWorkspace(options, {
    onProgress: (update) => {
      progressBar?.setPercent(update.percent, update.message);
    },
  });

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
    progressBar?.fail("Failed");
    console.error(message);
  }
  process.exitCode = 1;
});
