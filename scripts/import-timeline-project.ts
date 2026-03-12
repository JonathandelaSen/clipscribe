#!/usr/bin/env node

import {
  getImportTimelineProjectHelpText,
  importTimelineProjectWorkspace,
  normalizeImportTimelineProjectOptions,
  parseImportTimelineProjectArgs,
} from "../src/lib/editor/workspace-cli";
import { promptForBundlePath, withInteractiveReadline } from "../src/lib/editor/node-interactive";

let wantsJson = false;

async function main() {
  const parsed = parseImportTimelineProjectArgs(process.argv.slice(2));
  wantsJson = parsed.json;

  if (parsed.help) {
    console.log(getImportTimelineProjectHelpText());
    return;
  }

  if (!parsed.bundlePath) {
    if (parsed.json) {
      throw new Error("--bundle is required when using --json.");
    }

    parsed.bundlePath = await withInteractiveReadline((rl) =>
      promptForBundlePath(rl, process.cwd())
    );
  }

  const options = normalizeImportTimelineProjectOptions(parsed, process.cwd());
  const result = await importTimelineProjectWorkspace(options);

  if (wantsJson) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else {
    console.log(`Imported ${result.name}`);
    console.log(`Workspace: ${result.workspacePath}`);
    console.log(`Clips: ${result.clipCount}`);
    console.log(`Assets: ${result.assetCount}`);
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
