import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildEditorProjectBundleFromCliOptions,
  normalizeCliPathInput,
  type CreateTimelineProjectBundleAudioInput,
  type CreateTimelineProjectBundleOptions,
  type CreateTimelineProjectBundleVideoInput,
  type ParsedCreateTimelineProjectBundleCliInput,
} from "./bundle-cli";
import type { EditorProjectBundleResolvedMedia } from "./bundle";
import { probeMediaFileWithFfprobe } from "./node-media";
import type { EditorAspectRatio } from "./types";

import {
  promptConfirmValue as defaultPromptConfirmValue,
  promptForMediaFilePath as defaultPromptForMediaFilePath,
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

interface PromptMediaPathInput {
  startDirectory: string;
  kind: "video" | "audio";
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
  promptForMediaPath?: (input: PromptMediaPathInput) => Promise<string>;
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
  probeMedia?: (filePath: string) => Promise<EditorProjectBundleResolvedMedia>;
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
  promptForMediaPath: ({ startDirectory, kind }) => defaultPromptForMediaFilePath(startDirectory, kind),
};
const MIN_TIMELINE_MEDIA_DURATION_SECONDS = 0.5;
const TIMELINE_DURATION_EPSILON = 0.000_001;

interface ResolvedMediaTrimWindow {
  trimStartSeconds: number;
  trimEndSeconds: number;
  durationSeconds: number;
}

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

async function isDirectoryPath(filePath: string): Promise<boolean> {
  try {
    return (await stat(path.resolve(filePath))).isDirectory();
  } catch {
    return false;
  }
}

async function promptMediaSourcePath(
  promptApi: CreateTimelineProjectBundlePromptApi,
  input: {
    message: string;
    label: string;
    kind: "video" | "audio";
    initial?: string;
    allowBlank?: boolean;
    blankValidationMessage?: string;
  }
): Promise<string> {
  const pathValue = await promptApi.promptTextValue({
    message: input.message,
    initial: input.initial,
    validate: (value) => {
      if (value.trim() || input.allowBlank) {
        return true;
      }
      return input.blankValidationMessage ?? `${input.label} is required.`;
    },
  });

  if (!pathValue.trim()) {
    return "";
  }

  const normalizedSourcePath = normalizeCliPathInput(pathValue, input.label);
  if (!(await isDirectoryPath(normalizedSourcePath))) {
    return normalizedSourcePath;
  }

  const promptForMediaPath = promptApi.promptForMediaPath ?? DEFAULT_PROMPT_API.promptForMediaPath;
  if (!promptForMediaPath) {
    return normalizedSourcePath;
  }
  return promptForMediaPath({
    startDirectory: normalizedSourcePath,
    kind: input.kind,
  });
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTimelineSeconds(value: number) {
  return Number(value.toFixed(3));
}

function resolveConfiguredTrimWindow(
  trimStartSeconds: number,
  trimEndSeconds: number
): ResolvedMediaTrimWindow {
  const startSeconds = Math.max(0, trimStartSeconds);
  const endSeconds = roundTimelineSeconds(
    Math.max(startSeconds + MIN_TIMELINE_MEDIA_DURATION_SECONDS, trimEndSeconds)
  );
  return {
    trimStartSeconds: startSeconds,
    trimEndSeconds: endSeconds,
    durationSeconds: roundTimelineSeconds(endSeconds - startSeconds),
  };
}

function resolveAssetBackedTrimWindow(
  trimStartSeconds: number,
  trimEndSeconds: number | null,
  assetDurationSeconds: number
): ResolvedMediaTrimWindow {
  const safeAssetDuration = Math.max(
    MIN_TIMELINE_MEDIA_DURATION_SECONDS,
    Number.isFinite(assetDurationSeconds) ? assetDurationSeconds : 0
  );
  const startSeconds = clampNumber(
    trimStartSeconds,
    0,
    Math.max(0, safeAssetDuration - MIN_TIMELINE_MEDIA_DURATION_SECONDS)
  );
  const endSeconds = clampNumber(
    trimEndSeconds ?? safeAssetDuration,
    startSeconds + MIN_TIMELINE_MEDIA_DURATION_SECONDS,
    safeAssetDuration
  );
  return {
    trimStartSeconds: roundTimelineSeconds(startSeconds),
    trimEndSeconds: roundTimelineSeconds(endSeconds),
    durationSeconds: roundTimelineSeconds(endSeconds - startSeconds),
  };
}

function hasTrackAdjustmentOptions(options: CreateTimelineProjectBundleOptions): boolean {
  return Boolean(
    options.videoCloneToFillIndex != null ||
      options.videoTrimFinalToAudio ||
      options.audioTrimFinalToVideo
  );
}

function getVideoChoiceTitle(index: number, clip: CreateTimelineProjectBundleVideoInput): string {
  return `Clip ${index + 1}: ${clip.label}`;
}

async function promptTrackAdjustmentOptions(
  promptApi: CreateTimelineProjectBundlePromptApi,
  input: {
    videoClips: CreateTimelineProjectBundleVideoInput[];
    audioItem?: CreateTimelineProjectBundleAudioInput;
    initialVideoCloneToFillIndex?: number;
    initialVideoTrimFinalToAudio: boolean;
    initialAudioTrimFinalToVideo: boolean;
    askVideoCloneToFill: boolean;
    askVideoTrimFinalToAudio: boolean;
    askAudioTrimFinalToVideo: boolean;
  }
): Promise<{
  videoCloneToFillIndex?: number;
  videoTrimFinalToAudio: boolean;
  audioTrimFinalToVideo: boolean;
}> {
  if (!input.audioItem || input.videoClips.length === 0) {
    return {
      videoCloneToFillIndex: undefined,
      videoTrimFinalToAudio: false,
      audioTrimFinalToVideo: false,
    };
  }

  const safeInitialVideoCloneToFillIndex =
    input.initialVideoCloneToFillIndex != null &&
    input.initialVideoCloneToFillIndex >= 1 &&
    input.initialVideoCloneToFillIndex <= input.videoClips.length
      ? input.initialVideoCloneToFillIndex
      : undefined;

  const videoCloneToFillIndex = input.askVideoCloneToFill
    ? await promptApi.promptSelectValue<number | null>({
        message: "Video fill behavior",
        choices: [
          {
            title: "None",
            value: null,
            description: "Keep the current video sequence as-is.",
          },
          ...input.videoClips.map((clip, index) => ({
            title: getVideoChoiceTitle(index, clip),
            value: index + 1,
            description: "Clone this clip until the video track reaches or exceeds the audio length.",
          })),
        ],
        initial: safeInitialVideoCloneToFillIndex ?? null,
      })
    : safeInitialVideoCloneToFillIndex ?? null;

  const videoTrimFinalToAudio = input.askVideoTrimFinalToAudio
    ? await promptApi.promptConfirmValue({
        message: "Trim the final video clip to audio length?",
        initial: input.initialVideoTrimFinalToAudio,
      })
    : input.initialVideoTrimFinalToAudio;

  const audioTrimFinalToVideo = input.askAudioTrimFinalToVideo
    ? await promptApi.promptConfirmValue({
        message: "Trim audio to the final video length?",
        initial: input.initialAudioTrimFinalToVideo,
      })
    : input.initialAudioTrimFinalToVideo;

  return {
    videoCloneToFillIndex: videoCloneToFillIndex ?? undefined,
    videoTrimFinalToAudio,
    audioTrimFinalToVideo,
  };
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
    console.log(
      "Add one or more video files. Paste a file path, or enter a folder path to browse its media files. Leave the path blank after the last clip."
    );
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
    const normalizedSourcePath = await promptMediaSourcePath(promptApi, {
      message: `Video clip ${clips.length + 1} path or folder`,
      label: `Video clip ${clips.length + 1} path`,
      kind: "video",
      allowBlank: clips.length > 0,
      blankValidationMessage: "At least one video clip is required.",
    });
    if (!normalizedSourcePath.trim()) {
      break;
    }

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
  const normalizedSourcePath = await promptMediaSourcePath(promptApi, {
    message: "Optional audio file or folder path (leave blank to skip)",
    label: "Audio file path",
    kind: "audio",
    initial: baseAudioItem?.sourcePath ?? "",
    allowBlank: true,
  });
  if (!normalizedSourcePath.trim()) return undefined;

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
    const name = needsNamePrompt
      ? await promptApi.promptTextValue({
          message: "Project name",
          initial: baseOptions.name,
          validate: (value) => (value.trim() ? true : "Project name is required."),
        })
      : baseOptions.name;
    const aspectRatio = needsAspectPrompt ? await askAspectRatio(promptApi, baseOptions.aspectRatio) : baseOptions.aspectRatio;
    const outputDirectory = needsOutputPrompt
      ? await promptOutputDirectory(promptApi, baseOptions.outputDirectory)
      : baseOptions.outputDirectory;
    const videoClips = needsVideoPrompt ? await promptVideoClips(promptApi, []) : baseOptions.videoClips;
    const audioItem = needsAudioPrompt ? await promptAudioItem(promptApi, undefined) : baseOptions.audioItem;
    const trackAdjustments = await promptTrackAdjustmentOptions(promptApi, {
      videoClips,
      audioItem,
      initialVideoCloneToFillIndex: baseOptions.videoCloneToFillIndex,
      initialVideoTrimFinalToAudio: Boolean(baseOptions.videoTrimFinalToAudio),
      initialAudioTrimFinalToVideo: Boolean(baseOptions.audioTrimFinalToVideo),
      askVideoCloneToFill: !parsedInput || parsedInput.videoCloneToFillIndex == null,
      askVideoTrimFinalToAudio: !parsedInput || !parsedInput.videoTrimFinalToAudio,
      askAudioTrimFinalToVideo: !parsedInput || !parsedInput.audioTrimFinalToVideo,
    });

    return {
      ...baseOptions,
      interactive: true,
      name,
      aspectRatio,
      outputDirectory,
      videoClips,
      audioItem,
      ...trackAdjustments,
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
  const trackAdjustments = await promptTrackAdjustmentOptions(promptApi, {
    videoClips,
    audioItem,
    initialVideoCloneToFillIndex: baseOptions.videoCloneToFillIndex,
    initialVideoTrimFinalToAudio: Boolean(baseOptions.videoTrimFinalToAudio),
    initialAudioTrimFinalToVideo: Boolean(baseOptions.audioTrimFinalToVideo),
    askVideoCloneToFill: true,
    askVideoTrimFinalToAudio: true,
    askAudioTrimFinalToVideo: true,
  });
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
    ...trackAdjustments,
  };
}

export async function resolveCreateTimelineProjectBundleOptions(
  options: CreateTimelineProjectBundleOptions,
  dependencies: Pick<CreateTimelineProjectBundleDependencies, "probeMedia"> = {}
): Promise<CreateTimelineProjectBundleOptions> {
  if (!hasTrackAdjustmentOptions(options)) {
    return options;
  }

  if (options.videoCloneToFillIndex != null && !options.audioItem) {
    throw new Error("--video-clone-to-fill requires an audio track in the created project.");
  }
  if (options.videoCloneToFillIndex != null) {
    const videoCount = options.videoClips.length;
    if (videoCount === 0 || options.videoCloneToFillIndex > videoCount) {
      throw new Error(
        `--video-clone-to-fill references video ${options.videoCloneToFillIndex}, but only ${videoCount} video clip${videoCount === 1 ? "" : "s"} were provided.`
      );
    }
  }

  const probeMedia = dependencies.probeMedia ?? probeMediaFileWithFfprobe;
  const mediaByPath = new Map<string, Promise<EditorProjectBundleResolvedMedia>>();

  const getMediaForDuration = async (sourcePath: string, label: string): Promise<EditorProjectBundleResolvedMedia> => {
    const cached = mediaByPath.get(sourcePath);
    if (cached) {
      return cached;
    }
    const nextPromise = probeMedia(sourcePath).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to resolve duration for ${label} (${sourcePath}): ${detail}`);
    });
    mediaByPath.set(sourcePath, nextPromise);
    return nextPromise;
  };

  const resolveVideoClipWindow = async (
    clip: CreateTimelineProjectBundleVideoInput,
    index: number
  ): Promise<ResolvedMediaTrimWindow> => {
    if (clip.trimEndSeconds != null) {
      return resolveConfiguredTrimWindow(clip.trimStartSeconds, clip.trimEndSeconds);
    }
    const media = await getMediaForDuration(clip.sourcePath, `video clip ${index + 1}`);
    if (!(Number.isFinite(media.durationSeconds) && media.durationSeconds > 0)) {
      throw new Error(`Unable to resolve duration for video clip ${index + 1} (${clip.sourcePath}): ffprobe returned no usable duration.`);
    }
    return resolveAssetBackedTrimWindow(clip.trimStartSeconds, clip.trimEndSeconds, media.durationSeconds);
  };

  const resolveAudioItemWindow = async (
    item: CreateTimelineProjectBundleAudioInput
  ): Promise<ResolvedMediaTrimWindow> => {
    if (item.trimEndSeconds != null) {
      return resolveConfiguredTrimWindow(item.trimStartSeconds, item.trimEndSeconds);
    }
    const media = await getMediaForDuration(item.sourcePath, "audio track");
    if (!(Number.isFinite(media.durationSeconds) && media.durationSeconds > 0)) {
      throw new Error(`Unable to resolve duration for audio track (${item.sourcePath}): ffprobe returned no usable duration.`);
    }
    return resolveAssetBackedTrimWindow(item.trimStartSeconds, item.trimEndSeconds, media.durationSeconds);
  };

  const getVideoTrackDuration = async (videoClips: CreateTimelineProjectBundleVideoInput[]) => {
    const windows = await Promise.all(videoClips.map((clip, index) => resolveVideoClipWindow(clip, index)));
    return {
      windows,
      durationSeconds: roundTimelineSeconds(
        windows.reduce((total, window) => total + window.durationSeconds, 0)
      ),
    };
  };

  const getAudioTrackEnd = async (audioItem: CreateTimelineProjectBundleAudioInput | undefined) => {
    if (!audioItem) {
      return { window: undefined, endSeconds: 0 };
    }
    const window = await resolveAudioItemWindow(audioItem);
    return {
      window,
      endSeconds: roundTimelineSeconds(audioItem.startOffsetSeconds + window.durationSeconds),
    };
  };

  const videoClips = options.videoClips.map((clip) => ({ ...clip }));
  let audioItem = options.audioItem ? { ...options.audioItem } : undefined;

  if (options.videoCloneToFillIndex != null && audioItem) {
    const { endSeconds: audioTrackEnd } = await getAudioTrackEnd(audioItem);
    const { windows, durationSeconds: initialVideoTrackDuration } = await getVideoTrackDuration(videoClips);
    let videoTrackDuration = initialVideoTrackDuration;
    const templateIndex = options.videoCloneToFillIndex - 1;
    const templateClip = videoClips[templateIndex];
    const templateWindow = windows[templateIndex];
    let insertedCloneCount = 0;

    while (videoTrackDuration + TIMELINE_DURATION_EPSILON < audioTrackEnd) {
      const insertionIndex = templateIndex + insertedCloneCount + 1;
      videoClips.splice(insertionIndex, 0, { ...templateClip });
      windows.splice(insertionIndex, 0, templateWindow);
      insertedCloneCount += 1;
      videoTrackDuration = roundTimelineSeconds(videoTrackDuration + templateWindow.durationSeconds);
    }
  }

  if (options.videoTrimFinalToAudio && audioItem && videoClips.length > 0) {
    const { endSeconds: audioTrackEnd } = await getAudioTrackEnd(audioItem);
    const { windows, durationSeconds: videoTrackDuration } = await getVideoTrackDuration(videoClips);
    if (videoTrackDuration > audioTrackEnd + TIMELINE_DURATION_EPSILON) {
      const finalIndex = videoClips.length - 1;
      const finalWindow = windows[finalIndex];
      const overshootSeconds = roundTimelineSeconds(videoTrackDuration - audioTrackEnd);
      const nextDurationSeconds = roundTimelineSeconds(finalWindow.durationSeconds - overshootSeconds);
      if (nextDurationSeconds >= MIN_TIMELINE_MEDIA_DURATION_SECONDS - TIMELINE_DURATION_EPSILON) {
        const finalClip = videoClips[finalIndex];
        videoClips[finalIndex] = {
          ...finalClip,
          trimStartSeconds: finalWindow.trimStartSeconds,
          trimEndSeconds: roundTimelineSeconds(finalWindow.trimEndSeconds - overshootSeconds),
        };
      }
    }
  }

  if (options.audioTrimFinalToVideo && audioItem && videoClips.length > 0) {
    const { durationSeconds: videoTrackDuration } = await getVideoTrackDuration(videoClips);
    const { window: audioWindow, endSeconds: audioTrackEnd } = await getAudioTrackEnd(audioItem);
    if (audioWindow && audioTrackEnd > videoTrackDuration + TIMELINE_DURATION_EPSILON) {
      const overshootSeconds = roundTimelineSeconds(audioTrackEnd - videoTrackDuration);
      const nextDurationSeconds = roundTimelineSeconds(audioWindow.durationSeconds - overshootSeconds);
      if (nextDurationSeconds >= MIN_TIMELINE_MEDIA_DURATION_SECONDS - TIMELINE_DURATION_EPSILON) {
        audioItem = {
          ...audioItem,
          trimStartSeconds: audioWindow.trimStartSeconds,
          trimEndSeconds: roundTimelineSeconds(audioWindow.trimEndSeconds - overshootSeconds),
        };
      }
    }
  }

  return {
    ...options,
    videoClips,
    audioItem,
  };
}

export async function createTimelineProjectBundle(
  options: CreateTimelineProjectBundleOptions,
  dependencies: CreateTimelineProjectBundleDependencies = {}
): Promise<CreatedTimelineProjectBundleResult> {
  const resolvedOptions = await resolveCreateTimelineProjectBundleOptions(options, {
    probeMedia: dependencies.probeMedia,
  });
  const builtBundle = buildEditorProjectBundleFromCliOptions(resolvedOptions, dependencies.now?.() ?? Date.now());
  const outputDirectory = path.resolve(resolvedOptions.outputDirectory);
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
