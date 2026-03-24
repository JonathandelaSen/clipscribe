import { spawn } from "node:child_process";
import { access, mkdir, stat, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { assertExportGeometryInvariants } from "../../../creator/core/export-contracts";
import { buildCreatorShortExportFilename } from "../../../creator/export-output";
import type {
  CreatorShortEditorState,
  CreatorSuggestedShort,
} from "../../../creator/types";
import type { CommandRunResult, CommandRunner } from "../../../editor/node-media";
import { getBundledBinaryPath, isEnoentError } from "../../../editor/node-binaries";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const FAST_SEEK_CUSHION_SECONDS = 3;

export interface CreatorSystemRenderOverlayInput {
  absolutePath: string;
  filename: string;
  start: number;
  end: number;
}

export interface CreatorSystemRenderInput {
  sourceFilePath: string;
  sourceFilename: string;
  short: CreatorSuggestedShort;
  editor: CreatorShortEditorState;
  sourceVideoSize: { width: number; height: number };
  geometry: {
    filter: string;
    cropX: number;
    cropY: number;
    scaledWidth: number;
    scaledHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    padX: number;
    padY: number;
    outputWidth: number;
    outputHeight: number;
    usedPreviewVideoRect: boolean;
  };
  previewViewport?: { width: number; height: number } | null;
  previewVideoRect?: { width: number; height: number } | null;
  overlays: readonly CreatorSystemRenderOverlayInput[];
  subtitleBurnedIn: boolean;
  overlaySummary: {
    subtitleFrameCount: number;
    introOverlayFrameCount: number;
    outroOverlayFrameCount: number;
  };
  outputPath: string;
  overwrite?: boolean;
  dryRun?: boolean;
  commandRunner?: CommandRunner;
  ffmpegPath?: string | null;
  onProgress?: (progress: CreatorSystemRenderProgress) => void;
  signal?: AbortSignal;
}

export interface CreatorSystemRenderProgress {
  percent: number;
  processedSeconds: number;
  durationSeconds: number;
}

export interface CreatorSystemRenderResult {
  outputPath: string;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  subtitleBurnedIn: boolean;
  ffmpegCommandPreview: string[];
  notes: string[];
  dryRun: boolean;
}

function clampNumber(value: number, min: number, max: number) {
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
  const error = new Error("Short export canceled.");
  error.name = "AbortError";
  return error;
}

function buildMissingBinaryMessage() {
  return "ffmpeg is required to export shorts. Install project dependencies with npm install or place ffmpeg on PATH.";
}

function getStderrTail(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-8).join("\n");
}

function buildOverlayFilter(
  baseFilter: string,
  overlays: readonly CreatorSystemRenderOverlayInput[]
): string {
  if (overlays.length === 0) return baseFilter;

  const filterParts: string[] = [`[0:v]${baseFilter}[base]`];
  overlays.forEach((overlay, index) => {
    const inLabel = index === 0 ? "base" : `v${index - 1}`;
    const outLabel = index === overlays.length - 1 ? "vout" : `v${index}`;
    filterParts.push(
      `[${inLabel}][${index + 1}:v]overlay=enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${outLabel}]`
    );
  });
  return filterParts.join(";");
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

export function isCreatorSystemRenderCanceledError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function buildCreatorSystemRenderCommand(input: {
  sourceFilePath: string;
  short: CreatorSuggestedShort;
  sourceVideoSize: { width: number; height: number };
  geometry: CreatorSystemRenderInput["geometry"];
  previewViewport?: { width: number; height: number } | null;
  previewVideoRect?: { width: number; height: number } | null;
  overlays: readonly CreatorSystemRenderOverlayInput[];
  subtitleBurnedIn: boolean;
  overlaySummary: CreatorSystemRenderInput["overlaySummary"];
  outputPath: string;
  overwrite?: boolean;
  seekMode: "hybrid" | "exact";
}): {
  ffmpegArgs: string[];
  ffmpegCommandPreview: string[];
  notes: string[];
  durationSeconds: number;
} {
  const clipDuration = Math.max(0.5, input.short.endSeconds - input.short.startSeconds);
  const inputSeekSeconds = Math.max(0, input.short.startSeconds - FAST_SEEK_CUSHION_SECONDS);
  const exactTrimAfterSeekSeconds = Math.max(0, input.short.startSeconds - inputSeekSeconds);
  const preInputSeek = input.seekMode === "hybrid" ? ["-ss", String(inputSeekSeconds)] : [];
  const postInputSeekSeconds =
    input.seekMode === "hybrid" ? exactTrimAfterSeekSeconds : input.short.startSeconds;
  const overlayInputArgs = input.overlays.flatMap((overlay) => ["-loop", "1", "-i", overlay.absolutePath]);
  const overlayFilter = buildOverlayFilter(input.geometry.filter, input.overlays);
  const filterArgs =
    input.overlays.length > 0
      ? ["-filter_complex", overlayFilter, "-map", "[vout]", "-map", "0:a?"]
      : ["-vf", input.geometry.filter, "-map", "0:v", "-map", "0:a?"];

  const ffmpegArgs = [
    input.overwrite ? "-y" : "-n",
    ...preInputSeek,
    "-i",
    input.sourceFilePath,
    ...overlayInputArgs,
    "-ss",
    String(postInputSeekSeconds),
    "-t",
    String(clipDuration),
    ...filterArgs,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];

  const geometryCheck = assertExportGeometryInvariants(
    {
      sourceWidth: input.sourceVideoSize.width,
      sourceHeight: input.sourceVideoSize.height,
      geometry: input.geometry,
      expectedOutputWidth: OUTPUT_WIDTH,
      expectedOutputHeight: OUTPUT_HEIGHT,
    },
    { contextLabel: "system-export-node" }
  );

  return {
    ffmpegArgs,
    ffmpegCommandPreview: ["ffmpeg", ...ffmpegArgs],
    durationSeconds: clipDuration,
    notes: [
      "System short export via native ffmpeg.",
      `Geometry contract checks passed (scaleDelta=${geometryCheck.metrics.scaleDeltaPct.toFixed(4)}%, aspectDelta=${geometryCheck.metrics.aspectRatioDeltaPct.toFixed(4)}%).`,
      input.seekMode === "hybrid"
        ? inputSeekSeconds > 0
          ? `Hybrid trim seek enabled: fast pre-seek ${inputSeekSeconds.toFixed(2)}s, exact post-seek ${exactTrimAfterSeekSeconds.toFixed(2)}s.`
          : `Exact trim seek from start: ${exactTrimAfterSeekSeconds.toFixed(2)}s.`
        : `Fallback exact-seek mode used from ${input.short.startSeconds.toFixed(2)}s for container compatibility.`,
      input.geometry.canvasWidth !== input.geometry.scaledWidth || input.geometry.canvasHeight !== input.geometry.scaledHeight
        ? `Zoom-out/pad mode. Scaled frame ${input.geometry.scaledWidth}x${input.geometry.scaledHeight}, padded canvas ${input.geometry.canvasWidth}x${input.geometry.canvasHeight} @ (${input.geometry.padX}, ${input.geometry.padY}), crop @ (${input.geometry.cropX}, ${input.geometry.cropY}).`
        : `Crop based on zoom/pan. Scaled frame ${input.geometry.scaledWidth}x${input.geometry.scaledHeight}, crop @ (${input.geometry.cropX}, ${input.geometry.cropY}).`,
      input.previewVideoRect
        ? `Preview parity source: video rect ${Math.round(input.previewVideoRect.width)}x${Math.round(input.previewVideoRect.height)} inside viewport ${Math.round(input.previewViewport?.width ?? 0)}x${Math.round(input.previewViewport?.height ?? 0)}.`
        : "Preview parity source: computed from source dimensions + editor zoom.",
      input.subtitleBurnedIn
        ? `Subtitles burned in across ${input.overlaySummary.subtitleFrameCount} PNG frame${input.overlaySummary.subtitleFrameCount === 1 ? "" : "s"}.`
        : "Rendered without burned subtitles.",
      input.overlaySummary.introOverlayFrameCount > 0
        ? "Intro title overlay enabled."
        : "Intro title overlay disabled.",
      input.overlaySummary.outroOverlayFrameCount > 0
        ? "Outro card overlay enabled."
        : "Outro card overlay disabled.",
      input.overlays.length > 0
        ? `${input.overlays.length} overlay PNG input${input.overlays.length === 1 ? "" : "s"} composed in the final pass.`
        : "No PNG overlays required for this export.",
    ],
  };
}

export async function exportCreatorShortWithSystemFfmpeg(
  input: CreatorSystemRenderInput
): Promise<CreatorSystemRenderResult> {
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

  await mkdir(path.dirname(outputPath), { recursive: true });
  const commandCandidates = [
    "ffmpeg",
    input.ffmpegPath ?? getBundledBinaryPath("ffmpeg"),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  const runCommandForSeekMode = async (seekMode: "hybrid" | "exact") => {
    const command = buildCreatorSystemRenderCommand({
      sourceFilePath: input.sourceFilePath,
      short: input.short,
      sourceVideoSize: input.sourceVideoSize,
      geometry: input.geometry,
      previewViewport: input.previewViewport,
      previewVideoRect: input.previewVideoRect,
      overlays: input.overlays,
      subtitleBurnedIn: input.subtitleBurnedIn,
      overlaySummary: input.overlaySummary,
      outputPath,
      overwrite: input.overwrite,
      seekMode,
    });

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
      throw new Error(buildMissingBinaryMessage());
    }
    if (result.code !== 0) {
      const detail = getStderrTail(result.stderr) || result.stdout.trim() || "Unknown ffmpeg failure.";
      throw new Error(`ffmpeg failed while rendering the short.\n${detail}`);
    }

    emitProgress(command.durationSeconds);
    return command;
  };

  let usedSeekMode: "hybrid" | "exact" = "hybrid";
  let command;
  try {
    command = await runCommandForSeekMode("hybrid");
  } catch (error) {
    if (isCreatorSystemRenderCanceledError(error) || isEnoentError(error)) {
      throw error;
    }
    usedSeekMode = "exact";
    try {
      await unlink(outputPath);
    } catch {}
    command = await runCommandForSeekMode("exact");
  }

  const outputStats = input.dryRun ? null : await stat(outputPath);
  if (outputStats && outputStats.size < 1024) {
    throw new Error(`Rendered output is empty: ${outputPath}`);
  }

  return {
    outputPath,
    filename: buildCreatorShortExportFilename(input.sourceFilename, input.short),
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    sizeBytes: outputStats?.size ?? 0,
    durationSeconds: command.durationSeconds,
    subtitleBurnedIn: input.subtitleBurnedIn,
    ffmpegCommandPreview: command.ffmpegCommandPreview,
    notes: usedSeekMode === "exact" ? command.notes : command.notes,
    dryRun: Boolean(input.dryRun),
  };
}
