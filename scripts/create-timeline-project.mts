#!/usr/bin/env node
/// <reference types="node" />

import type { CreateTimelineProjectBundleOptions } from "../src/lib/editor/bundle-cli";

const bundleCliModule =
  (await import(new URL("../src/lib/editor/bundle-cli.ts", import.meta.url).href)) as typeof import("../src/lib/editor/bundle-cli");
const createBundleModule =
  (await import(new URL("../src/lib/editor/create-bundle-cli.ts", import.meta.url).href)) as typeof import("../src/lib/editor/create-bundle-cli");
const progressModule =
  (await import(new URL("../src/lib/editor/cli-progress.ts", import.meta.url).href)) as typeof import("../src/lib/editor/cli-progress");

const {
  getCreateTimelineProjectBundleHelpText,
  normalizeCreateTimelineProjectBundleCliInput,
  parseCreateTimelineProjectBundleArgs,
} = bundleCliModule;

const { createTimelineProjectBundle, promptCreateTimelineProjectBundleOptions } = createBundleModule;
const { createCliProgressBar } = progressModule;

let progressBar: ReturnType<typeof createCliProgressBar> | null = null;

async function main() {
  const parsed = parseCreateTimelineProjectBundleArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(getCreateTimelineProjectBundleHelpText());
    return;
  }

  let options: CreateTimelineProjectBundleOptions = normalizeCreateTimelineProjectBundleCliInput(parsed, process.cwd());
  if (parsed.interactive) {
    options = await promptCreateTimelineProjectBundleOptions(options, {
      parsedInput: parsed,
      mode: "full",
    });
  }

  progressBar = createCliProgressBar({ label: "Bundle" });
  const result = await createTimelineProjectBundle(options, {
    onProgress: (update) => {
      progressBar?.setPercent(update.percent, update.message);
    },
  });

  console.log(`Created ${result.bundlePath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Clips: ${result.clipCount}`);
  console.log(`Audio track: ${result.hasAudio ? "yes" : "no"}`);
}

main().catch((error) => {
  progressBar?.fail("Failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
