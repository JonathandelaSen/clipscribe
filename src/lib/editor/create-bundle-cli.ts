import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildEditorProjectBundleFromCliOptions,
  normalizeCliPathInput,
  type CreateTimelineProjectBundleAudioInput,
  type CreateTimelineProjectBundleOptions,
  type CreateTimelineProjectBundleVideoInput,
  type ParsedCreateTimelineProjectBundleCliInput,
} from "./bundle-cli";
import type { EditorAspectRatio } from "./types";

import {
  promptConfirmValue as defaultPromptConfirmValue,
  promptNumberValue as defaultPromptNumberValue,
  promptSelectValue as defaultPromptSelectValue,
  promptTextValue as defaultPromptTextValue,
} from "./node-interactive";

type CreateWizardMode = "full" | "missing-only";

interface PromptTextInput {
  message: string;
  initial?: string;
  validate?: (value: string) => true | string;
}

interface PromptConfirmInput {
  message: string;
  initial: boolean;
}

interface PromptNumberInput {
  message: string;
  initial: number;
  min?: number;
  max?: number;
  integer?: boolean;
}

interface SelectChoice<T> {
  title: string;
  value: T;
  description?: string;
}

interface PromptSelectInput<T> {
  message: string;
  choices: Array<SelectChoice<T>>;
  initial?: T;
}

export interface CreateTimelineProjectBundlePromptApi {
  promptTextValue: (input: PromptTextInput) => Promise<string>;
  promptConfirmValue: (input: PromptConfirmInput) => Promise<boolean>;
  promptNumberValue: (input: PromptNumberInput) => Promise<number>;
  promptSelectValue: <T>(input: PromptSelectInput<T>) => Promise<T>;
}

export interface CreateTimelineProjectBundleWizardInput {
  parsedInput?: ParsedCreateTimelineProjectBundleCliInput;
  includeOutputDirectoryPrompt?: boolean;
  mode?: CreateWizardMode;
  promptApi?: CreateTimelineProjectBundlePromptApi;
}

export interface CreateTimelineProjectBundleProgressUpdate {
  stage: "prepare" | "copy" | "write" | "done";
  message: string;
  percent: number;
}

export interface CreateTimelineProjectBundleDependencies {
  now?: () => number;
  onProgress?: (update: CreateTimelineProjectBundleProgressUpdate) => void;
}

export interface CreatedTimelineProjectBundleResult {
  command: "create:timeline-project";
  bundlePath: string;
  manifestPath: string;
  clipCount: number;
  hasAudio: boolean;
}

const DEFAULT_PROMPT_API: CreateTimelineProjectBundlePromptApi = {
  promptTextValue: defaultPromptTextValue,
  promptConfirmValue: defaultPromptConfirmValue,
  promptNumberValue: defaultPromptNumberValue,
  promptSelectValue: defaultPromptSelectValue,
};

function emitProgress(
  callback: CreateTimelineProjectBundleDependencies["onProgress"] | undefined,
  update: CreateTimelineProjectBundleProgressUpdate
) {
  callback?.({
    ...update,
    percent: Math.round(Math.min(100, Math.max(0, update.percent))),
  });
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

async function askAspectRatio(
  promptApi: CreateTimelineProjectBundlePromptApi,
  fallback: EditorAspectRatio
): Promise<EditorAspectRatio> {
  return promptApi.promptSelectValue({
    message: "Aspect ratio",
    choices: [
      { title: "16:9", value: "16:9", description: "Landscape wide" },
      { title: "9:16", value: "9:16", description: "Vertical shorts" },
      { title: "1:1", value: "1:1", description: "Square feed" },
      { title: "4:5", value: "4:5", description: "Portrait feed" },
    ],
    initial: fallback,
  });
}

async function askNonNegativeNumber(
  promptApi: CreateTimelineProjectBundlePromptApi,
  prompt: string,
  fallback: number
): Promise<number> {
  return promptApi.promptNumberValue({
    message: prompt,
    initial: fallback,
    min: 0,
  });
}

async function askVolume(
  promptApi: CreateTimelineProjectBundlePromptApi,
  prompt: string,
  fallback: number
): Promise<number> {
  return promptApi.promptNumberValue({
    message: prompt,
    initial: fallback,
    min: 0,
    max: 1,
  });
}

async function askOptionalTrimEnd(
  promptApi: CreateTimelineProjectBundlePromptApi,
  prompt: string,
  startSeconds: number,
  fallback: number | null
): Promise<number | null> {
  const fallbackText = fallback == null ? "full" : String(fallback);
  const answer = await promptApi.promptTextValue({
    message: `${prompt} (use "full" for the full source)`,
    initial: fallbackText,
    validate: (value) => {
      const normalized = value.trim().toLowerCase();
      if (!normalized || ["full", "source", "none"].includes(normalized)) {
        return true;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= startSeconds) {
        return "Enter a number greater than the trim start, or use full.";
      }
      return true;
    },
  });

  const normalized = answer.trim().toLowerCase();
  if (!normalized || ["full", "source", "none"].includes(normalized)) {
    return null;
  }
  return Number(answer);
}

async function promptVideoClips(
  promptApi: CreateTimelineProjectBundlePromptApi,
  baseVideoClips: CreateTimelineProjectBundleVideoInput[]
): Promise<CreateTimelineProjectBundleVideoInput[]> {
  const clips = [...baseVideoClips];

  if (clips.length === 0) {
    console.log("Add one or more video files. Leave the path blank after the last clip.");
  } else {
    console.log(`Starting with ${clips.length} video clip${clips.length === 1 ? "" : "s"} from the command line.`);
  }

  while (
    clips.length === 0 ||
    (await promptApi.promptConfirmValue({
      message: "Add another video clip?",
      initial: clips.length === 0,
    }))
  ) {
    const pathValue = await promptApi.promptTextValue({
      message: `Video clip ${clips.length + 1} path`,
      validate: (value) => {
        if (value.trim() || clips.length > 0) return true;
        return "At least one video clip is required.";
      },
    });
    if (!pathValue.trim()) {
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
    const label = await promptApi.promptTextValue({
      message: "Label",
      initial: clip.label,
      validate: (value) => (value.trim() ? true : "Label is required."),
    });
    const trimStartSeconds = await askNonNegativeNumber(promptApi, "Trim start seconds", clip.trimStartSeconds);
    const trimEndSeconds = await askOptionalTrimEnd(promptApi, "Trim end seconds", trimStartSeconds, clip.trimEndSeconds);
    const reverse = await promptApi.promptConfirmValue({
      message: "Reverse this clip?",
      initial: clip.reverse,
    });
    const volume = await askVolume(promptApi, "Clip volume", clip.volume);
    const muted = await promptApi.promptConfirmValue({
      message: "Mute clip audio?",
      initial: clip.muted,
    });

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
  promptApi: CreateTimelineProjectBundlePromptApi,
  baseAudioItem: CreateTimelineProjectBundleAudioInput | undefined
): Promise<CreateTimelineProjectBundleAudioInput | undefined> {
  const pathValue = await promptApi.promptTextValue({
    message: "Optional audio file path (leave blank to skip)",
    initial: baseAudioItem?.sourcePath ?? "",
  });
  if (!pathValue.trim()) return undefined;
  const normalizedSourcePath = normalizeCliPathInput(pathValue, "Audio file path");

  const trimStartSeconds = await askNonNegativeNumber(
    promptApi,
    "Audio trim start seconds",
    baseAudioItem?.trimStartSeconds ?? 0
  );
  const trimEndSeconds = await askOptionalTrimEnd(
    promptApi,
    "Audio trim end seconds",
    trimStartSeconds,
    baseAudioItem?.trimEndSeconds ?? null
  );
  const startOffsetSeconds = await askNonNegativeNumber(
    promptApi,
    "Audio start offset seconds",
    baseAudioItem?.startOffsetSeconds ?? 0
  );
  const volume = await askVolume(promptApi, "Audio volume", baseAudioItem?.volume ?? 1);
  const muted = await promptApi.promptConfirmValue({
    message: "Mute the audio track?",
    initial: baseAudioItem?.muted ?? false,
  });

  return {
    sourcePath: normalizedSourcePath,
    trimStartSeconds,
    trimEndSeconds,
    startOffsetSeconds,
    volume,
    muted,
  };
}

async function promptOutputDirectory(
  promptApi: CreateTimelineProjectBundlePromptApi,
  currentValue: string
): Promise<string> {
  return normalizeCliPathInput(
    await promptApi.promptTextValue({
      message: "Output directory",
      initial: currentValue,
      validate: (value) => (value.trim() ? true : "Output directory is required."),
    }),
    "Output directory"
  );
}

export async function promptCreateTimelineProjectBundleOptions(
  baseOptions: CreateTimelineProjectBundleOptions,
  input: CreateTimelineProjectBundleWizardInput = {}
): Promise<CreateTimelineProjectBundleOptions> {
  const promptApi = input.promptApi ?? DEFAULT_PROMPT_API;
  const parsedInput = input.parsedInput;
  const mode = input.mode ?? "full";
  const includeOutputDirectoryPrompt = input.includeOutputDirectoryPrompt ?? true;

  if (mode === "missing-only") {
    const needsVideoPrompt = !parsedInput || parsedInput.videoPaths.length === 0;
    const needsAudioPrompt = !parsedInput || parsedInput.audioPath == null;
    const needsNamePrompt = !parsedInput || parsedInput.name == null;
    const needsAspectPrompt = !parsedInput || parsedInput.aspectRatio == null;
    const needsOutputPrompt = includeOutputDirectoryPrompt && (!parsedInput || parsedInput.outputDirectory == null);

    return {
      ...baseOptions,
      interactive: true,
      name: needsNamePrompt
        ? await promptApi.promptTextValue({
            message: "Project name",
            initial: baseOptions.name,
            validate: (value) => (value.trim() ? true : "Project name is required."),
          })
        : baseOptions.name,
      aspectRatio: needsAspectPrompt ? await askAspectRatio(promptApi, baseOptions.aspectRatio) : baseOptions.aspectRatio,
      outputDirectory: needsOutputPrompt
        ? await promptOutputDirectory(promptApi, baseOptions.outputDirectory)
        : baseOptions.outputDirectory,
      videoClips: needsVideoPrompt ? await promptVideoClips(promptApi, []) : baseOptions.videoClips,
      audioItem: needsAudioPrompt ? await promptAudioItem(promptApi, undefined) : baseOptions.audioItem,
    };
  }

  const name = await promptApi.promptTextValue({
    message: "Project name",
    initial: baseOptions.name,
    validate: (value) => (value.trim() ? true : "Project name is required."),
  });
  const aspectRatio = await askAspectRatio(promptApi, baseOptions.aspectRatio);
  const videoClips = await promptVideoClips(promptApi, baseOptions.videoClips);
  const audioItem = await promptAudioItem(promptApi, baseOptions.audioItem);
  const outputDirectory = includeOutputDirectoryPrompt
    ? await promptOutputDirectory(promptApi, baseOptions.outputDirectory)
    : baseOptions.outputDirectory;

  return {
    ...baseOptions,
    interactive: true,
    name,
    aspectRatio,
    outputDirectory,
    videoClips,
    audioItem,
  };
}

export async function createTimelineProjectBundle(
  options: CreateTimelineProjectBundleOptions,
  dependencies: CreateTimelineProjectBundleDependencies = {}
): Promise<CreatedTimelineProjectBundleResult> {
  const builtBundle = buildEditorProjectBundleFromCliOptions(options, dependencies.now?.() ?? Date.now());
  const outputDirectory = path.resolve(options.outputDirectory);
  const bundlePath = path.join(outputDirectory, builtBundle.bundleDirectoryName);
  const totalSteps = builtBundle.copyPlan.length * 2 + 2;
  let completedSteps = 0;

  const setStep = (message: string, stage: CreateTimelineProjectBundleProgressUpdate["stage"], nextSteps = completedSteps) => {
    emitProgress(dependencies.onProgress, {
      stage,
      message,
      percent: totalSteps <= 0 ? 100 : (nextSteps / totalSteps) * 100,
    });
  };

  setStep("Checking source files", "prepare", 0);
  await mkdir(outputDirectory, { recursive: true });
  await ensureDirectoryDoesNotExist(bundlePath);

  for (const entry of builtBundle.copyPlan) {
    await assertReadableFile(path.resolve(entry.sourcePath));
    completedSteps += 1;
    setStep(`Checked ${path.basename(entry.sourcePath)}`, "prepare");
  }

  await mkdir(bundlePath, { recursive: true });
  await mkdir(path.join(bundlePath, "media"), { recursive: true });
  completedSteps += 1;
  setStep("Prepared bundle directory", "prepare");

  for (const entry of builtBundle.copyPlan) {
    const sourcePath = path.resolve(entry.sourcePath);
    const destinationPath = path.join(bundlePath, entry.bundlePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    completedSteps += 1;
    setStep(`Copied ${path.basename(entry.bundlePath)}`, "copy");
  }

  const manifestPath = path.join(bundlePath, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(builtBundle.manifest, null, 2)}\n`, "utf8");
  completedSteps += 1;
  setStep("Wrote manifest", "write");
  emitProgress(dependencies.onProgress, {
    stage: "done",
    message: "Bundle ready",
    percent: 100,
  });

  return {
    command: "create:timeline-project",
    bundlePath,
    manifestPath,
    clipCount: builtBundle.manifest.videoClips.length,
    hasAudio: Boolean(builtBundle.manifest.audioItem),
  };
}
