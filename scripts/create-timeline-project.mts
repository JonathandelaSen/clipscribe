#!/usr/bin/env node
/// <reference types="node" />

import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

import type { CreateTimelineProjectBundleAudioInput, CreateTimelineProjectBundleOptions, CreateTimelineProjectBundleVideoInput } from "../src/lib/editor/bundle-cli";
import type { EditorAspectRatio } from "../src/lib/editor/types";

const bundleCliModule = await import(new URL("../src/lib/editor/bundle-cli.ts", import.meta.url).href) as typeof import("../src/lib/editor/bundle-cli");

const {
  buildEditorProjectBundleFromCliOptions,
  getCreateTimelineProjectBundleHelpText,
  normalizeCliPathInput,
  normalizeCreateTimelineProjectBundleCliInput,
  parseCreateTimelineProjectBundleArgs,
} = bundleCliModule;

async function askQuestion(rl: ReturnType<typeof createInterface>, prompt: string, fallback?: string): Promise<string> {
  const suffix = fallback == null || fallback === "" ? "" : ` [${fallback}]`;
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || fallback || "";
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  fallback: boolean
): Promise<boolean> {
  const fallbackText = fallback ? "Y/n" : "y/N";
  while (true) {
    const answer = (await rl.question(`${prompt} [${fallbackText}]: `)).trim().toLowerCase();
    if (!answer) return fallback;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.log("Please answer y or n.");
  }
}

async function askSelect<T extends string>(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  options: Array<{ label: string; value: T; description?: string }>,
  fallback: T
): Promise<T> {
  const fallbackIndex = Math.max(0, options.findIndex((option) => option.value === fallback));
  if (!input.isTTY || !output.isTTY) {
    console.log(prompt);
    options.forEach((option, index) => {
      const description = option.description ? ` - ${option.description}` : "";
      console.log(`  ${index + 1}. ${option.label}${description}`);
    });
    while (true) {
      const answer = await askQuestion(rl, "Choose option number", String(fallbackIndex + 1));
      const parsed = Number(answer);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= options.length) {
        return options[parsed - 1].value;
      }
      console.log(`Choose a number between 1 and ${options.length}.`);
    }
  }

  return new Promise<T>((resolve, reject) => {
    let selectedIndex = fallbackIndex;
    let renderedLineCount = 0;
    const ttyInput = input as typeof input & { isRaw?: boolean; setRawMode?: (value: boolean) => void };
    const previousRawMode = Boolean(ttyInput.isRaw);

    const render = () => {
      const lines = [
        prompt,
        ...options.map((option, index) => {
          const pointer = index === selectedIndex ? ">" : " ";
          const description = option.description ? ` ${option.description}` : "";
          return `${pointer} ${option.label}${description}`;
        }),
        "  Use arrow keys and Enter.",
      ];

      if (renderedLineCount > 0) {
        output.write(`\x1b[${renderedLineCount}A`);
        output.write("\x1b[J");
      }

      output.write(`${lines.join("\n")}\n`);
      renderedLineCount = lines.length;
    };

    const finish = (nextValue: T) => {
      input.off("keypress", onKeypress);
      if (ttyInput.setRawMode) {
        ttyInput.setRawMode(previousRawMode);
      }
      if (renderedLineCount > 0) {
        output.write(`\x1b[${renderedLineCount}A`);
        output.write("\x1b[J");
      }
      const selectedOption = options.find((option) => option.value === nextValue);
      output.write(`${prompt}: ${selectedOption?.label ?? String(nextValue)}\n`);
      resolve(nextValue);
    };

    const cancel = () => {
      input.off("keypress", onKeypress);
      if (ttyInput.setRawMode) {
        ttyInput.setRawMode(previousRawMode);
      }
      if (renderedLineCount > 0) {
        output.write(`\x1b[${renderedLineCount}A`);
        output.write("\x1b[J");
      }
      reject(new Error("Canceled by user."));
    };

    const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cancel();
        return;
      }
      if (key.name === "up" || key.name === "k") {
        selectedIndex = selectedIndex === 0 ? options.length - 1 : selectedIndex - 1;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        selectedIndex = selectedIndex === options.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(options[selectedIndex].value);
      }
    };

    emitKeypressEvents(input);
    if (ttyInput.setRawMode) {
      ttyInput.setRawMode(true);
    }
    input.on("keypress", onKeypress);
    input.resume();
    render();
  });
}

async function askAspectRatio(
  rl: ReturnType<typeof createInterface>,
  fallback: EditorAspectRatio
): Promise<EditorAspectRatio> {
  return askSelect(
    rl,
    "Aspect ratio",
    [
      { label: "16:9", value: "16:9", description: "Landscape wide" },
      { label: "9:16", value: "9:16", description: "Vertical shorts" },
      { label: "1:1", value: "1:1", description: "Square feed" },
      { label: "4:5", value: "4:5", description: "Portrait feed" },
    ],
    fallback
  );
}

async function askNonNegativeNumber(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  fallback: number
): Promise<number> {
  while (true) {
    const answer = await askQuestion(rl, prompt, String(fallback));
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    console.log("Enter a number that is 0 or greater.");
  }
}

async function askVolume(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  fallback: number
): Promise<number> {
  while (true) {
    const answer = await askQuestion(rl, prompt, String(fallback));
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
    console.log("Enter a volume between 0 and 1.");
  }
}

async function askOptionalTrimEnd(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  startSeconds: number,
  fallback: number | null
): Promise<number | null> {
  while (true) {
    const fallbackText = fallback == null ? "full source" : String(fallback);
    const answer = (await rl.question(`${prompt} [${fallbackText}]: `)).trim();
    if (!answer) return fallback;
    if (["full", "source", "none"].includes(answer.toLowerCase())) {
      return null;
    }

    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed > startSeconds) {
      return parsed;
    }
    console.log("Enter a number greater than the trim start, or leave blank for the full source.");
  }
}

async function promptVideoClips(
  rl: ReturnType<typeof createInterface>,
  baseVideoClips: CreateTimelineProjectBundleVideoInput[]
): Promise<CreateTimelineProjectBundleVideoInput[]> {
  const clips = [...baseVideoClips];

  if (clips.length === 0) {
    console.log("Add one or more video files. Leave the path blank after the last clip.");
  } else {
    console.log(`Starting with ${clips.length} video clip${clips.length === 1 ? "" : "s"} from the command line.`);
  }

  while (clips.length === 0 || await askYesNo(rl, "Add another video clip?", clips.length === 0)) {
    const pathValue = await askQuestion(rl, `Video clip ${clips.length + 1} path`);
    if (!pathValue) {
      if (clips.length === 0) {
        console.log("At least one video clip is required.");
        continue;
      }
      break;
    }

    const normalizedSourcePath = normalizeCliPathInput(pathValue, `Video clip ${clips.length + 1} path`);
    clips.push({
      sourcePath: normalizedSourcePath,
      label: path.basename(normalizedSourcePath).replace(/\.[^/.]+$/, "") || `Clip ${clips.length + 1}`,
      trimStartSeconds: 0,
      trimEndSeconds: null,
      reverse: false,
      volume: 1,
      muted: false,
    });
  }

  const configured: CreateTimelineProjectBundleVideoInput[] = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    console.log(`\nClip ${index + 1}: ${clip.sourcePath}`);
    const label = await askQuestion(rl, "Label", clip.label);
    const trimStartSeconds = await askNonNegativeNumber(rl, "Trim start seconds", clip.trimStartSeconds);
    const trimEndSeconds = await askOptionalTrimEnd(rl, "Trim end seconds", trimStartSeconds, clip.trimEndSeconds);
    const reverse = await askYesNo(rl, "Reverse this clip?", clip.reverse);
    const volume = await askVolume(rl, "Clip volume", clip.volume);
    const muted = await askYesNo(rl, "Mute clip audio?", clip.muted);

    configured.push({
      ...clip,
      label,
      trimStartSeconds,
      trimEndSeconds,
      reverse,
      volume,
      muted,
    });
  }

  return configured;
}

async function promptAudioItem(
  rl: ReturnType<typeof createInterface>,
  baseAudioItem: CreateTimelineProjectBundleAudioInput | undefined
): Promise<CreateTimelineProjectBundleAudioInput | undefined> {
  const defaultPath = baseAudioItem?.sourcePath ?? "";
  const pathValue = await askQuestion(rl, "\nOptional audio file path (leave blank to skip)", defaultPath);
  if (!pathValue) return undefined;
  const normalizedSourcePath = normalizeCliPathInput(pathValue, "Audio file path");

  const trimStartSeconds = await askNonNegativeNumber(rl, "Audio trim start seconds", baseAudioItem?.trimStartSeconds ?? 0);
  const trimEndSeconds = await askOptionalTrimEnd(rl, "Audio trim end seconds", trimStartSeconds, baseAudioItem?.trimEndSeconds ?? null);
  const startOffsetSeconds = await askNonNegativeNumber(rl, "Audio start offset seconds", baseAudioItem?.startOffsetSeconds ?? 0);
  const volume = await askVolume(rl, "Audio volume", baseAudioItem?.volume ?? 1);
  const muted = await askYesNo(rl, "Mute the audio track?", baseAudioItem?.muted ?? false);

  return {
    sourcePath: normalizedSourcePath,
    trimStartSeconds,
    trimEndSeconds,
    startOffsetSeconds,
    volume,
    muted,
  };
}

async function runInteractiveWizard(
  baseOptions: CreateTimelineProjectBundleOptions
): Promise<CreateTimelineProjectBundleOptions> {
  const rl = createInterface({ input, output });

  try {
    const name = await askQuestion(rl, "Project name", baseOptions.name);
    const aspectRatio = await askAspectRatio(rl, baseOptions.aspectRatio);
    const videoClips = await promptVideoClips(rl, baseOptions.videoClips);
    const audioItem = await promptAudioItem(rl, baseOptions.audioItem);
    const outputDirectory = normalizeCliPathInput(
      await askQuestion(rl, "\nOutput directory", baseOptions.outputDirectory),
      "Output directory"
    );

    return {
      ...baseOptions,
      interactive: true,
      name,
      aspectRatio,
      outputDirectory,
      videoClips,
      audioItem,
    };
  } finally {
    rl.close();
  }
}

async function assertReadableFile(filePath: string) {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    throw new Error(`Source file is not readable: ${filePath}`);
  }
}

async function ensureDirectoryDoesNotExist(directoryPath: string) {
  try {
    await access(directoryPath, fsConstants.F_OK);
    throw new Error(`Bundle output already exists: ${directoryPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.startsWith("Bundle output already exists")) {
      return;
    }
    throw error;
  }
}

async function writeBundle(options: CreateTimelineProjectBundleOptions) {
  const builtBundle = buildEditorProjectBundleFromCliOptions(options);
  const outputDirectory = path.resolve(options.outputDirectory);
  const bundleDirectoryPath = path.join(outputDirectory, builtBundle.bundleDirectoryName);

  await mkdir(outputDirectory, { recursive: true });
  await ensureDirectoryDoesNotExist(bundleDirectoryPath);

  for (const entry of builtBundle.copyPlan) {
    await assertReadableFile(path.resolve(entry.sourcePath));
  }

  await mkdir(bundleDirectoryPath, { recursive: true });
  await mkdir(path.join(bundleDirectoryPath, "media"), { recursive: true });

  for (const entry of builtBundle.copyPlan) {
    const sourcePath = path.resolve(entry.sourcePath);
    const destinationPath = path.join(bundleDirectoryPath, entry.bundlePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  const manifestPath = path.join(bundleDirectoryPath, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(builtBundle.manifest, null, 2)}\n`, "utf8");

  console.log(`Created ${bundleDirectoryPath}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Clips: ${builtBundle.manifest.videoClips.length}`);
  console.log(`Audio track: ${builtBundle.manifest.audioItem ? "yes" : "no"}`);
}

try {
  const parsed = parseCreateTimelineProjectBundleArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(getCreateTimelineProjectBundleHelpText());
    process.exit(0);
  }

  let options = normalizeCreateTimelineProjectBundleCliInput(parsed, process.cwd());
  if (parsed.interactive) {
    options = await runInteractiveWizard(options);
  }

  await writeBundle(options);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
