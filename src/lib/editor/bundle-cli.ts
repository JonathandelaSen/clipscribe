import type {
  EditorProjectBundleAudioItemSpec,
  EditorProjectBundleManifestV1,
  EditorProjectBundleVideoClipSpec,
} from "./bundle";
import type { EditorAspectRatio } from "./types";

const DEFAULT_PROJECT_NAME = "Untitled Timeline";
const DEFAULT_OUTPUT_DIRECTORY = ".";
const VALID_ASPECT_RATIOS: EditorAspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
const SHELL_ESCAPED_PATH_CHAR_PATTERN = /\\([ !"#$&'()*;<>?\[\]{}|])/g;

export interface ParsedCreateTimelineProjectBundleCliInput {
  help: boolean;
  interactive: boolean;
  name?: string;
  aspectRatio?: EditorAspectRatio;
  outputDirectory?: string;
  videoPaths: string[];
  audioPath?: string;
  videoCloneToFillIndex?: number;
  videoTrimFinalToAudio: boolean;
  audioTrimFinalToVideo: boolean;
  reverseIndexes: number[];
  mutedVideoIndexes: number[];
  videoTrimSpecs: Array<{ index: number; startSeconds: number; endSeconds: number }>;
  videoVolumeSpecs: Array<{ index: number; volume: number }>;
  audioTrimSpec?: { startSeconds: number; endSeconds: number };
  audioStartSeconds?: number;
  audioVolume?: number;
  audioMuted: boolean;
}

export interface CreateTimelineProjectBundleVideoInput {
  sourcePath: string;
  label: string;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  reverse: boolean;
  volume: number;
  muted: boolean;
}

export interface CreateTimelineProjectBundleAudioInput {
  sourcePath: string;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  startOffsetSeconds: number;
  volume: number;
  muted: boolean;
}

export interface CreateTimelineProjectBundleOptions {
  interactive: boolean;
  name: string;
  aspectRatio: EditorAspectRatio;
  outputDirectory: string;
  videoClips: CreateTimelineProjectBundleVideoInput[];
  audioItem?: CreateTimelineProjectBundleAudioInput;
  videoCloneToFillIndex?: number;
  videoTrimFinalToAudio?: boolean;
  audioTrimFinalToVideo?: boolean;
}

export interface EditorProjectBundleCopyPlanEntry {
  sourcePath: string;
  bundlePath: string;
}

export interface BuiltEditorProjectBundle {
  manifest: EditorProjectBundleManifestV1;
  bundleDirectoryName: string;
  outputDirectory: string;
  copyPlan: EditorProjectBundleCopyPlanEntry[];
}

function readRequiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function readPositiveIndex(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a 1-based integer.`);
  }
  return parsed;
}

function readNonNegativeNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }
  return parsed;
}

function readVolume(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return parsed;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeCliPathInput(value: string, label: string): string {
  const trimmed = stripWrappingQuotes(value.trim()).replace(SHELL_ESCAPED_PATH_CHAR_PATTERN, "$1");
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }
  return trimmed;
}

function parseVideoTrimSpec(value: string): { index: number; startSeconds: number; endSeconds: number } {
  const [rawIndex, rawStart, rawEnd] = value.split(":");
  if (rawIndex == null || rawStart == null || rawEnd == null) {
    throw new Error("--video-trim must use index:start:end.");
  }

  const index = readPositiveIndex(rawIndex, "--video-trim index");
  const startSeconds = readNonNegativeNumber(rawStart, "--video-trim start");
  const endSeconds = readNonNegativeNumber(rawEnd, "--video-trim end");
  if (endSeconds <= startSeconds) {
    throw new Error("--video-trim end must be greater than start.");
  }

  return { index, startSeconds, endSeconds };
}

function parseVideoVolumeSpec(value: string): { index: number; volume: number } {
  const [rawIndex, rawVolume] = value.split(":");
  if (rawIndex == null || rawVolume == null) {
    throw new Error("--video-volume must use index:volume.");
  }

  return {
    index: readPositiveIndex(rawIndex, "--video-volume index"),
    volume: readVolume(rawVolume, "--video-volume value"),
  };
}

function parseAudioTrimSpec(value: string): { startSeconds: number; endSeconds: number } {
  const [rawStart, rawEnd] = value.split(":");
  if (rawStart == null || rawEnd == null) {
    throw new Error("--audio-trim must use start:end.");
  }

  const startSeconds = readNonNegativeNumber(rawStart, "--audio-trim start");
  const endSeconds = readNonNegativeNumber(rawEnd, "--audio-trim end");
  if (endSeconds <= startSeconds) {
    throw new Error("--audio-trim end must be greater than start.");
  }

  return { startSeconds, endSeconds };
}

function getFilenameFromPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || normalized;
}

function getDefaultLabelFromPath(value: string): string {
  return getFilenameFromPath(value).replace(/\.[^/.]+$/, "") || "Clip";
}

function getSafeFilenameStem(value: string): string {
  const stem = getFilenameFromPath(value).replace(/\.[^/.]+$/, "") || "asset";
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
}

function getFilenameExtension(value: string): string {
  const filename = getFilenameFromPath(value);
  const match = filename.match(/(\.[^./\\]+)$/);
  return match?.[1] ?? "";
}

function createSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "timeline-project";
}

function assertVideoIndexInRange(index: number, videoCount: number, label: string) {
  if (index > videoCount) {
    throw new Error(`${label} references video ${index}, but only ${videoCount} video clip${videoCount === 1 ? "" : "s"} were provided.`);
  }
}

export function getCreateTimelineProjectBundleHelpText(): string {
  return [
    "Create an importable Timeline Studio bundle.",
    "",
    "Usage:",
    "  npm run create:timeline-project -- --video /path/to/a.mp4 --video /path/to/image.png [options]",
    "",
    "Options:",
    "  --interactive                Run the prompt-based wizard",
    "  --name <value>               Project name",
    "  --aspect <16:9|9:16|1:1|4:5> Output aspect ratio (default: 16:9)",
    "  --video <path>               Add a video or image clip in sequence order (repeatable)",
    "  --audio <path>               Add one optional top-level audio track",
    "  --reverse <index>            Reverse the given 1-based video clip index (repeatable)",
    "  --video-trim <i:start:end>   Override one clip trim window (repeatable)",
    "  --video-volume <i:volume>    Override one clip volume from 0 to 1 (repeatable)",
    "  --video-muted <index>        Mute the given 1-based video clip index (repeatable)",
    "  --video-clone-to-fill <i>    Clone one clip until the video track reaches the audio length",
    "  --video-trim-final-to-audio  Trim the last video clip so video matches audio length",
    "  --audio-trim <start:end>     Trim the optional audio item",
    "  --audio-start <seconds>      Audio start offset in project time",
    "  --audio-volume <0-1>         Audio item volume",
    "  --audio-muted                Mute the optional audio item",
    "  --audio-trim-final-to-video  Trim audio so it matches the final video length",
    "  --output <directory>         Destination parent directory for the bundle",
    "  --help                       Show this help text",
  ].join("\n");
}

export function parseCreateTimelineProjectBundleArgs(
  args: readonly string[]
): ParsedCreateTimelineProjectBundleCliInput {
  const parsed: ParsedCreateTimelineProjectBundleCliInput = {
    help: false,
    interactive: false,
    videoPaths: [],
    videoTrimFinalToAudio: false,
    audioTrimFinalToVideo: false,
    reverseIndexes: [],
    mutedVideoIndexes: [],
    videoTrimSpecs: [],
    videoVolumeSpecs: [],
    audioMuted: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    switch (token) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--interactive":
        parsed.interactive = true;
        break;
      case "--name":
        parsed.name = readRequiredValue(args, index, token);
        index += 1;
        break;
      case "--aspect": {
        const value = readRequiredValue(args, index, token);
        if (!VALID_ASPECT_RATIOS.includes(value as EditorAspectRatio)) {
          throw new Error(`--aspect must be one of ${VALID_ASPECT_RATIOS.join(", ")}.`);
        }
        parsed.aspectRatio = value as EditorAspectRatio;
        index += 1;
        break;
      }
      case "--output":
        parsed.outputDirectory = readRequiredValue(args, index, token);
        index += 1;
        break;
      case "--video":
        parsed.videoPaths.push(readRequiredValue(args, index, token));
        index += 1;
        break;
      case "--audio":
        parsed.audioPath = readRequiredValue(args, index, token);
        index += 1;
        break;
      case "--video-clone-to-fill":
        parsed.videoCloneToFillIndex = readPositiveIndex(readRequiredValue(args, index, token), token);
        index += 1;
        break;
      case "--reverse":
        parsed.reverseIndexes.push(readPositiveIndex(readRequiredValue(args, index, token), token));
        index += 1;
        break;
      case "--video-muted":
        parsed.mutedVideoIndexes.push(readPositiveIndex(readRequiredValue(args, index, token), token));
        index += 1;
        break;
      case "--video-trim":
        parsed.videoTrimSpecs.push(parseVideoTrimSpec(readRequiredValue(args, index, token)));
        index += 1;
        break;
      case "--video-volume":
        parsed.videoVolumeSpecs.push(parseVideoVolumeSpec(readRequiredValue(args, index, token)));
        index += 1;
        break;
      case "--audio-trim":
        parsed.audioTrimSpec = parseAudioTrimSpec(readRequiredValue(args, index, token));
        index += 1;
        break;
      case "--audio-start":
        parsed.audioStartSeconds = readNonNegativeNumber(readRequiredValue(args, index, token), token);
        index += 1;
        break;
      case "--audio-volume":
        parsed.audioVolume = readVolume(readRequiredValue(args, index, token), token);
        index += 1;
        break;
      case "--audio-muted":
        parsed.audioMuted = true;
        break;
      case "--video-trim-final-to-audio":
        parsed.videoTrimFinalToAudio = true;
        break;
      case "--audio-trim-final-to-video":
        parsed.audioTrimFinalToVideo = true;
        break;
      default:
        throw new Error(`Unknown flag "${token}". Use --help to see supported options.`);
    }
  }

  return parsed;
}

export function normalizeCreateTimelineProjectBundleCliInput(
  parsed: ParsedCreateTimelineProjectBundleCliInput,
  cwd = DEFAULT_OUTPUT_DIRECTORY
): CreateTimelineProjectBundleOptions {
  if (!parsed.interactive && parsed.videoPaths.length === 0) {
    throw new Error("At least one --video path (video or image file) is required unless you use --interactive.");
  }
  if (parsed.videoCloneToFillIndex != null && !parsed.audioPath) {
    throw new Error("--video-clone-to-fill requires --audio so the target track length is known.");
  }

  const videoClips: CreateTimelineProjectBundleVideoInput[] = parsed.videoPaths.map((path) => {
    const sourcePath = normalizeCliPathInput(path, "--video");
    return {
      sourcePath,
      label: getDefaultLabelFromPath(sourcePath),
      trimStartSeconds: 0,
      trimEndSeconds: null,
      reverse: false,
      volume: 1,
      muted: false,
    };
  });

  for (const index of parsed.reverseIndexes) {
    assertVideoIndexInRange(index, videoClips.length, "--reverse");
    videoClips[index - 1].reverse = true;
  }

  for (const index of parsed.mutedVideoIndexes) {
    assertVideoIndexInRange(index, videoClips.length, "--video-muted");
    videoClips[index - 1].muted = true;
  }

  for (const spec of parsed.videoTrimSpecs) {
    assertVideoIndexInRange(spec.index, videoClips.length, "--video-trim");
    videoClips[spec.index - 1].trimStartSeconds = spec.startSeconds;
    videoClips[spec.index - 1].trimEndSeconds = spec.endSeconds;
  }

  for (const spec of parsed.videoVolumeSpecs) {
    assertVideoIndexInRange(spec.index, videoClips.length, "--video-volume");
    videoClips[spec.index - 1].volume = spec.volume;
  }

  if (parsed.videoCloneToFillIndex != null) {
    assertVideoIndexInRange(parsed.videoCloneToFillIndex, videoClips.length, "--video-clone-to-fill");
  }

  const audioItem = parsed.audioPath
    ? {
        sourcePath: normalizeCliPathInput(parsed.audioPath, "--audio"),
        trimStartSeconds: parsed.audioTrimSpec?.startSeconds ?? 0,
        trimEndSeconds: parsed.audioTrimSpec?.endSeconds ?? null,
        startOffsetSeconds: parsed.audioStartSeconds ?? 0,
        volume: parsed.audioVolume ?? 1,
        muted: parsed.audioMuted,
      }
    : undefined;

  return {
    interactive: parsed.interactive,
    name: parsed.name?.trim() || DEFAULT_PROJECT_NAME,
    aspectRatio: parsed.aspectRatio ?? "16:9",
    outputDirectory: parsed.outputDirectory ? normalizeCliPathInput(parsed.outputDirectory, "--output") : cwd,
    videoClips,
    audioItem,
    videoCloneToFillIndex: parsed.videoCloneToFillIndex,
    videoTrimFinalToAudio: parsed.videoTrimFinalToAudio,
    audioTrimFinalToVideo: parsed.audioTrimFinalToVideo,
  };
}

export function buildEditorProjectBundleFromCliOptions(
  options: CreateTimelineProjectBundleOptions,
  now = Date.now()
): BuiltEditorProjectBundle {
  const sourcePathToBundlePath = new Map<string, string>();
  const usedBundlePaths = new Set<string>();
  const copyPlan: EditorProjectBundleCopyPlanEntry[] = [];
  let uniqueAssetCounter = 0;

  const resolveBundlePath = (sourcePath: string) => {
    const existing = sourcePathToBundlePath.get(sourcePath);
    if (existing) return existing;

    uniqueAssetCounter += 1;
    const baseStem = getSafeFilenameStem(sourcePath);
    const extension = getFilenameExtension(sourcePath);
    let bundlePath = `media/asset-${String(uniqueAssetCounter).padStart(2, "0")}-${baseStem}${extension}`;

    let collisionCounter = 2;
    while (usedBundlePaths.has(bundlePath)) {
      bundlePath = `media/asset-${String(uniqueAssetCounter).padStart(2, "0")}-${baseStem}-${collisionCounter}${extension}`;
      collisionCounter += 1;
    }

    sourcePathToBundlePath.set(sourcePath, bundlePath);
    usedBundlePaths.add(bundlePath);
    copyPlan.push({ sourcePath, bundlePath });
    return bundlePath;
  };

  const videoClips: EditorProjectBundleVideoClipSpec[] = options.videoClips.map((clip) => ({
    path: resolveBundlePath(clip.sourcePath),
    label: clip.label,
    trimStartSeconds: clip.trimStartSeconds,
    trimEndSeconds: clip.trimEndSeconds,
    reverse: clip.reverse,
    volume: clip.volume,
    muted: clip.muted,
  }));

  const audioItem: EditorProjectBundleAudioItemSpec | undefined = options.audioItem
    ? {
        path: resolveBundlePath(options.audioItem.sourcePath),
        trimStartSeconds: options.audioItem.trimStartSeconds,
        trimEndSeconds: options.audioItem.trimEndSeconds,
        startOffsetSeconds: options.audioItem.startOffsetSeconds,
        volume: options.audioItem.volume,
        muted: options.audioItem.muted,
      }
    : undefined;

  return {
    manifest: {
      schemaVersion: 1,
      createdAt: now,
      name: options.name.trim() || DEFAULT_PROJECT_NAME,
      aspectRatio: options.aspectRatio,
      videoClips,
      audioItem,
    },
    bundleDirectoryName: `${createSlug(options.name)}.clipscribe-project`,
    outputDirectory: options.outputDirectory,
    copyPlan,
  };
}
