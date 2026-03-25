import { spawn } from "node:child_process";
import path from "node:path";

import type { CommandRunResult, CommandRunner } from "../../../editor/node-media";
import { getBundledBinaryPath, isEnoentError } from "../../../editor/node-binaries";

export type CreatorShortSourcePlaybackMode = "normal" | "still";

export interface CreatorShortSourcePlaybackProfile {
  mode: CreatorShortSourcePlaybackMode;
  hasVideo: boolean;
  hasAudio: boolean;
  videoDurationSeconds: number;
  audioDurationSeconds: number;
  videoFrameCount?: number;
}

interface FfprobeStream {
  codec_type?: string;
  duration?: string;
  nb_frames?: string;
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

export interface DetectCreatorShortSourcePlaybackProfileOptions {
  commandRunner?: CommandRunner;
  ffprobePath?: string | null;
}

function parseFinitePositiveNumber(value: string | number | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function runCommand(command: string, args: readonly string[]): Promise<CommandRunResult> {
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

export function classifyCreatorShortSourcePlaybackProfile(input: {
  hasVideo: boolean;
  hasAudio: boolean;
  videoDurationSeconds?: number;
  audioDurationSeconds?: number;
  videoFrameCount?: number;
}): CreatorShortSourcePlaybackProfile {
  const videoDurationSeconds = parseFinitePositiveNumber(input.videoDurationSeconds) ?? 0;
  const audioDurationSeconds = parseFinitePositiveNumber(input.audioDurationSeconds) ?? 0;
  const parsedFrameCount = parseFinitePositiveNumber(input.videoFrameCount);
  const videoFrameCount = typeof parsedFrameCount === "number" ? Math.round(parsedFrameCount) : undefined;

  const singleFrameVideo = typeof videoFrameCount === "number" && videoFrameCount <= 1;
  const ultraShortVideo = videoDurationSeconds > 0 && videoDurationSeconds <= 0.1;
  const audioOutrunsVideo =
    audioDurationSeconds > 0 && audioDurationSeconds >= Math.max(1, videoDurationSeconds + 1);

  const mode: CreatorShortSourcePlaybackMode =
    input.hasVideo && (singleFrameVideo || ultraShortVideo) && (!input.hasAudio || audioOutrunsVideo)
      ? "still"
      : "normal";

  return {
    mode,
    hasVideo: input.hasVideo,
    hasAudio: input.hasAudio,
    videoDurationSeconds,
    audioDurationSeconds,
    videoFrameCount,
  };
}

export async function detectCreatorShortSourcePlaybackProfile(
  filePath: string,
  options: DetectCreatorShortSourcePlaybackProfileOptions = {}
): Promise<CreatorShortSourcePlaybackProfile> {
  const absolutePath = path.resolve(filePath);
  const runner = options.commandRunner ?? runCommand;
  const commandCandidates = [
    "ffprobe",
    options.ffprobePath ?? getBundledBinaryPath("ffprobe"),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  let result: CommandRunResult | null = null;
  for (const command of commandCandidates) {
    try {
      result = await runner(command, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        absolutePath,
      ]);
      break;
    } catch (error) {
      if (isEnoentError(error)) {
        continue;
      }
      throw error;
    }
  }

  if (!result) {
    return {
      mode: "normal",
      hasVideo: true,
      hasAudio: false,
      videoDurationSeconds: 0,
      audioDurationSeconds: 0,
    };
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
  const primaryVideoStream = videoStreams[0];
  const primaryAudioStream = audioStreams[0];

  return classifyCreatorShortSourcePlaybackProfile({
    hasVideo: videoStreams.length > 0,
    hasAudio: audioStreams.length > 0,
    videoDurationSeconds: parseFinitePositiveNumber(primaryVideoStream?.duration),
    audioDurationSeconds:
      parseFinitePositiveNumber(primaryAudioStream?.duration) ??
      parseFinitePositiveNumber(payload.format?.duration),
    videoFrameCount: parseFinitePositiveNumber(primaryVideoStream?.nb_frames),
  });
}
