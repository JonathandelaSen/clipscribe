import { spawn } from "node:child_process";
import { access, mkdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { buildEditorAssFilterExpression, buildEditorAssSubtitleDocument } from "./ass-subtitles";
import { buildProjectSubtitleTimeline } from "./core/captions";
import { getEditorExportCapability } from "./export-capabilities";
import { buildEditorExportPlan, type ResolvedExportInput } from "./core/export-plan";
import {
  getEditorSoftwareFallbackEncoder,
  selectEditorVideoEncoderFromFfmpegOutput,
  type EditorVideoEncoderSelection,
} from "./encoder-policy";
import type { CommandRunResult, CommandRunner } from "./node-media";
import { buildMissingBinaryMessage, getBundledBinaryPath, isEnoentError } from "./node-binaries";
import type { EditorAssetRecord, EditorProjectRecord, EditorResolution } from "./types";

const FILTER_COMPLEX_INLINE_ARG_LIMIT = 24_000;
const HARDWARE_ENCODER_STARTUP_STALL_MS = 12_000;
const HARDWARE_ENCODER_STARTUP_CHECK_INTERVAL_MS = 1_000;
const ENCODER_CACHE = new Map<string, Promise<EditorVideoEncoderSelection>>();

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

export interface NodeEditorExportOverlaySequence {
  directoryPath: string;
  filenamePattern: string;
  fps: number;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeEditorExportInput {
  project: EditorProjectRecord;
  assets: readonly NodeEditorExportAsset[];
  overlays?: readonly NodeEditorExportOverlay[];
  overlaySequences?: readonly NodeEditorExportOverlaySequence[];
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

async function materializeFilterComplexArgs(input: {
  ffmpegArgs: readonly string[];
  scriptPath: string;
}) {
  const filterIndex = input.ffmpegArgs.indexOf("-filter_complex");
  if (filterIndex < 0) {
    return {
      ffmpegArgs: [...input.ffmpegArgs],
      usedScript: false,
    };
  }
  const filterGraph = input.ffmpegArgs[filterIndex + 1] ?? "";
  if (filterGraph.length < FILTER_COMPLEX_INLINE_ARG_LIMIT) {
    return {
      ffmpegArgs: [...input.ffmpegArgs],
      usedScript: false,
    };
  }
  await writeFile(input.scriptPath, filterGraph, "utf8");
  const ffmpegArgs = [...input.ffmpegArgs];
  ffmpegArgs.splice(filterIndex, 2, "-filter_complex_script", input.scriptPath);
  return {
    ffmpegArgs,
    usedScript: true,
  };
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
  encoderUsed?: string;
  hardwareAccelerated?: boolean;
  timingsMs?: {
    serverFfmpeg?: number;
  };
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

function createHardwareEncoderStartupStallError(encoderUsed: string, elapsedMs: number) {
  const error = new Error(
    `Hardware encoder ${encoderUsed} produced no output during startup after ${Math.round(elapsedMs)}ms.`
  );
  error.name = "EditorHardwareEncoderStartupStallError";
  return error;
}

function isEditorHardwareEncoderStartupStallError(error: unknown) {
  return error instanceof Error && error.name === "EditorHardwareEncoderStartupStallError";
}

function createCombinedAbortSignal(signals: Array<AbortSignal | undefined>) {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  };

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abort();
      break;
    }
    const handleAbort = () => {
      abort();
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", handleAbort));
  }

  return {
    signal: controller.signal,
    dispose: abort,
  };
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

const STDERR_NOISE_PATTERN =
  /^(frame=|fps=|stream_|bitrate=|total_size=|out_time|dup_frames=|drop_frames=|speed=|progress=|bench:)/;
const STDERR_ERROR_PATTERN =
  /\b(error|invalid|failed|unable|cannot|conversion failed|permission denied|no such file|not found|out of memory)\b/i;

function getStderrTail(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter((line) => !STDERR_NOISE_PATTERN.test(line));
  const source = filtered.length > 0 ? filtered : lines;
  if (source.length === 0) return "";

  let relevantIndex = -1;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (STDERR_ERROR_PATTERN.test(source[index] ?? "")) {
      relevantIndex = index;
      break;
    }
  }

  if (relevantIndex >= 0) {
    return source.slice(Math.max(0, relevantIndex - 4), Math.min(source.length, relevantIndex + 8)).join("\n");
  }

  return source.slice(-20).join("\n");
}

async function detectVideoEncoder(input: {
  command: string;
  resolution: EditorResolution;
  commandRunner?: CommandRunner;
}): Promise<EditorVideoEncoderSelection> {
  if (input.commandRunner) {
    try {
      const result = await input.commandRunner(input.command, ["-hide_banner", "-encoders"]);
      if (result.code !== 0) {
        return getEditorSoftwareFallbackEncoder(input.resolution);
      }
      return selectEditorVideoEncoderFromFfmpegOutput(`${result.stdout}\n${result.stderr}`, input.resolution);
    } catch (error) {
      if (isEnoentError(error)) {
        throw error;
      }
      return getEditorSoftwareFallbackEncoder(input.resolution);
    }
  }

  const cacheKey = `${input.command}:${input.resolution}`;
  const cached = ENCODER_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const detectionPromise = (async () => {
    try {
      const result = await runCommand(input.command, ["-hide_banner", "-encoders"]);
      if (result.code !== 0) {
        return getEditorSoftwareFallbackEncoder(input.resolution);
      }
      return selectEditorVideoEncoderFromFfmpegOutput(`${result.stdout}\n${result.stderr}`, input.resolution);
    } catch (error) {
      if (isEnoentError(error)) {
        throw error;
      }
      return getEditorSoftwareFallbackEncoder(input.resolution);
    }
  })();

  ENCODER_CACHE.set(cacheKey, detectionPromise);
  return detectionPromise;
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
  overlaySequences?: readonly NodeEditorExportOverlaySequence[];
  overlayInputStartIndex: number;
}): {
  outputLabel: string;
  filterParts: string[];
} {
  const filterParts: string[] = [];
  let currentLabel = input.baseVideoLabel;
  let currentIndexOffset = 0;

  input.overlays.forEach((overlay, index) => {
    const inputIndex = input.overlayInputStartIndex + currentIndexOffset;
    const sourceInputLabel = `overlay_input_${currentIndexOffset}`;
    const croppedInputLabel = overlay.cropExpression ? `overlay_crop_${currentIndexOffset}` : sourceInputLabel;
    const outputLabel = `overlay_${currentIndexOffset}`;
    filterParts.push(`[${inputIndex}:v]setpts=PTS-STARTPTS[${sourceInputLabel}]`);
    if (overlay.cropExpression) {
      filterParts.push(
        `[${sourceInputLabel}]crop=${Math.max(1, Math.round(overlay.width))}:${Math.max(1, Math.round(overlay.height))}:0:'${overlay.cropExpression}'[${croppedInputLabel}]`
      );
    }
    filterParts.push(
      `[${currentLabel}][${croppedInputLabel}]overlay=x=${Math.max(0, Math.round(overlay.x))}:y=${Math.max(0, Math.round(overlay.y))}:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${outputLabel}]`
    );
    currentLabel = outputLabel;
    currentIndexOffset += 1;
  });

  if (input.overlaySequences) {
    input.overlaySequences.forEach((sequence, index) => {
      const inputIndex = input.overlayInputStartIndex + currentIndexOffset;
      const sourceInputLabel = `overlay_seq_input_${index}`;
      const outputLabel = `overlay_seq_${index}`;
      filterParts.push(`[${inputIndex}:v]setpts=PTS-STARTPTS[${sourceInputLabel}]`);
      filterParts.push(
        `[${currentLabel}][${sourceInputLabel}]overlay=x=${Math.max(0, Math.round(sequence.x))}:y=${Math.max(0, Math.round(sequence.y))}:enable='between(t,${sequence.start.toFixed(3)},${sequence.end.toFixed(3)})'[${outputLabel}]`
      );
      currentLabel = outputLabel;
      currentIndexOffset += 1;
    });
  }

  return {
    filterParts,
    outputLabel: currentLabel,
  };
}

export function buildNodeEditorExportCommand(input: {
  project: EditorProjectRecord;
  assets: readonly NodeEditorExportAsset[];
  overlays?: readonly NodeEditorExportOverlay[];
  overlaySequences?: readonly NodeEditorExportOverlaySequence[];
  resolution: EditorResolution;
  outputPath: string;
  overwrite?: boolean;
  subtitleTrackPath?: string | null;
  videoEncoder?: EditorVideoEncoderSelection;
}): {
  width: number;
  height: number;
  durationSeconds: number;
  warnings: string[];
  ffmpegArgs: string[];
  ffmpegCommandPreview: string[];
  notes: string[];
  encoderUsed: string;
  hardwareAccelerated: boolean;
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
  const overlaySequences = input.overlaySequences ?? [];
  const videoEncoder = input.videoEncoder ?? getEditorSoftwareFallbackEncoder(input.resolution);

  let filterComplex = exportPlan.filterComplex;
  let videoTrackLabel = exportPlan.videoTrackLabel;
  if (overlays.length > 0 || overlaySequences.length > 0) {
    const overlayGraph = buildOverlayFilterGraph({
      baseVideoLabel: videoTrackLabel,
      overlays,
      overlaySequences,
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
    ...overlaySequences.flatMap((sequence) => [
      "-framerate",
      String(sequence.fps),
      "-i",
      path.join(sequence.directoryPath, sequence.filenamePattern),
    ]),
    "-filter_complex",
    filterComplex,
    ...mapArgs,
    ...videoEncoder.outputArgs,
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
      overlays.length || overlaySequences.length
        ? `${overlays.length + overlaySequences.length} overlay input${overlays.length + overlaySequences.length === 1 ? "" : "s"} composed before subtitles.`
        : "No overlay inputs.",
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
      videoEncoder.isHardwareAccelerated
        ? `Hardware video encoder selected: ${videoEncoder.encoderUsed}.`
        : `Software video encoder selected: ${videoEncoder.encoderUsed}.`,
    ],
    encoderUsed: videoEncoder.encoderUsed,
    hardwareAccelerated: videoEncoder.isHardwareAccelerated,
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
    overlaySequences: input.overlaySequences,
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
    let accumulatedFfmpegMs = 0;
    let usedEncoder = getEditorSoftwareFallbackEncoder(input.resolution);
    let finalCommand = command;
    if (!input.dryRun) {
      const commandCandidates = [
        "ffmpeg",
        input.ffmpegPath ?? getBundledBinaryPath("ffmpeg"),
      ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

      let result: CommandRunResult | null = null;
      let lastProgressPercent = -1;
      const emitProgress = (processedSeconds: number, durationSeconds = command.durationSeconds) => {
        if (!input.onProgress || durationSeconds <= 0) return;
        const percent = clampNumber((processedSeconds / durationSeconds) * 100, 0, 100);
        if (percent <= lastProgressPercent + 0.25 && percent < 100) return;
        lastProgressPercent = percent;
        input.onProgress({
          percent,
          processedSeconds,
          durationSeconds,
        });
      };

      emitProgress(0);

      for (const commandName of commandCandidates) {
        try {
          const detectedEncoder = await detectVideoEncoder({
            command: commandName,
            resolution: input.resolution,
            commandRunner: input.commandRunner,
          });
          const encoderAttempts =
            detectedEncoder.isHardwareAccelerated && ((input.overlays?.length ?? 0) > 0 || (input.overlaySequences?.length ?? 0) > 0)
              ? [detectedEncoder, getEditorSoftwareFallbackEncoder(input.resolution)]
              : [detectedEncoder];

          for (const [encoderAttemptIndex, videoEncoder] of encoderAttempts.entries()) {
            const builtCommand = buildNodeEditorExportCommand({
              project: input.project,
              assets: input.assets,
              overlays: input.overlays,
              overlaySequences: input.overlaySequences,
              resolution: input.resolution,
              outputPath,
              overwrite: input.overwrite,
              subtitleTrackPath,
              videoEncoder,
            });
            const filterComplexScriptPath = path.join(
              path.dirname(outputPath),
              `${path.parse(outputPath).name}.${videoEncoder.encoderUsed}.filter_complex.txt`
            );
            const preparedCommand = await materializeFilterComplexArgs({
              ffmpegArgs: builtCommand.ffmpegArgs,
              scriptPath: filterComplexScriptPath,
            });
            const ffmpegStartedAt = performance.now();
            const startupStallController = new AbortController();
            const combinedAbort = createCombinedAbortSignal([input.signal, startupStallController.signal]);
            let startupStallTriggered = false;
            const startupStallMonitorId =
              !input.commandRunner && videoEncoder.isHardwareAccelerated && ((input.overlays?.length ?? 0) > 0 || (input.overlaySequences?.length ?? 0) > 0)
                ? setInterval(async () => {
                    let outputBytes = 0;
                    try {
                      const stats = await stat(outputPath);
                      outputBytes = stats.size;
                    } catch {}
                    if (outputBytes > 0) return;
                    const elapsedMs = performance.now() - ffmpegStartedAt;
                    if (elapsedMs < HARDWARE_ENCODER_STARTUP_STALL_MS) return;
                    startupStallTriggered = true;
                    startupStallController.abort();
                  }, HARDWARE_ENCODER_STARTUP_CHECK_INTERVAL_MS)
                : null;

            try {
              if (input.commandRunner) {
                result = await input.commandRunner(commandName, preparedCommand.ffmpegArgs);
              } else {
                try {
                  result = await runCommand(commandName, preparedCommand.ffmpegArgs, {
                    onStderrChunk: (chunk) => {
                      const processedSeconds = parseFfmpegProgressSeconds(chunk);
                      if (processedSeconds != null) {
                        emitProgress(processedSeconds, builtCommand.durationSeconds);
                      }
                    },
                    signal: combinedAbort.signal,
                  });
                } catch (error) {
                  if (startupStallTriggered) {
                    throw createHardwareEncoderStartupStallError(
                      videoEncoder.encoderUsed,
                      performance.now() - ffmpegStartedAt
                    );
                  }
                  throw error;
                }
              }

              accumulatedFfmpegMs += performance.now() - ffmpegStartedAt;
              usedEncoder = videoEncoder;
              result = result ?? null;
              if (result && result.code === 0) {
                finalCommand = builtCommand;
                emitProgress(builtCommand.durationSeconds, builtCommand.durationSeconds);
                break;
              }
              if (
                result &&
                result.code !== 0 &&
                videoEncoder.isHardwareAccelerated &&
                encoderAttemptIndex < encoderAttempts.length - 1
              ) {
                try {
                  await unlink(outputPath);
                } catch {}
                lastProgressPercent = -1;
                continue;
              }
            } catch (error) {
              accumulatedFfmpegMs += performance.now() - ffmpegStartedAt;
              const canFallbackToSoftware =
                videoEncoder.isHardwareAccelerated && encoderAttemptIndex < encoderAttempts.length - 1;
              if (
                canFallbackToSoftware &&
                (isEditorHardwareEncoderStartupStallError(error) ||
                  (error instanceof Error && error.message.startsWith("ffmpeg failed while rendering the timeline.")))
              ) {
                try {
                  await unlink(outputPath);
                } catch {}
                lastProgressPercent = -1;
                continue;
              }
              throw error;
            } finally {
              combinedAbort.dispose();
              if (startupStallMonitorId != null) {
                clearInterval(startupStallMonitorId);
              }
              if (preparedCommand.usedScript) {
                await unlink(filterComplexScriptPath).catch(() => undefined);
              }
            }
          }
          if (result && result.code === 0) {
            break;
          }
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
    }

    const outputStats = input.dryRun ? null : await stat(outputPath);
    if (outputStats && outputStats.size < 1024) {
      throw new Error(`Rendered output is empty: ${outputPath}`);
    }

    return {
      outputPath,
      filename: path.basename(outputPath),
      width: finalCommand.width,
      height: finalCommand.height,
      sizeBytes: outputStats?.size ?? 0,
      durationSeconds: finalCommand.durationSeconds,
      warnings: finalCommand.warnings,
      ffmpegCommandPreview: finalCommand.ffmpegCommandPreview,
      notes: finalCommand.notes,
      encoderUsed: usedEncoder.encoderUsed,
      hardwareAccelerated: usedEncoder.isHardwareAccelerated,
      timingsMs: !input.dryRun
        ? {
            serverFfmpeg: Number(accumulatedFfmpegMs.toFixed(2)),
          }
        : undefined,
      dryRun: Boolean(input.dryRun),
    };
  } finally {
    if (!input.dryRun && subtitleTrackPath) {
      await rm(subtitleTrackPath, { force: true }).catch(() => undefined);
    }
  }
}
