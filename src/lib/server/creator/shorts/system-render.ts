import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { assertExportGeometryInvariants } from "../../../creator/core/export-contracts";
import { buildCreatorShortExportFilename } from "../../../creator/export-output";
import type {
  CreatorShortFfmpegBenchmarkTimingsMs,
  CreatorShortEditorState,
  CreatorShortRasterOverlayKind,
  CreatorSuggestedShort,
} from "../../../creator/types";
import type { CommandRunResult, CommandRunner } from "../../../editor/node-media";
import { getBundledBinaryPath, isEnoentError } from "../../../editor/node-binaries";
import {
  getCreatorSoftwareFallbackEncoder,
  selectCreatorVideoEncoderFromFfmpegOutput,
  type CreatorVideoEncoderSelection,
} from "./encoder-policy";
import type { CreatorShortRenderProgressEventInput } from "./render-progress-store";
import type { CreatorShortSourcePlaybackMode } from "./source-playback-profile";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const FAST_SEEK_CUSHION_SECONDS = 3;
const HARDWARE_ENCODER_STARTUP_STALL_MS = 12_000;
const HARDWARE_ENCODER_STARTUP_CHECK_INTERVAL_MS = 1_000;
const ENCODER_CACHE = new Map<string, Promise<CreatorVideoEncoderSelection>>();

export interface CreatorSystemRenderOverlayInput {
  absolutePath: string;
  filename: string;
  start: number;
  end: number;
  kind?: CreatorShortRasterOverlayKind;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cropExpression?: string;
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
    layoutMode?: "cover_crop" | "zoom_out_pad";
  };
  overlays: readonly CreatorSystemRenderOverlayInput[];
  subtitleBurnedIn: boolean;
  subtitleTrackPath?: string | null;
  sourcePlaybackMode?: CreatorShortSourcePlaybackMode;
  renderModeUsed: "fast_ass" | "png_parity";
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
  onLogEvent?: (event: CreatorShortRenderProgressEventInput) => void;
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
  renderModeUsed: "fast_ass" | "png_parity";
  encoderUsed: string;
  ffmpegDurationMs: number;
  ffmpegBenchmarkMs?: Record<string, CreatorShortFfmpegBenchmarkTimingsMs>;
  ffmpegCommandPreview: string[];
  notes: string[];
  dryRun: boolean;
}

function nowMs() {
  return performance.now();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundMs(value: number) {
  return Number(Math.max(0, value).toFixed(2));
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
  const outTimeUsMatches = [...message.matchAll(/\bout_time_us=(-?\d+)\b/g)];
  if (outTimeUsMatches.length > 0) {
    const value = Number(outTimeUsMatches[outTimeUsMatches.length - 1]?.[1] ?? "");
    if (Number.isFinite(value) && value >= 0) {
      return value / 1_000_000;
    }
  }

  const outTimeMsMatches = [...message.matchAll(/\bout_time_ms=(\d+)\b/g)];
  if (outTimeMsMatches.length > 0) {
    const value = Number(outTimeMsMatches[outTimeMsMatches.length - 1]?.[1] ?? "");
    if (Number.isFinite(value) && value >= 0) {
      return value / 1_000_000;
    }
  }

  const outTimeMatches = [...message.matchAll(/\bout_time=(\d+:\d{2}:\d{2}(?:\.\d+)?)\b/g)];
  if (outTimeMatches.length > 0) {
    return parseFfmpegTimecodeToSeconds(outTimeMatches[outTimeMatches.length - 1]?.[1] ?? "");
  }

  const legacyMatches = [...message.matchAll(/\btime=(\d+:\d{2}:\d{2}(?:\.\d+)?)\b/g)];
  if (legacyMatches.length === 0) return null;
  return parseFfmpegTimecodeToSeconds(legacyMatches[legacyMatches.length - 1]?.[1] ?? "");
}

interface FfmpegProgressSnapshot {
  frame?: number;
  totalSizeBytes?: number;
  speed?: string;
  progressState?: string;
  outTimeSeconds?: number | null;
  outTimeRaw?: string;
  outTimeMsRaw?: number;
  outTimeUsRaw?: number;
}

type CreatorSystemRenderSeekMode = "hybrid" | "exact" | "still_static";

function parseLatestNumericMatch(message: string, expression: RegExp): number | undefined {
  const matches = [...message.matchAll(expression)];
  if (matches.length === 0) return undefined;
  const value = Number(matches[matches.length - 1]?.[1] ?? "");
  return Number.isFinite(value) ? value : undefined;
}

function parseLatestTextMatch(message: string, expression: RegExp): string | undefined {
  const matches = [...message.matchAll(expression)];
  if (matches.length === 0) return undefined;
  const value = matches[matches.length - 1]?.[1];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseFfmpegProgressSnapshot(message: string): FfmpegProgressSnapshot | null {
  const frame = parseLatestNumericMatch(message, /\bframe=(\d+)\b/g);
  const totalSizeBytes = parseLatestNumericMatch(message, /\btotal_size=(-?\d+)\b/g);
  const speed = parseLatestTextMatch(message, /\bspeed=\s*([^\r\n]+)\b/g);
  const progressState = parseLatestTextMatch(message, /\bprogress=([^\r\n]+)\b/g);
  const outTimeUsRaw = parseLatestNumericMatch(message, /\bout_time_us=(-?\d+)\b/g);
  const outTimeMsRaw = parseLatestNumericMatch(message, /\bout_time_ms=(-?\d+)\b/g);
  const outTimeRaw = parseLatestTextMatch(message, /\bout_time=([^\r\n]+)\b/g);
  const outTimeSeconds = parseFfmpegProgressSeconds(message);

  if (
    frame == null &&
    totalSizeBytes == null &&
    speed == null &&
    progressState == null &&
    outTimeUsRaw == null &&
    outTimeMsRaw == null &&
    outTimeRaw == null
  ) {
    return null;
  }

  return {
    frame,
    totalSizeBytes,
    speed,
    progressState,
    outTimeSeconds,
    outTimeRaw,
    outTimeMsRaw,
    outTimeUsRaw,
  };
}

function parseFfmpegBenchmarkMs(stderr: string): Record<string, CreatorShortFfmpegBenchmarkTimingsMs> | undefined {
  const totals = new Map<string, { user: number; system: number; real: number }>();

  for (const match of stderr.matchAll(/bench:\s+(\d+)\s+user\s+(\d+)\s+sys\s+(\d+)\s+real\s+([a-z_]+)/g)) {
    const userUs = Number(match[1]);
    const systemUs = Number(match[2]);
    const realUs = Number(match[3]);
    const task = match[4] ?? "other";
    if (![userUs, systemUs, realUs].every(Number.isFinite)) continue;

    const current = totals.get(task) ?? { user: 0, system: 0, real: 0 };
    current.user += userUs / 1000;
    current.system += systemUs / 1000;
    current.real += realUs / 1000;
    totals.set(task, current);
  }

  if (totals.size === 0) return undefined;

  return Object.fromEntries(
    [...totals.entries()].map(([task, value]) => [
      task,
      {
        user: roundMs(value.user),
        system: roundMs(value.system),
        real: roundMs(value.real),
      },
    ])
  );
}

function createAbortError() {
  const error = new Error("Short export canceled.");
  error.name = "AbortError";
  return error;
}

function createHardwareEncoderStartupStallError(encoderUsed: string, elapsedMs: number) {
  const error = new Error(
    `Hardware encoder ${encoderUsed} produced no output during startup after ${roundMs(elapsedMs)}ms.`
  );
  error.name = "CreatorHardwareEncoderStartupStallError";
  return error;
}

function isCreatorHardwareEncoderStartupStallError(error: unknown) {
  return error instanceof Error && error.name === "CreatorHardwareEncoderStartupStallError";
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

function buildMissingBinaryMessage() {
  return "ffmpeg is required to export shorts. Install project dependencies with npm install or place ffmpeg on PATH.";
}

function getStderrTail(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filtered = lines.filter(
    (line) =>
      !/^(frame=|fps=|stream_|bitrate=|total_size=|out_time|dup_frames=|drop_frames=|speed=|progress=|bench:)/.test(
        line
      )
  );
  const source = filtered.length > 0 ? filtered : lines;
  return source.slice(-8).join("\n");
}

function escapeFilterPath(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'");
}

function buildAssFilterExpression(subtitleTrackPath: string): string {
  return `ass='${escapeFilterPath(subtitleTrackPath)}'`;
}

function getOverlayPlacement(overlay: CreatorSystemRenderOverlayInput) {
  return {
    x: Math.max(0, Math.round(overlay.x ?? 0)),
    y: Math.max(0, Math.round(overlay.y ?? 0)),
  };
}

function getOverlayRasterPixelArea(overlay: Pick<CreatorSystemRenderOverlayInput, "width" | "height">) {
  return Math.max(1, overlay.width ?? OUTPUT_WIDTH) * Math.max(1, overlay.height ?? OUTPUT_HEIGHT);
}

function isBoundedTextOverlay(overlay: CreatorSystemRenderOverlayInput) {
  if (overlay.kind !== "intro_overlay" && overlay.kind !== "outro_overlay") return false;
  return (
    typeof overlay.x === "number" &&
    typeof overlay.y === "number" &&
    typeof overlay.width === "number" &&
    typeof overlay.height === "number"
  );
}

function resolveTextOverlayRenderPath(input: {
  overlays: readonly CreatorSystemRenderOverlayInput[];
  overlaySummary: CreatorSystemRenderInput["overlaySummary"];
}) {
  const textOverlayCount =
    input.overlaySummary.introOverlayFrameCount + input.overlaySummary.outroOverlayFrameCount;
  if (textOverlayCount === 0) return "none";

  const textOverlays = input.overlays.filter(
    (overlay) => overlay.kind === "intro_overlay" || overlay.kind === "outro_overlay"
  );
  if (textOverlays.length === 0 || textOverlays.length < textOverlayCount) return "fullscreen_png_legacy";
  return textOverlays.every(isBoundedTextOverlay) ? "bounded_png" : "fullscreen_png_legacy";
}

function buildOverlayFilterGraph(input: {
  baseInputLabel?: string;
  baseFilter: string;
  overlays: readonly CreatorSystemRenderOverlayInput[];
  subtitleTrackPath?: string | null;
  overlayInputStartIndex?: number;
}): {
  filterComplex: string;
  outputLabel: string;
} {
  const baseInputLabel = input.baseInputLabel ?? "0:v";
  const overlayInputStartIndex = input.overlayInputStartIndex ?? 1;
  const filterParts: string[] = [`[${baseInputLabel}]setpts=PTS-STARTPTS,${input.baseFilter}[base]`];
  let currentLabel = "base";

  input.overlays.forEach((overlay, index) => {
    const inputLabel = `${overlayInputStartIndex + index}:v`;
    const normalizedOverlayInputLabel = `overlay_input_${index}`;
    const overlayInputLabel = overlay.cropExpression ? `overlay_crop_${index}` : normalizedOverlayInputLabel;
    const outLabel = `overlay_${index}`;
    const placement = getOverlayPlacement(overlay);

    filterParts.push(`[${inputLabel}]setpts=PTS-STARTPTS[${normalizedOverlayInputLabel}]`);

    if (overlay.cropExpression) {
      filterParts.push(
        `[${normalizedOverlayInputLabel}]crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:0:'${overlay.cropExpression}'[${overlayInputLabel}]`
      );
    }

    filterParts.push(
      `[${currentLabel}][${overlayInputLabel}]overlay=x=${placement.x}:y=${placement.y}:enable='between(t,${overlay.start.toFixed(3)},${overlay.end.toFixed(3)})'[${outLabel}]`
    );
    currentLabel = outLabel;
  });

  if (input.subtitleTrackPath) {
    filterParts.push(`[${currentLabel}]${buildAssFilterExpression(input.subtitleTrackPath)}[vout]`);
    currentLabel = "vout";
  }

  return {
    filterComplex: filterParts.join(";"),
    outputLabel: currentLabel,
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

async function detectVideoEncoder(command: string): Promise<CreatorVideoEncoderSelection> {
  const cached = ENCODER_CACHE.get(command);
  if (cached) {
    return cached;
  }

  const detectionPromise = (async () => {
    try {
      const result = await runCommand(command, ["-hide_banner", "-encoders"]);
      if (result.code !== 0) {
        return getCreatorSoftwareFallbackEncoder();
      }
      return selectCreatorVideoEncoderFromFfmpegOutput(`${result.stdout}\n${result.stderr}`);
    } catch (error) {
      if (isEnoentError(error)) {
        throw error;
      }
      return getCreatorSoftwareFallbackEncoder();
    }
  })();

  ENCODER_CACHE.set(command, detectionPromise);
  return detectionPromise;
}

export function isCreatorSystemRenderCanceledError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function describeFfmpegProgressSnapshot(snapshot: FfmpegProgressSnapshot | null, outputBytes?: number | null) {
  if (!snapshot) {
    return `no parseable progress yet; output=${Math.max(0, outputBytes ?? 0)}B`;
  }

  const parts: string[] = [];
  if (typeof snapshot.frame === "number") {
    parts.push(`frame=${snapshot.frame}`);
  }
  if (typeof snapshot.totalSizeBytes === "number") {
    parts.push(`muxed=${Math.max(0, snapshot.totalSizeBytes)}B`);
  }
  if (typeof outputBytes === "number") {
    parts.push(`output=${Math.max(0, outputBytes)}B`);
  }
  if (typeof snapshot.outTimeSeconds === "number") {
    parts.push(`out_time=${snapshot.outTimeSeconds.toFixed(2)}s`);
  } else if (typeof snapshot.outTimeRaw === "string") {
    parts.push(`out_time_raw=${snapshot.outTimeRaw}`);
  } else if (typeof snapshot.outTimeMsRaw === "number") {
    parts.push(`out_time_ms_raw=${snapshot.outTimeMsRaw}`);
  } else if (typeof snapshot.outTimeUsRaw === "number") {
    parts.push(`out_time_us_raw=${snapshot.outTimeUsRaw}`);
  }
  if (typeof snapshot.speed === "string") {
    parts.push(`speed=${snapshot.speed}`);
  }
  if (typeof snapshot.progressState === "string") {
    parts.push(`state=${snapshot.progressState}`);
  }

  return parts.length > 0 ? parts.join(", ") : `output=${Math.max(0, outputBytes ?? 0)}B`;
}

function hasMeaningfulFfmpegStartupProgress(input: {
  snapshot: FfmpegProgressSnapshot | null;
  outputBytes?: number | null;
}) {
  if ((input.outputBytes ?? 0) > 0) return true;
  if (!input.snapshot) return false;
  if ((input.snapshot.totalSizeBytes ?? 0) > 0) return true;
  if ((input.snapshot.frame ?? 0) > 0) return true;
  if ((input.snapshot.outTimeSeconds ?? 0) > 0) return true;
  if (input.snapshot.progressState === "end") return true;
  return false;
}

export function buildCreatorSystemRenderCommand(input: {
  sourceFilePath: string;
  short: CreatorSuggestedShort;
  sourceVideoSize: { width: number; height: number };
  geometry: CreatorSystemRenderInput["geometry"];
  overlays: readonly CreatorSystemRenderOverlayInput[];
  subtitleBurnedIn: boolean;
  subtitleTrackPath?: string | null;
  sourcePlaybackMode?: CreatorShortSourcePlaybackMode;
  renderModeUsed: "fast_ass" | "png_parity";
  overlaySummary: CreatorSystemRenderInput["overlaySummary"];
  outputPath: string;
  overwrite?: boolean;
  seekMode: CreatorSystemRenderSeekMode;
  videoEncoder: CreatorVideoEncoderSelection;
}): {
  ffmpegArgs: string[];
  ffmpegCommandPreview: string[];
  notes: string[];
  durationSeconds: number;
  encoderUsed: string;
} {
  const clipDuration = Math.max(0.5, input.short.endSeconds - input.short.startSeconds);
  const isStillSourcePlayback = input.sourcePlaybackMode === "still";
  const inputSeekSeconds = Math.max(0, input.short.startSeconds - FAST_SEEK_CUSHION_SECONDS);
  const exactTrimAfterSeekSeconds = Math.max(0, input.short.startSeconds - inputSeekSeconds);
  const preInputSeek = input.seekMode === "hybrid" ? ["-ss", String(inputSeekSeconds)] : [];
  const postInputSeekSeconds =
    input.seekMode === "hybrid" ? exactTrimAfterSeekSeconds : input.short.startSeconds;
  const overlayInputArgs = input.overlays.flatMap((overlay) => ["-loop", "1", "-i", overlay.absolutePath]);
  const filterArgs = isStillSourcePlayback
    ? (() => {
        const stillBaseFilter = `${input.geometry.filter},format=yuv420p,tpad=stop_mode=clone:stop_duration=${clipDuration.toFixed(3)}`;
        const filterGraph = buildOverlayFilterGraph({
          baseInputLabel: "0:v",
          baseFilter: stillBaseFilter,
          overlays: input.overlays,
          subtitleTrackPath: input.subtitleTrackPath,
          overlayInputStartIndex: 2,
        });
        return ["-filter_complex", filterGraph.filterComplex, "-map", `[${filterGraph.outputLabel}]`, "-map", "1:a?"];
      })()
    : input.overlays.length > 0
      ? (() => {
          const filterGraph = buildOverlayFilterGraph({
            baseFilter: input.geometry.filter,
            overlays: input.overlays,
            subtitleTrackPath: input.subtitleTrackPath,
          });
          return ["-filter_complex", filterGraph.filterComplex, "-map", `[${filterGraph.outputLabel}]`, "-map", "0:a?"];
        })()
      : (() => {
          const videoFilter = input.subtitleTrackPath
            ? `${input.geometry.filter},${buildAssFilterExpression(input.subtitleTrackPath)}`
            : input.geometry.filter;
          return ["-vf", videoFilter, "-map", "0:v", "-map", "0:a?"];
        })();

  const ffmpegArgs = isStillSourcePlayback
    ? [
        "-hide_banner",
        "-nostdin",
        "-v",
        "info",
        "-stats_period",
        "0.5",
        "-progress",
        "pipe:2",
        "-benchmark_all",
        input.overwrite ? "-y" : "-n",
        "-i",
        input.sourceFilePath,
        "-ss",
        String(input.short.startSeconds),
        "-i",
        input.sourceFilePath,
        ...overlayInputArgs,
        "-t",
        String(clipDuration),
        ...filterArgs,
        ...input.videoEncoder.outputArgs,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        input.outputPath,
      ]
    : [
        "-hide_banner",
        "-nostdin",
        "-v",
        "info",
        "-stats_period",
        "0.5",
        "-progress",
        "pipe:2",
        "-benchmark_all",
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
        ...input.videoEncoder.outputArgs,
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
  const overlayRasterPixelArea = input.overlays.reduce(
    (total, overlay) => total + getOverlayRasterPixelArea(overlay),
    0
  );
  const overlayRasterAreaPct = roundMs((overlayRasterPixelArea / (OUTPUT_WIDTH * OUTPUT_HEIGHT)) * 100);
  const textOverlayRenderPath = resolveTextOverlayRenderPath({
    overlays: input.overlays,
    overlaySummary: input.overlaySummary,
  });

  return {
    ffmpegArgs,
    ffmpegCommandPreview: ["ffmpeg", ...ffmpegArgs],
    durationSeconds: clipDuration,
    encoderUsed: input.videoEncoder.encoderUsed,
    notes: [
      "System short export via native ffmpeg.",
      `Render mode: ${input.renderModeUsed}.`,
      `Video encoder: ${input.videoEncoder.encoderUsed}${input.videoEncoder.isHardwareAccelerated ? " (hardware accelerated)" : ""}.`,
      isStillSourcePlayback
        ? "Source playback profile: still-video compatibility path using a static video frame plus independently seeked audio."
        : "Source playback profile: normal timed video playback.",
      `Geometry contract checks passed (scaleDelta=${geometryCheck.metrics.scaleDeltaPct.toFixed(4)}%, aspectDelta=${geometryCheck.metrics.aspectRatioDeltaPct.toFixed(4)}%).`,
      input.seekMode === "still_static"
        ? `Static-video mode enabled: reused the first video frame for ${clipDuration.toFixed(2)}s and seeked audio from ${input.short.startSeconds.toFixed(2)}s.`
        : input.seekMode === "hybrid"
        ? inputSeekSeconds > 0
          ? `Hybrid trim seek enabled: fast pre-seek ${inputSeekSeconds.toFixed(2)}s, exact post-seek ${exactTrimAfterSeekSeconds.toFixed(2)}s.`
          : `Exact trim seek from start: ${exactTrimAfterSeekSeconds.toFixed(2)}s.`
        : `Fallback exact-seek mode used from ${input.short.startSeconds.toFixed(2)}s for container compatibility.`,
      input.geometry.canvasWidth !== input.geometry.scaledWidth || input.geometry.canvasHeight !== input.geometry.scaledHeight
        ? `Geometry mode ${input.geometry.layoutMode ?? "zoom_out_pad"}: scaled frame ${input.geometry.scaledWidth}x${input.geometry.scaledHeight}, padded canvas ${input.geometry.canvasWidth}x${input.geometry.canvasHeight} @ (${input.geometry.padX}, ${input.geometry.padY}), crop @ (${input.geometry.cropX}, ${input.geometry.cropY}).`
        : `Geometry mode ${input.geometry.layoutMode ?? "cover_crop"}: scaled frame ${input.geometry.scaledWidth}x${input.geometry.scaledHeight}, crop @ (${input.geometry.cropX}, ${input.geometry.cropY}).`,
      input.subtitleBurnedIn
        ? input.renderModeUsed === "fast_ass"
          ? "Subtitles burned in via ASS fast path."
          : `Subtitles burned in across ${input.overlaySummary.subtitleFrameCount} PNG frame${input.overlaySummary.subtitleFrameCount === 1 ? "" : "s"}.`
        : "Rendered without burned subtitles.",
      input.overlaySummary.introOverlayFrameCount > 0 ? "Intro title overlay enabled." : "Intro title overlay disabled.",
      input.overlaySummary.outroOverlayFrameCount > 0 ? "Outro card overlay enabled." : "Outro card overlay disabled.",
      `Text overlay render path: ${textOverlayRenderPath}.`,
      input.overlays.length > 0
        ? `Overlay raster area total: ${overlayRasterPixelArea}px (${overlayRasterAreaPct}% of one 1080x1920 frame).`
        : "Overlay raster area total: 0px (0% of one 1080x1920 frame).",
      `Overlay slot counts: intro=${input.overlaySummary.introOverlayFrameCount}, outro=${input.overlaySummary.outroOverlayFrameCount}, subtitle_png=${input.overlaySummary.subtitleFrameCount}.`,
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
  const commandCandidates = ["ffmpeg", input.ffmpegPath ?? getBundledBinaryPath("ffmpeg")].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index
  );

  let accumulatedFfmpegMs = 0;
  const fallbackNotes: string[] = [];

  const runCommandForSeekMode = async (seekMode: CreatorSystemRenderSeekMode) => {
    let result: CommandRunResult | null = null;
    let builtCommand:
      | ReturnType<typeof buildCreatorSystemRenderCommand>
      | null = null;
    let ffmpegBenchmarkMs: Record<string, CreatorShortFfmpegBenchmarkTimingsMs> | undefined;
    let lastProgressPercent = -1;

    const emitProgress = (processedSeconds: number, durationSeconds: number) => {
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

    emitProgress(0, Math.max(0.5, input.short.endSeconds - input.short.startSeconds));

    for (const commandName of commandCandidates) {
      try {
        let encoderAttempts: CreatorVideoEncoderSelection[];
        if (input.sourcePlaybackMode === "still") {
          encoderAttempts = [getCreatorSoftwareFallbackEncoder()];
        } else {
          const detectedEncoder = await detectVideoEncoder(commandName);
          encoderAttempts =
            detectedEncoder.isHardwareAccelerated && input.overlays.length > 0
              ? [detectedEncoder, getCreatorSoftwareFallbackEncoder()]
              : [detectedEncoder];
        }

        for (const [encoderAttemptIndex, videoEncoder] of encoderAttempts.entries()) {
          let attemptProgressBuffer = "";
          let attemptLastProgressSnapshot: FfmpegProgressSnapshot | null = null;
          builtCommand = buildCreatorSystemRenderCommand({
            sourceFilePath: input.sourceFilePath,
            short: input.short,
            sourceVideoSize: input.sourceVideoSize,
            geometry: input.geometry,
            overlays: input.overlays,
            subtitleBurnedIn: input.subtitleBurnedIn,
            subtitleTrackPath: input.subtitleTrackPath,
            sourcePlaybackMode: input.sourcePlaybackMode,
            renderModeUsed: input.renderModeUsed,
            overlaySummary: input.overlaySummary,
            outputPath,
            overwrite: input.overwrite,
            seekMode,
            videoEncoder,
          });
          input.onLogEvent?.({
            stage: "ffmpeg",
            message: `FFmpeg start: encoder=${builtCommand.encoderUsed}, seekMode=${seekMode}, overlays=${input.overlays.length}, renderMode=${input.renderModeUsed}.`,
          });

          const ffmpegStartedAt = nowMs();
          const heartbeatTimerId = input.onLogEvent
            ? setInterval(async () => {
                let outputBytes: number | null = null;
                try {
                  const stats = await stat(outputPath);
                  outputBytes = stats.size;
                } catch {}
                input.onLogEvent?.({
                  stage: "ffmpeg",
                  message: `FFmpeg heartbeat after ${roundMs(nowMs() - ffmpegStartedAt)}ms: ${describeFfmpegProgressSnapshot(attemptLastProgressSnapshot, outputBytes)}.`,
                  progressPct:
                    typeof attemptLastProgressSnapshot?.outTimeSeconds === "number" && builtCommand
                      ? roundMs(
                          clampNumber(
                            (attemptLastProgressSnapshot.outTimeSeconds / builtCommand.durationSeconds) * 100,
                            0,
                            100
                          )
                        )
                      : undefined,
                  processedSeconds:
                    typeof attemptLastProgressSnapshot?.outTimeSeconds === "number"
                      ? roundMs(attemptLastProgressSnapshot.outTimeSeconds)
                      : undefined,
                  durationSeconds: builtCommand?.durationSeconds,
                });
              }, 4_000)
            : null;
          const startupStallController = new AbortController();
          const combinedAbort = createCombinedAbortSignal([input.signal, startupStallController.signal]);
          let startupStallTriggered = false;
          const startupStallMonitorId =
            !input.commandRunner &&
            input.sourcePlaybackMode !== "still" &&
            videoEncoder.isHardwareAccelerated &&
            input.overlays.length > 0
              ? setInterval(async () => {
                  let outputBytes = 0;
                  try {
                    const stats = await stat(outputPath);
                    outputBytes = stats.size;
                  } catch {}
                  if (
                    hasMeaningfulFfmpegStartupProgress({
                      snapshot: attemptLastProgressSnapshot,
                      outputBytes,
                    })
                  ) {
                    return;
                  }
                  const elapsedMs = nowMs() - ffmpegStartedAt;
                  if (elapsedMs < HARDWARE_ENCODER_STARTUP_STALL_MS) {
                    return;
                  }
                  startupStallTriggered = true;
                  input.onLogEvent?.({
                    stage: "ffmpeg",
                    message: `Hardware encoder startup stall detected after ${roundMs(elapsedMs)}ms with overlays; retrying with software encoder.`,
                  });
                  startupStallController.abort();
                }, HARDWARE_ENCODER_STARTUP_CHECK_INTERVAL_MS)
              : null;

          try {
            if (input.commandRunner) {
              result = await input.commandRunner(commandName, builtCommand.ffmpegArgs);
            } else {
              try {
                result = await runCommand(commandName, builtCommand.ffmpegArgs, {
                  onStderrChunk: (chunk) => {
                    attemptProgressBuffer += chunk;
                    if (attemptProgressBuffer.length > 32_768) {
                      attemptProgressBuffer = attemptProgressBuffer.slice(-16_384);
                    }
                    attemptLastProgressSnapshot = parseFfmpegProgressSnapshot(attemptProgressBuffer);
                    const processedSeconds = attemptLastProgressSnapshot?.outTimeSeconds ?? null;
                    if (processedSeconds != null) {
                      emitProgress(processedSeconds, builtCommand?.durationSeconds ?? 0);
                    }
                  },
                  signal: combinedAbort.signal,
                });
              } catch (error) {
                if (startupStallTriggered) {
                  throw createHardwareEncoderStartupStallError(videoEncoder.encoderUsed, nowMs() - ffmpegStartedAt);
                }
                throw error;
              }
            }

            accumulatedFfmpegMs += nowMs() - ffmpegStartedAt;
            ffmpegBenchmarkMs = parseFfmpegBenchmarkMs(result.stderr);
            input.onLogEvent?.({
              stage: "ffmpeg",
              message: `FFmpeg pass finished in ${roundMs(nowMs() - ffmpegStartedAt)}ms.`,
              progressPct: 100,
            });
            break;
          } catch (error) {
            accumulatedFfmpegMs += nowMs() - ffmpegStartedAt;
            const canFallbackToSoftware =
              videoEncoder.isHardwareAccelerated && encoderAttemptIndex < encoderAttempts.length - 1;

            if (
              canFallbackToSoftware &&
              (isCreatorHardwareEncoderStartupStallError(error) ||
                (error instanceof Error && error.message.startsWith("ffmpeg failed while rendering the short.")))
            ) {
              const fallbackMessage = isCreatorHardwareEncoderStartupStallError(error)
                ? `Retrying with software encoder after hardware startup stall (${videoEncoder.encoderUsed}).`
                : `Retrying with software encoder after hardware encoder failure (${videoEncoder.encoderUsed}).`;
              fallbackNotes.push(fallbackMessage);
              input.onLogEvent?.({
                stage: "ffmpeg",
                message: fallbackMessage,
              });
              try {
                await unlink(outputPath);
              } catch {}
              lastProgressPercent = -1;
              continue;
            }

            throw error;
          } finally {
            combinedAbort.dispose();
            if (heartbeatTimerId != null) {
              clearInterval(heartbeatTimerId);
            }
            if (startupStallMonitorId != null) {
              clearInterval(startupStallMonitorId);
            }
          }
        }

        if (result) {
          break;
        }
      } catch (error) {
        if (isEnoentError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!result || !builtCommand) {
      if (input.signal?.aborted) {
        throw createAbortError();
      }
      throw new Error(buildMissingBinaryMessage());
    }
    if (result.code !== 0) {
      const detail = getStderrTail(result.stderr) || result.stdout.trim() || "Unknown ffmpeg failure.";
      throw new Error(`ffmpeg failed while rendering the short.\n${detail}`);
    }

    emitProgress(builtCommand.durationSeconds, builtCommand.durationSeconds);
    return {
      command: builtCommand,
      ffmpegBenchmarkMs,
    };
  };

  let commandResult;
  if (input.sourcePlaybackMode === "still") {
    commandResult = await runCommandForSeekMode("still_static");
  } else {
    try {
      commandResult = await runCommandForSeekMode("hybrid");
    } catch (error) {
      if (isCreatorSystemRenderCanceledError(error) || isEnoentError(error)) {
        throw error;
      }
      input.onLogEvent?.({
        stage: "ffmpeg",
        message: "Hybrid-seek FFmpeg pass failed; retrying with exact seek.",
      });
      try {
        await unlink(outputPath);
      } catch {}
      commandResult = await runCommandForSeekMode("exact");
    }
  }

  const outputStats = input.dryRun ? null : await stat(outputPath);
  if (outputStats && outputStats.size < 1024) {
    throw new Error(`Rendered output is empty: ${outputPath}`);
  }

  const notes = [...commandResult.command.notes];
  notes.push(...fallbackNotes);
  if (commandResult.ffmpegBenchmarkMs) {
    notes.push(
      `FFmpeg benchmark tasks captured: ${Object.keys(commandResult.ffmpegBenchmarkMs)
        .sort()
        .join(", ")}.`
    );
  }

  return {
    outputPath,
    filename: buildCreatorShortExportFilename(input.sourceFilename, input.short),
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    sizeBytes: outputStats?.size ?? 0,
    durationSeconds: commandResult.command.durationSeconds,
    subtitleBurnedIn: input.subtitleBurnedIn,
    renderModeUsed: input.renderModeUsed,
    encoderUsed: commandResult.command.encoderUsed,
    ffmpegDurationMs: roundMs(accumulatedFfmpegMs),
    ffmpegBenchmarkMs: commandResult.ffmpegBenchmarkMs,
    ffmpegCommandPreview: commandResult.command.ffmpegCommandPreview,
    notes,
    dryRun: Boolean(input.dryRun),
  };
}
