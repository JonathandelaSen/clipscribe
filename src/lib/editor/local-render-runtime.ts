import {
  createBrowserRenderCanceledError,
  isBrowserRenderCanceledError,
  type BrowserRenderLifecycle,
} from "../browser-render";
import type { EditorResolution } from "./types";

type EditorFfmpegRunner = {
  exec(args: string[], timeout?: number, options?: { signal?: AbortSignal }): Promise<number>;
};

export interface EditorFfmpegExecInput {
  ff: EditorFfmpegRunner;
  args: string[];
  timeoutMs: number;
  resolution: EditorResolution;
  clipCount: number;
  durationSeconds: number;
  logTail: string[];
  resetFfmpeg?: () => void | Promise<void>;
  lifecycle?: BrowserRenderLifecycle;
}

export function buildEditorFfmpegExecErrorMessage(input: {
  rawMessage: string;
  timeoutMs: number;
  exitCode: number | null;
  resolution: EditorResolution;
  clipCount: number;
  durationSeconds: number;
  logTail: string[];
}): string {
  const diagnostics = [
    `resolution=${input.resolution}`,
    `clipCount=${input.clipCount}`,
    `durationSeconds=${input.durationSeconds.toFixed(3)}`,
    `timeoutMs=${input.timeoutMs}`,
    `exitCode=${input.exitCode ?? "thrown"}`,
  ].join(", ");
  const tail = input.logTail.slice(-8).join("\n");

  return tail
    ? `${input.rawMessage}\n${diagnostics}\nffmpeg-log-tail:\n${tail}`
    : `${input.rawMessage}\n${diagnostics}`;
}

export function isEditorFfmpegExecDiagnosticMessage(message: string): boolean {
  return message.includes("resolution=") && message.includes("clipCount=") && message.includes("timeoutMs=");
}

class EditorFfmpegExecError extends Error {}

async function throwEditorFfmpegExecError(
  input: EditorFfmpegExecInput & { rawMessage: string; exitCode: number | null }
): Promise<never> {
  try {
    await input.resetFfmpeg?.();
  } catch {}

  throw new EditorFfmpegExecError(
    buildEditorFfmpegExecErrorMessage({
      rawMessage: input.rawMessage,
      timeoutMs: input.timeoutMs,
      exitCode: input.exitCode,
      resolution: input.resolution,
      clipCount: input.clipCount,
      durationSeconds: input.durationSeconds,
      logTail: input.logTail,
    })
  );
}

export async function runEditorFfmpegExec(input: EditorFfmpegExecInput): Promise<void> {
  try {
    const exitCode = await input.ff.exec(input.args, input.timeoutMs, {
      signal: input.lifecycle?.signal,
    });
    if (exitCode === 0) return;

    const rawMessage = exitCode === 1 ? "FFmpeg timed out while rendering." : `FFmpeg exited with code ${exitCode}.`;
    return throwEditorFfmpegExecError({
      ...input,
      rawMessage,
      exitCode,
    });
  } catch (error) {
    if (error instanceof EditorFfmpegExecError) {
      throw error;
    }

    if (isBrowserRenderCanceledError(error) || input.lifecycle?.signal?.aborted) {
      throw createBrowserRenderCanceledError();
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    return throwEditorFfmpegExecError({
      ...input,
      rawMessage,
      exitCode: null,
    });
  }
}
