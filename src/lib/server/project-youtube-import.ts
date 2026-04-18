import { spawn } from "node:child_process";
import { readdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { probeMediaFileWithFfprobe, type CommandRunResult } from "@/lib/editor/node-media";
import { getBundledBinaryPath, isEnoentError } from "@/lib/editor/node-binaries";

const SUPPORTED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

type LooseRecord = Record<string, unknown>;

export interface ImportedProjectYouTubeVideo {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  videoId: string;
  title?: string;
  channelTitle?: string;
}

export interface ProjectYouTubeImportProgressUpdate {
  phase: "metadata" | "download" | "normalize" | "finalizing";
  progress?: number;
  message?: string;
  logLine?: string;
}

export interface ProjectYouTubeImportDependencies {
  commandRunner?: (
    command: string,
    args: readonly string[],
    options?: {
      cwd?: string;
      signal?: AbortSignal;
      onStdoutLine?: (line: string) => void;
      onStderrLine?: (line: string) => void;
    }
  ) => Promise<CommandRunResult>;
  probeMediaFile?: typeof probeMediaFileWithFfprobe;
  tempDirFactory?: () => Promise<string>;
}

interface YtDlpVideoInfo {
  id: string;
  title?: string;
  channelTitle?: string;
}

function createAbortError() {
  const error = new Error("YouTube import canceled.");
  error.name = "AbortError";
  return error;
}

function isRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOwnedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(data.byteLength));
  bytes.set(data);
  return bytes;
}

function sanitizeFilenameStem(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function readDownloadProgressPercent(line: string): number | undefined {
  const match = line.match(/(\d+(?:\.\d+)?)%/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function getYouTubeBinaryCommand() {
  return process.env.YT_DLP_BIN?.trim() || "yt-dlp";
}

function normalizeYouTubeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function resolveSupportedYouTubeUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Provide a valid YouTube URL.");
  }

  const host = normalizeYouTubeHost(url.hostname);
  if (!SUPPORTED_YOUTUBE_HOSTS.has(host)) {
    throw new Error("Only youtube.com and youtu.be video URLs are supported.");
  }
  if (url.searchParams.has("list")) {
    throw new Error("Playlist URLs are not supported yet. Paste a single YouTube video URL.");
  }

  if (host === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    if (!videoId) {
      throw new Error("The YouTube short-link is missing a video id.");
    }
    return {
      url: url.toString(),
      videoIdHint: videoId,
    };
  }

  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v")?.trim();
    if (!videoId) {
      throw new Error("The YouTube watch URL is missing its video id.");
    }
    return {
      url: url.toString(),
      videoIdHint: videoId,
    };
  }

  if (url.pathname.startsWith("/shorts/")) {
    const videoId = url.pathname.split("/")[2]?.trim();
    if (!videoId) {
      throw new Error("The YouTube Shorts URL is missing its video id.");
    }
    return {
      url: url.toString(),
      videoIdHint: videoId,
    };
  }

  throw new Error("Only standard video and Shorts URLs are supported.");
}

function parseYtDlpVideoInfo(raw: string, fallbackVideoId: string): YtDlpVideoInfo {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("yt-dlp returned invalid metadata for this URL.");
  }

  if (!isRecord(payload)) {
    throw new Error("yt-dlp returned an unexpected metadata payload.");
  }
  if (payload._type === "playlist" || Array.isArray(payload.entries)) {
    throw new Error("Playlist URLs are not supported yet. Paste a single YouTube video URL.");
  }

  const id = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : fallbackVideoId;
  return {
    id,
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : undefined,
    channelTitle:
      typeof payload.channel === "string" && payload.channel.trim()
        ? payload.channel.trim()
        : typeof payload.uploader === "string" && payload.uploader.trim()
          ? payload.uploader.trim()
          : undefined,
  };
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
  } = {}
): Promise<CommandRunResult> {
  return new Promise<CommandRunResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let aborted = false;

    const cleanupAbort = () => {
      if (!options.signal) return;
      options.signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      reject(createAbortError());
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";

    const emitLines = (chunk: string, kind: "stdout" | "stderr") => {
      const currentBuffer = kind === "stdout" ? stdoutBuffer : stderrBuffer;
      const nextBuffer = currentBuffer + chunk;
      const parts = nextBuffer.split(/\r?\n/);
      const remainder = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        if (kind === "stdout") {
          options.onStdoutLine?.(line);
        } else {
          options.onStderrLine?.(line);
        }
      }
      if (kind === "stdout") {
        stdoutBuffer = remainder;
      } else {
        stderrBuffer = remainder;
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      emitLines(chunk, "stdout");
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      emitLines(chunk, "stderr");
    });

    child.on("error", (error) => {
      cleanupAbort();
      reject(error);
    });

    child.on("close", (code) => {
      cleanupAbort();
      if (aborted) return;
      if (stdoutBuffer.trim()) options.onStdoutLine?.(stdoutBuffer.trim());
      if (stderrBuffer.trim()) options.onStderrLine?.(stderrBuffer.trim());
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function findDownloadedFile(downloadDir: string) {
  const entries = await readdir(downloadDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith(".part") && !name.endsWith(".ytdl") && !name.endsWith(".tmp"));

  if (files.length === 0) {
    throw new Error("yt-dlp did not produce a downloadable media file.");
  }

  return path.join(downloadDir, files[0]!);
}

async function normalizeVideoToMp4(
  inputPath: string,
  outputDir: string,
  signal: AbortSignal | undefined,
  commandRunner: NonNullable<ProjectYouTubeImportDependencies["commandRunner"]>,
  onProgress?: (update: ProjectYouTubeImportProgressUpdate) => void
) {
  if (path.extname(inputPath).toLowerCase() === ".mp4") {
    onProgress?.({
      phase: "normalize",
      progress: 92,
      message: "Downloaded MP4 is already ready to store.",
    });
    return inputPath;
  }

  const ffmpegCommand = getBundledBinaryPath("ffmpeg") ?? "ffmpeg";
  const outputPath = path.join(outputDir, "normalized-source.mp4");
  onProgress?.({
    phase: "normalize",
    progress: 88,
    message: "Normalizing the download to MP4.",
  });
  let result: CommandRunResult;
  try {
    result = await commandRunner(
      ffmpegCommand,
      [
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { signal }
    );
  } catch (error) {
    if (isEnoentError(error)) {
      throw new Error("ffmpeg is required to normalize downloaded YouTube videos. Install project dependencies with npm install or place ffmpeg on PATH.");
    }
    throw error;
  }

  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "Unknown ffmpeg failure.";
    throw new Error(`ffmpeg could not normalize the downloaded video: ${detail}`);
  }

  onProgress?.({
    phase: "normalize",
    progress: 95,
    message: "MP4 normalization finished.",
  });
  return outputPath;
}

export async function importProjectYouTubeVideo(
  input: { url: string; signal?: AbortSignal },
  dependencies: ProjectYouTubeImportDependencies & {
    onProgress?: (update: ProjectYouTubeImportProgressUpdate) => void;
  } = {}
): Promise<ImportedProjectYouTubeVideo> {
  const resolved = resolveSupportedYouTubeUrl(input.url);
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const probeMediaFile = dependencies.probeMediaFile ?? probeMediaFileWithFfprobe;
  const tempDirFactory = dependencies.tempDirFactory ?? (() => mkdtemp(path.join(os.tmpdir(), "clipscribe-youtube-import-")));
  const tempRoot = await tempDirFactory();
  const downloadDir = path.join(tempRoot, "download");

  try {
    dependencies.onProgress?.({
      phase: "metadata",
      progress: 2,
      message: "Resolving YouTube metadata.",
    });
    const infoResult = await commandRunner(
      getYouTubeBinaryCommand(),
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--skip-download",
        resolved.url,
      ],
      { signal: input.signal }
    );

    if (infoResult.code !== 0) {
      const detail = infoResult.stderr.trim() || infoResult.stdout.trim() || "Unknown yt-dlp failure.";
      throw new Error(`Could not read YouTube metadata: ${detail}`);
    }

    const info = parseYtDlpVideoInfo(infoResult.stdout, resolved.videoIdHint);
    dependencies.onProgress?.({
      phase: "download",
      progress: 5,
      message: `Downloading ${info.title || "YouTube video"}.`,
    });

    const downloadResult = await commandRunner(
      getYouTubeBinaryCommand(),
      [
        "--no-playlist",
        "--no-warnings",
        "--format",
        "best[height<=1080]/best",
        "--newline",
        "--paths",
        downloadDir,
        "--output",
        "download.%(ext)s",
        resolved.url,
      ],
      {
        signal: input.signal,
        onStdoutLine: (line) => {
          const progressPercent = readDownloadProgressPercent(line);
          dependencies.onProgress?.({
            phase: "download",
            progress: progressPercent == null ? undefined : 5 + progressPercent * 0.8,
            message: "Downloading from YouTube.",
            logLine: line,
          });
        },
        onStderrLine: (line) => {
          const progressPercent = readDownloadProgressPercent(line);
          dependencies.onProgress?.({
            phase: "download",
            progress: progressPercent == null ? undefined : 5 + progressPercent * 0.8,
            message: "Downloading from YouTube.",
            logLine: line,
          });
        },
      }
    );

    if (downloadResult.code !== 0) {
      const detail = downloadResult.stderr.trim() || downloadResult.stdout.trim() || "Unknown yt-dlp failure.";
      throw new Error(`Could not download the YouTube video: ${detail}`);
    }

    const downloadedFilePath = await findDownloadedFile(downloadDir);
    const finalFilePath = await normalizeVideoToMp4(downloadedFilePath, tempRoot, input.signal, commandRunner, dependencies.onProgress);
    dependencies.onProgress?.({
      phase: "finalizing",
      progress: 97,
      message: "Reading the final MP4 and probing metadata.",
    });
    const media = await probeMediaFile(finalFilePath);
    const fileStem = sanitizeFilenameStem(info.title || path.basename(finalFilePath, path.extname(finalFilePath)), `youtube-${info.id}`);
    const filename = `${fileStem}.mp4`;
    const bytes = toOwnedBytes(new Uint8Array(await readFile(finalFilePath)));

    return {
      bytes,
      filename,
      mimeType: "video/mp4",
      sizeBytes: bytes.byteLength,
      durationSeconds: media.durationSeconds,
      width: media.width,
      height: media.height,
      videoId: info.id,
      title: info.title,
      channelTitle: info.channelTitle,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    if (isEnoentError(error)) {
      throw new Error("yt-dlp is required to import YouTube videos locally. Install it and try again.");
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
