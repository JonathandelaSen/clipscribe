import {
  createBrowserRenderCanceledError,
  isBrowserRenderCanceledError,
  type BrowserRenderLifecycle,
} from "../browser-render";
import type { EditorResolution } from "./types";

type TimerHandle = ReturnType<typeof setInterval>;

type EditorFfmpegRunner = {
  exec(args: string[], timeout?: number, options?: { signal?: AbortSignal }): Promise<number>;
};

export type EditorFfmpegTimeoutMode = "none" | "stall";

export interface EditorFfmpegActivityWatchdog {
  readonly didStall: boolean;
  readonly stallTimeoutMs: number;
  start(): void;
  markActivity(): void;
  stop(): void;
}

export function createEditorFfmpegActivityWatchdog(input: {
  stallTimeoutMs: number;
  onStall?: () => void | Promise<void>;
  pollIntervalMs?: number;
  now?: () => number;
  setIntervalFn?: (callback: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
}): EditorFfmpegActivityWatchdog {
  const now = input.now ?? Date.now;
  const pollIntervalMs = input.pollIntervalMs ?? 1_000;
  const setIntervalFn = input.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
  const clearIntervalFn = input.clearIntervalFn ?? ((handle) => clearInterval(handle));

  let intervalHandle: TimerHandle | null = null;
  let lastActivityAt = now();
  let stalled = false;

  const stop = () => {
    if (intervalHandle == null) return;
    clearIntervalFn(intervalHandle);
    intervalHandle = null;
  };

  const triggerStall = () => {
    if (stalled) return;
    stalled = true;
    stop();
    void input.onStall?.();
  };

  return {
    get didStall() {
      return stalled;
    },
    stallTimeoutMs: input.stallTimeoutMs,
    start() {
      stalled = false;
      lastActivityAt = now();
      if (intervalHandle != null) return;
      intervalHandle = setIntervalFn(() => {
        if (now() - lastActivityAt >= input.stallTimeoutMs) {
          triggerStall();
        }
      }, pollIntervalMs);
    },
    markActivity() {
      if (stalled) return;
      lastActivityAt = now();
    },
    stop,
  };
}

export interface EditorFfmpegExecInput {
  ff: EditorFfmpegRunner;
  args: string[];
  resolution: EditorResolution;
  clipCount: number;
  durationSeconds: number;
  logTail: string[];
  logHighlights?: string[];
  audioItemCount?: number;
  subtitleFrameCount?: number;
  activityWatchdog?: EditorFfmpegActivityWatchdog;
  resetFfmpeg?: () => void | Promise<void>;
  lifecycle?: BrowserRenderLifecycle;
}

function normalizeFfmpegLogHeadlineLine(line: string): string | null {
  const text = line.trim();
  if (!text) return null;

  if (
    /^frame=\s*\d+/i.test(text) ||
    /^size=\s*\d+/i.test(text) ||
    /^video:/i.test(text) ||
    /^\[libx264 @/i.test(text) ||
    /^\[aac @/i.test(text) ||
    text === "Aborted()"
  ) {
    return null;
  }

  return text.replace(/^\[[^\]]+\]\s*/, "").trim() || null;
}

export function getEditorFfmpegFailureHeadline(input: {
  exitCode: number | null;
  logTail: string[];
  logHighlights?: string[];
}): string {
  for (const line of input.logHighlights?.slice(-8).reverse() ?? []) {
    const normalized = normalizeFfmpegLogHeadlineLine(line);
    if (normalized) {
      if (normalized === "Conversion failed!") {
        continue;
      }
      return `FFmpeg render failed: ${normalized}`;
    }
  }

  for (const line of input.logTail.slice(-8).reverse()) {
    const normalized = normalizeFfmpegLogHeadlineLine(line);
    if (normalized) {
      if (normalized === "Conversion failed!") {
        continue;
      }
      return `FFmpeg render failed: ${normalized}`;
    }
  }

  if (input.logTail.some((line) => line.trim() === "Conversion failed!")) {
    return "FFmpeg render failed: Conversion failed.";
  }

  return input.exitCode == null ? "FFmpeg render failed." : `FFmpeg exited with code ${input.exitCode}.`;
}

export function buildEditorFfmpegExecErrorMessage(input: {
  rawMessage: string;
  exitCode: number | null;
  timeoutMode: EditorFfmpegTimeoutMode;
  stallTimeoutMs?: number;
  resolution: EditorResolution;
  clipCount: number;
  durationSeconds: number;
  logTail: string[];
  logHighlights?: string[];
  audioItemCount?: number;
  subtitleFrameCount?: number;
}): string {
  const diagnostics = [
    `resolution=${input.resolution}`,
    `clipCount=${input.clipCount}`,
    `durationSeconds=${input.durationSeconds.toFixed(3)}`,
    `timeoutMode=${input.timeoutMode}`,
    `exitCode=${input.exitCode ?? "thrown"}`,
  ];
  if (typeof input.stallTimeoutMs === "number") {
    diagnostics.push(`stallTimeoutMs=${input.stallTimeoutMs}`);
  }
  if (typeof input.audioItemCount === "number") {
    diagnostics.push(`audioItemCount=${input.audioItemCount}`);
  }
  if (typeof input.subtitleFrameCount === "number") {
    diagnostics.push(`subtitleFrameCount=${input.subtitleFrameCount}`);
  }
  const diagnosticsText = diagnostics.join(", ");
  const highlights = input.logHighlights?.slice(-4).join("\n") ?? "";
  const tail = input.logTail.slice(-8).join("\n");

  return [
    input.rawMessage,
    diagnosticsText,
    highlights ? `ffmpeg-log-highlights:\n${highlights}` : null,
    tail ? `ffmpeg-log-tail:\n${tail}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function isEditorFfmpegExecDiagnosticMessage(message: string): boolean {
  return (
    message.includes("resolution=") &&
    message.includes("clipCount=") &&
    (message.includes("timeoutMode=") || message.includes("timeoutMs="))
  );
}

class EditorFfmpegExecError extends Error {}

async function throwEditorFfmpegExecError(
  input: EditorFfmpegExecInput & {
    rawMessage: string;
    exitCode: number | null;
    timeoutMode: EditorFfmpegTimeoutMode;
    alreadyReset?: boolean;
  }
): Promise<never> {
  if (!input.alreadyReset) {
    try {
      await input.resetFfmpeg?.();
    } catch {}
  }

  throw new EditorFfmpegExecError(
    buildEditorFfmpegExecErrorMessage({
      rawMessage: input.rawMessage,
      exitCode: input.exitCode,
      timeoutMode: input.timeoutMode,
      stallTimeoutMs:
        input.timeoutMode === "stall" ? input.activityWatchdog?.stallTimeoutMs : undefined,
      resolution: input.resolution,
      clipCount: input.clipCount,
      durationSeconds: input.durationSeconds,
      logTail: input.logTail,
      logHighlights: input.logHighlights,
      audioItemCount: input.audioItemCount,
      subtitleFrameCount: input.subtitleFrameCount,
    })
  );
}

export async function runEditorFfmpegExec(input: EditorFfmpegExecInput): Promise<void> {
  input.activityWatchdog?.start();

  try {
    const exitCode = await input.ff.exec(input.args, -1, {
      signal: input.lifecycle?.signal,
    });
    if (exitCode === 0) return;

    const rawMessage = input.activityWatchdog?.didStall
      ? "FFmpeg timed out while rendering."
      : getEditorFfmpegFailureHeadline({
          exitCode,
          logTail: input.logTail,
          logHighlights: input.logHighlights,
        });
    return throwEditorFfmpegExecError({
      ...input,
      rawMessage,
      exitCode,
      timeoutMode: input.activityWatchdog?.didStall ? "stall" : "none",
      alreadyReset: input.activityWatchdog?.didStall,
    });
  } catch (error) {
    if (error instanceof EditorFfmpegExecError) {
      throw error;
    }

    if (input.activityWatchdog?.didStall) {
      return throwEditorFfmpegExecError({
        ...input,
        rawMessage: "FFmpeg timed out while rendering.",
        exitCode: 1,
        timeoutMode: "stall",
        alreadyReset: true,
      });
    }

    if (isBrowserRenderCanceledError(error) || input.lifecycle?.signal?.aborted) {
      throw createBrowserRenderCanceledError();
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    return throwEditorFfmpegExecError({
      ...input,
      rawMessage,
      exitCode: null,
      timeoutMode: "none",
    });
  } finally {
    input.activityWatchdog?.stop();
  }
}
