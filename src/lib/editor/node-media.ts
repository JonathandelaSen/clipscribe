import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { EditorProjectBundleResolvedMedia } from "./bundle";

export interface CommandRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: readonly string[]) => Promise<CommandRunResult>;

export interface ProbeMediaFileOptions {
  commandRunner?: CommandRunner;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function isFinitePositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function parseDurationSeconds(...values: Array<string | number | undefined>): number {
  const parsedValues = values
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter(isFinitePositiveNumber);
  return parsedValues.length > 0 ? Math.max(...parsedValues) : 0;
}

function guessMimeType(filePath: string, kind: "video" | "audio"): string {
  const extension = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "video/webm",
  };
  return map[extension] ?? (kind === "video" ? "video/mp4" : "audio/mpeg");
}

async function runCommand(command: string, args: readonly string[]): Promise<CommandRunResult> {
  return new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export async function probeMediaFileWithFfprobe(
  filePath: string,
  options: ProbeMediaFileOptions = {}
): Promise<EditorProjectBundleResolvedMedia> {
  const absolutePath = path.resolve(filePath);
  try {
    await access(absolutePath, fsConstants.R_OK);
  } catch {
    throw new Error(`Media file is not readable: ${absolutePath}`);
  }

  const runner = options.commandRunner ?? runCommand;
  let result: CommandRunResult;
  try {
    result = await runner("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      absolutePath,
    ]);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("ffprobe is required on PATH to import timeline bundles from the CLI.");
    }
    throw error;
  }

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "Unknown ffprobe failure.";
    throw new Error(`ffprobe failed for ${absolutePath}: ${detail}`);
  }

  let payload: FfprobePayload;
  try {
    payload = JSON.parse(result.stdout) as FfprobePayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid ffprobe JSON.";
    throw new Error(`ffprobe returned invalid JSON for ${absolutePath}. ${message}`);
  }

  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  if (videoStreams.length === 0 && audioStreams.length === 0) {
    throw new Error(`ffprobe did not detect any audio or video streams for ${absolutePath}.`);
  }

  const kind = videoStreams.length > 0 ? "video" : "audio";
  const primaryVideoStream = videoStreams[0];
  const fileStats = await stat(absolutePath);
  const durationSeconds = parseDurationSeconds(
    payload.format?.duration,
    primaryVideoStream?.duration,
    audioStreams[0]?.duration
  );

  return {
    kind,
    filename: path.basename(absolutePath),
    mimeType: guessMimeType(absolutePath, kind),
    sizeBytes: fileStats.size,
    durationSeconds,
    width: primaryVideoStream?.width,
    height: primaryVideoStream?.height,
    hasAudio: audioStreams.length > 0,
  };
}
