import { spawn } from "node:child_process";
import { access, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { buildEditorAssFilterExpression, buildEditorAssSubtitleDocument } from "./ass-subtitles";
import { buildProjectSubtitleTimeline } from "./core/captions";
import { getEditorExportCapability } from "./export-capabilities";
import { buildEditorExportPlan, type ResolvedExportInput } from "./core/export-plan";
import type { CommandRunResult, CommandRunner } from "./node-media";
import { buildMissingBinaryMessage, getBundledBinaryPath, isEnoentError } from "./node-binaries";
import type { EditorAssetRecord, EditorProjectRecord, EditorResolution } from "./types";

export interface NodeEditorExportAsset {
  asset: EditorAssetRecord;
  absolutePath: string;
}

export interface NodeEditorExportOverlay {
  absolutePath: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cropExpression?: string;
}

export interface NodeEditorExportInput {
  project: EditorProjectRecord;
  assets: readonly NodeEditorExportAsset[];
  overlays?: readonly NodeEditorExportOverlay[];
  resolution: EditorResolution;
  outputPath: string;
  overwrite?: boolean;
  dryRun?: boolean;
  commandRunner?: CommandRunner;
  ffmpegPath?: string | null;
  onProgress?: (progress: NodeEditorExportProgress) => void;
  signal?: AbortSignal;
}

export interface NodeEditorExportProgress {
  percent: number;
  processedSeconds: number;
  durationSeconds: number;
}

export interface NodeEditorExportResult {
  outputPath: string;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  warnings: string[];
  ffmpegCommandPreview: string[];
  notes: string[];
  dryRun: boolean;
}

const STILL_IMAGE_EXPORT_FPS = 30;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseFfmpegTimecodeToSeconds(timecode: string): number | null {
  const match = timecode.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return null;
  const [, hoursRaw, minutesRaw, secondsRaw, fractionRaw] = match;
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  const fraction = fractionRaw ? Number(`0.${fractionRaw}`) : 0;
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function parseFfmpegProgressSeconds(message: string): number | null {
  const matches = [...message.matchAll(/\btime=(\d+:\d{2}:\d{2}(?:\.\d+)?)\b/g)];
  if (matches.length === 0) return null;
  return parseFfmpegTimecodeToSeconds(matches[matches.length - 1]?.[1] ?? "");
}

function createAbortError() {
  const error = new Error("Export canceled.");
  error.name = "AbortError";
  return error;
}

export function isNodeEditorExportCanceledError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    onStderrChunk?: (chunk: string) => void;
    signal?: AbortSignal;
  } = {}
): Promise<CommandRunResult> {
  return new Promise<CommandRunResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", handleAbort);
      callback();
    };

    const handleAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {}
      finish(() => reject(createAbortError()));
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    options.signal?.addEventListener("abort", handleAbort, { once: true });

    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() =>
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        })
      );
    });
  });
}

function getStderrTail(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-8).join("\n");
}

function assertCliExportSupported(
  project: EditorProjectRecord,
  assets: readonly NodeEditorExportAsset[]
) {
  const capability = getEditorExportCapability({
    project,
    assets,
  });
  if (!capability.supported) {
    throw new Error(capability.reasons.join("\n"));
  }
}

function isStillImageCompatibilityExport(project: EditorProjectRecord): boolean {
  return project.timeline.videoClips.length === 0 && project.timeline.imageItems.length > 0;
}

function buildNodeEditorInputArgs(input: {
  inputs: readonly ResolvedExportInput[];
  imageFramerate?: number | null;
}): string[] {
  return input.inputs.flatMap((item) => {
    if (item.asset.kind !== "image") {
      return ["-i", item.path];
    }

    const args = ["-loop", "1"];
    if (typeof input.imageFramerate === "number" && Number.isFinite(input.imageFramerate) && input.imageFramerate > 0) {
      args.push("-framerate", String(input.imageFramerate));
    }
    args.push("-i", item.path);
    return args;
  });
}

function buildOverlayFilterGraph(input: {
  baseVideoLabel: string;
  overlays: readonly NodeEditorExportOverlay[];
  overlayInputStartIndex: number;
}): {
  outputLabel: string;
  filterParts: string[];
} {
  const filterParts: string[] = [];
  let currentLabel = input.baseVideoLabel;

  input.overlays.forEach((overlay, index) => {
    const sourceInputLabel = `overlay_input_${index}`;
    const croppedInputLabel = overlay.cropExpression ? `overlay_crop_${index}` : sourceInputLabel;
    const outputLabel = `overlay_${index}`;
    filterParts.push(`[${input.overlayInputStartIndex + index}:v]setpts=PTS-STARTPTS[${sourceInputLabel}]`);
    if (overlay.cropExpression) {
      filterParts.push(
        `[${sourceInputLabel}]crop=${Math.max(1, Math.round(overlay.width))}:${Math.max(1, Math.round(overlay.height))}:0:'${overlay.cropExpression}'[${croppedInputLabel}]`
      );
    }
    filterParts.push(
      `[${currentLabel}][${croppedInputLabel}]overlay=x=${Math.max(0, Math.round(overlay.x))}:y=${Math.max(0, Math.round(overlay.y))}:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${outputLabel}]`
    );
    currentLabel = outputLabel;
  });

  return {
    filterParts,
    outputLabel: currentLabel,
  };
}

export function buildNodeEditorExportCommand(input: {
  project: EditorProjectRecord;
  assets: readonly NodeEditorExportAsset[];
  overlays?: readonly NodeEditorExportOverlay[];
  resolution: EditorResolution;
  outputPath: string;
  overwrite?: boolean;
  subtitleTrackPath?: string | null;
}): {
  width: number;
  height: number;
  durationSeconds: number;
  warnings: string[];
  ffmpegArgs: string[];
  ffmpegCommandPreview: string[];
  notes: string[];
} {
  assertCliExportSupported(input.project, input.assets);

  const exportPlan = buildEditorExportPlan({
    project: input.project,
    inputs: input.assets.map(({ asset, absolutePath }, index) => ({
      inputIndex: index,
      assetId: asset.id,
      path: absolutePath,
      asset,
    })),
    resolution: input.resolution,
  });
  const useStillImageCompatibilityPreset = isStillImageCompatibilityExport(input.project);
  const overlays = input.overlays ?? [];

  let filterComplex = exportPlan.filterComplex;
  let videoTrackLabel = exportPlan.videoTrackLabel;
  if (overlays.length > 0) {
    const overlayGraph = buildOverlayFilterGraph({
      baseVideoLabel: videoTrackLabel,
      overlays,
      overlayInputStartIndex: exportPlan.inputs.length,
    });
    filterComplex = `${filterComplex};${overlayGraph.filterParts.join(";")}`;
    videoTrackLabel = overlayGraph.outputLabel;
  }
  if (input.subtitleTrackPath) {
    const subtitleVideoLabel = "video_track_subtitles";
    filterComplex = `${filterComplex};[${videoTrackLabel}]${buildEditorAssFilterExpression(input.subtitleTrackPath)}[${subtitleVideoLabel}]`;
    videoTrackLabel = subtitleVideoLabel;
  }

  const mapArgs = ["-map", `[${videoTrackLabel}]`];
  if (exportPlan.mixedAudioLabel) {
    mapArgs.push("-map", `[${exportPlan.mixedAudioLabel}]`);
  }

  const ffmpegArgs = [
    input.overwrite ? "-y" : "-n",
    ...buildNodeEditorInputArgs({
      inputs: exportPlan.inputs,
      imageFramerate: useStillImageCompatibilityPreset ? STILL_IMAGE_EXPORT_FPS : null,
    }),
    ...overlays.flatMap((overlay) => ["-loop", "1", "-i", overlay.absolutePath]),
    "-filter_complex",
    filterComplex,
    ...mapArgs,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    input.resolution === "4K" ? "24" : "22",
  ];
  if (useStillImageCompatibilityPreset) {
    ffmpegArgs.push(
      "-r",
      String(STILL_IMAGE_EXPORT_FPS),
      "-tune",
      "stillimage",
      "-pix_fmt",
      "yuv420p"
    );
  }
  ffmpegArgs.push(
    "-movflags",
    "+faststart"
  );
  if (exportPlan.mixedAudioLabel) {
    ffmpegArgs.push("-c:a", "aac", "-b:a", "192k");
  }
  if (useStillImageCompatibilityPreset) {
    ffmpegArgs.push("-t", exportPlan.durationSeconds.toFixed(3), "-shortest");
  }
  ffmpegArgs.push(input.outputPath);

  return {
    width: exportPlan.width,
    height: exportPlan.height,
    durationSeconds: exportPlan.durationSeconds,
    warnings: exportPlan.warnings,
    ffmpegArgs,
    ffmpegCommandPreview: ["ffmpeg", ...ffmpegArgs],
    notes: [
      `Timeline export via system ffmpeg (${input.project.aspectRatio} @ ${input.resolution}).`,
      input.project.timeline.videoClips.length
        ? `${input.project.timeline.videoClips.length} video clips in ripple sequence.`
        : "No video clips on the base track.",
      input.project.timeline.imageItems.length
        ? `${input.project.timeline.imageItems.length} image track item${input.project.timeline.imageItems.length === 1 ? "" : "s"} layered across the export.`
        : "No image overlay track.",
      overlays.length
        ? `${overlays.length} reactive overlay atlas input${overlays.length === 1 ? "" : "s"} composed before subtitles.`
        : "No reactive overlay atlases.",
      input.project.timeline.audioItems.length
        ? `${input.project.timeline.audioItems.length} audio track item${input.project.timeline.audioItems.length === 1 ? "" : "s"} mixed with clip audio.`
        : exportPlan.mixedAudioLabel
          ? "Clip audio only."
          : "No audio track.",
      input.project.timeline.overlayItems.length
        ? `Reactive overlay items=${input.project.timeline.overlayItems.length}; presets=${[...new Set(input.project.timeline.overlayItems.map((item) => item.presetId))].join(", ")}; analysisSource=final_mix.`
        : "Reactive overlay items=0.",
      useStillImageCompatibilityPreset
        ? `Still-image compatibility preset enabled: ${STILL_IMAGE_EXPORT_FPS}fps looped image inputs, CFR output, tune=stillimage, yuv420p, and explicit duration clamp.`
        : "Standard CLI export preset.",
      input.subtitleTrackPath ? "Global subtitle track burned in via ASS." : "No subtitle burn-in is rendered.",
      input.resolution === "4K" ? "4K uses a slightly higher CRF preset." : "Standard CRF preset.",
    ],
  };
}

export async function exportEditorProjectWithSystemFfmpeg(
  input: NodeEditorExportInput
): Promise<NodeEditorExportResult> {
  const outputPath = path.resolve(input.outputPath);
  if (!input.overwrite) {
    try {
      await access(outputPath, fsConstants.F_OK);
      throw new Error(`Export output already exists: ${outputPath}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Export output already exists")) {
        throw error;
      }
    }
  }

  const subtitleTimeline = buildProjectSubtitleTimeline({
    project: input.project,
    historyMap: new Map(),
  });
  const subtitleTrackPath =
    input.project.subtitles.enabled && subtitleTimeline.length > 0
      ? path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.subs.ass`)
      : null;

  const command = buildNodeEditorExportCommand({
    project: input.project,
    assets: input.assets,
    overlays: input.overlays,
    resolution: input.resolution,
    outputPath,
    overwrite: input.overwrite,
    subtitleTrackPath,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  if (!input.dryRun && subtitleTrackPath) {
    await mkdir(path.dirname(subtitleTrackPath), { recursive: true });
    await writeFile(
      subtitleTrackPath,
      buildEditorAssSubtitleDocument({
        project: input.project,
        chunks: subtitleTimeline,
        width: command.width,
        height: command.height,
      }),
      "utf8"
    );
  }

  try {
    if (!input.dryRun) {
      const commandCandidates = [
        "ffmpeg",
        input.ffmpegPath ?? getBundledBinaryPath("ffmpeg"),
      ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

      let result: CommandRunResult | null = null;
      let lastProgressPercent = -1;
      const emitProgress = (processedSeconds: number) => {
        if (!input.onProgress || command.durationSeconds <= 0) return;
        const percent = clampNumber((processedSeconds / command.durationSeconds) * 100, 0, 100);
        if (percent <= lastProgressPercent + 0.25 && percent < 100) return;
        lastProgressPercent = percent;
        input.onProgress({
          percent,
          processedSeconds,
          durationSeconds: command.durationSeconds,
        });
      };

      emitProgress(0);
      for (const commandName of commandCandidates) {
        try {
          if (input.commandRunner) {
            result = await input.commandRunner(commandName, command.ffmpegArgs);
          } else {
            result = await runCommand(commandName, command.ffmpegArgs, {
              onStderrChunk: (chunk) => {
                const processedSeconds = parseFfmpegProgressSeconds(chunk);
                if (processedSeconds != null) {
                  emitProgress(processedSeconds);
                }
              },
              signal: input.signal,
            });
          }
          break;
        } catch (error) {
          if (isEnoentError(error)) {
            continue;
          }
          throw error;
        }
      }

      if (!result) {
        if (input.signal?.aborted) {
          throw createAbortError();
        }
        throw new Error(buildMissingBinaryMessage("ffmpeg"));
      }

      if (result.code !== 0) {
        const detail = getStderrTail(result.stderr) || result.stdout.trim() || "Unknown ffmpeg failure.";
        throw new Error(`ffmpeg failed while rendering the timeline.\n${detail}`);
      }

      emitProgress(command.durationSeconds);
    }

    const outputStats = input.dryRun ? null : await stat(outputPath);
    if (outputStats && outputStats.size < 1024) {
      throw new Error(`Rendered output is empty: ${outputPath}`);
    }

    return {
      outputPath,
      filename: path.basename(outputPath),
      width: command.width,
      height: command.height,
      sizeBytes: outputStats?.size ?? 0,
      durationSeconds: command.durationSeconds,
      warnings: command.warnings,
      ffmpegCommandPreview: command.ffmpegCommandPreview,
      notes: command.notes,
      dryRun: Boolean(input.dryRun),
    };
  } finally {
    if (!input.dryRun && subtitleTrackPath) {
      await rm(subtitleTrackPath, { force: true }).catch(() => undefined);
    }
  }
}
