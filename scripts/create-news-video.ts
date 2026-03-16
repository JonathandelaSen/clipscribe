#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
type Resolution = "720p" | "1080p" | "4K";

const require = createRequire(import.meta.url);

interface CliOptions {
  help: boolean;
  force: boolean;
  deliverDir?: string;
  imagePath?: string;
  audioPath?: string;
  outputPath?: string;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  fps: number;
}

function getHelpText(): string {
  return [
    "Create a YouTube-ready MP4 from a puntos-clave deliver folder or explicit audio/image files.",
    "",
    "Usage:",
    "  npm run create:news-video -- --deliver-dir /path/to/deliver",
    "  npm run create:news-video -- --image /path/to/infografia.png --audio /path/to/audio-overview.m4a --output ./exports/news.mp4",
    "",
    "Options:",
    "  --deliver-dir <path>        Deliver directory that contains the blog/audio/image assets",
    "  --image <path>              Infographic or cover image to use as the main visual",
    "  --audio <path>              Audio file to use as the soundtrack",
    "  --output <file>             Final MP4 path (default: <deliver-dir>/<news>-youtube.mp4)",
    "  --aspect <16:9|9:16|1:1|4:5> Output aspect ratio (default: 16:9)",
    "  --resolution <720p|1080p|4K> Output resolution preset (default: 1080p)",
    "  --fps <number>              Output frame rate (default: 30)",
    "  --force                     Overwrite an existing output file",
    "  --help                      Show this help text",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    force: false,
    aspectRatio: "16:9",
    resolution: "1080p",
    fps: 30,
  };

  const validAspectRatios = new Set<AspectRatio>(["16:9", "9:16", "1:1", "4:5"]);
  const validResolutions = new Set<Resolution>(["720p", "1080p", "4K"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--deliver-dir":
        options.deliverDir = readRequiredValue(argv, index, token);
        index += 1;
        break;
      case "--image":
        options.imagePath = readRequiredValue(argv, index, token);
        index += 1;
        break;
      case "--audio":
        options.audioPath = readRequiredValue(argv, index, token);
        index += 1;
        break;
      case "--output":
        options.outputPath = readRequiredValue(argv, index, token);
        index += 1;
        break;
      case "--aspect": {
        const value = readRequiredValue(argv, index, token) as AspectRatio;
        if (!validAspectRatios.has(value)) {
          throw new Error(`--aspect must be one of ${Array.from(validAspectRatios).join(", ")}.`);
        }
        options.aspectRatio = value;
        index += 1;
        break;
      }
      case "--resolution": {
        const value = readRequiredValue(argv, index, token) as Resolution;
        if (!validResolutions.has(value)) {
          throw new Error(`--resolution must be one of ${Array.from(validResolutions).join(", ")}.`);
        }
        options.resolution = value;
        index += 1;
        break;
      }
      case "--fps": {
        const rawValue = readRequiredValue(argv, index, token);
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed) || parsed < 1) {
          throw new Error("--fps must be a positive number.");
        }
        options.fps = Math.round(parsed);
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown flag "${token}". Use --help to see supported options.`);
    }
  }

  return options;
}

function readRequiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

async function assertReadableFile(targetPath: string, label: string): Promise<void> {
  try {
    await access(targetPath, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} is not readable: ${targetPath}`);
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findDeliverAsset(
  deliverDir: string,
  matcher: (filename: string) => boolean,
  label: string,
): Promise<string> {
  const entries = await readdir(deliverDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isFile() && matcher(entry.name));

  if (!match) {
    throw new Error(`Could not find a ${label} inside ${deliverDir}.`);
  }

  return path.join(deliverDir, match.name);
}

function extractTitleFromMarkdown(markdown: string, fallback: string): string {
  for (const line of markdown.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    return trimmed.replace(/^#+\s*/, "").replace(/^\*\*|\*\*$/g, "").trim();
  }

  return fallback;
}

function getCanvasSize(aspectRatio: AspectRatio, resolution: Resolution): { width: number; height: number } {
  switch (resolution) {
    case "720p":
      return getCanvasSizeForBase(aspectRatio, 720);
    case "1080p":
      return getCanvasSizeForBase(aspectRatio, 1080);
    case "4K":
      return getCanvasSizeForBase(aspectRatio, 2160);
    default:
      return getCanvasSizeForBase(aspectRatio, 1080);
  }
}

function getCanvasSizeForBase(aspectRatio: AspectRatio, base: number): { width: number; height: number } {
  switch (aspectRatio) {
    case "16:9":
      return { width: Math.round((base * 16) / 9), height: base };
    case "9:16":
      return { width: base, height: Math.round((base * 16) / 9) };
    case "1:1":
      return { width: base, height: base };
    case "4:5":
      return { width: base, height: Math.round((base * 5) / 4) };
    default:
      return { width: Math.round((base * 16) / 9), height: base };
  }
}

function toEven(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function buildFilterGraph(input: {
  width: number;
  height: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
}): string {
  const margin = toEven(
    input.resolution === "4K"
      ? 128
      : input.resolution === "1080p"
        ? 96
        : 64,
  );
  const waveHeight = toEven(
    input.aspectRatio === "9:16"
      ? Math.round(input.height * 0.12)
      : input.resolution === "4K"
        ? 240
        : input.resolution === "1080p"
          ? 180
          : 120,
  );
  const availableHeight = toEven(Math.max(120, input.height - margin * 2 - waveHeight - margin));
  const innerWidth = toEven(Math.max(320, input.width - margin * 2));

  return [
    `[0:v]scale=${input.width}:${input.height}:force_original_aspect_ratio=increase,crop=${input.width}:${input.height},boxblur=24:12[bg]`,
    `[0:v]scale=${innerWidth}:${availableHeight}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:${margin}[base]`,
    `[1:a]asplit=2[aout][awave]`,
    `[awave]showwaves=s=${input.width}x${waveHeight}:mode=line:colors=0xffd166@0.9,format=rgba[waves]`,
    `[base][waves]overlay=0:H-h-${margin},format=yuv420p[vout]`,
  ].join(";");
}

function renderCommandPreview(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

async function resolveInputs(options: CliOptions): Promise<{
  imagePath: string;
  audioPath: string;
  outputPath: string;
  title: string;
}> {
  if (options.deliverDir) {
    const deliverDir = path.resolve(options.deliverDir);
    const imagePath =
      options.imagePath != null
        ? path.resolve(options.imagePath)
        : await findDeliverAsset(
            deliverDir,
            (filename) => /\.(png|jpg|jpeg|webp)$/i.test(filename),
            "cover image",
          );
    const audioPath =
      options.audioPath != null
        ? path.resolve(options.audioPath)
        : await findDeliverAsset(
            deliverDir,
            (filename) => /\.(m4a|mp3|wav|aac|flac|ogg)$/i.test(filename),
            "audio track",
          );
    const blogPath = await findDeliverAsset(
      deliverDir,
      (filename) => filename.endsWith("-blog-post.md"),
      "blog post markdown file",
    );
    const fallbackTitle = path.basename(path.dirname(deliverDir));
    const title = extractTitleFromMarkdown(await readFile(blogPath, "utf8"), fallbackTitle);
    const outputPath =
      options.outputPath != null
        ? path.resolve(options.outputPath)
        : path.join(deliverDir, `${path.basename(path.dirname(deliverDir))}-youtube.mp4`);

    return {
      imagePath,
      audioPath,
      outputPath,
      title,
    };
  }

  if (!options.imagePath || !options.audioPath) {
    throw new Error("Pass --deliver-dir or both --image and --audio.");
  }

  return {
    imagePath: path.resolve(options.imagePath),
    audioPath: path.resolve(options.audioPath),
    outputPath: path.resolve(options.outputPath ?? "./exports/news-video.mp4"),
    title: path.basename(options.outputPath ?? "news-video", path.extname(options.outputPath ?? "news-video.mp4")),
  };
}

async function runFfmpeg(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg exited with code ${code ?? 1}.`));
    });
  });
}

function getBundledFfmpegPath(): string | null {
  try {
    const packagedPath = require("ffmpeg-static");
    return typeof packagedPath === "string" && packagedPath.trim() ? path.resolve(packagedPath) : null;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      return null;
    }

    throw error;
  }
}

function getBundledFfprobePath(): string | null {
  try {
    const packagedModule = require("ffprobe-static");

    if (
      packagedModule &&
      typeof packagedModule === "object" &&
      "path" in packagedModule &&
      typeof packagedModule.path === "string" &&
      packagedModule.path.trim()
    ) {
      return path.resolve(packagedModule.path);
    }

    return null;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      return null;
    }

    throw error;
  }
}

async function runCommand(command: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code ?? 1}.`));
    });
  });
}

async function probeDurationSeconds(audioPath: string): Promise<number> {
  const ffprobePath = getBundledFfprobePath();

  if (!ffprobePath) {
    throw new Error("Could not locate the bundled ffprobe binary. Run `npm install` in clipscribe first.");
  }

  const result = await runCommand(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  const durationSeconds = Number(result.stdout.trim());

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Could not determine a valid audio duration for ${audioPath}.`);
  }

  return durationSeconds;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(getHelpText());
    return;
  }

  const resolved = await resolveInputs(options);
  const ffmpegPath = getBundledFfmpegPath();

  if (!ffmpegPath) {
    throw new Error("Could not locate the bundled ffmpeg binary. Run `npm install` in clipscribe first.");
  }

  await assertReadableFile(resolved.imagePath, "Image file");
  await assertReadableFile(resolved.audioPath, "Audio file");
  const audioDurationSeconds = await probeDurationSeconds(resolved.audioPath);

  if (!options.force && (await fileExists(resolved.outputPath))) {
    throw new Error(`Output file already exists: ${resolved.outputPath}. Re-run with --force to overwrite it.`);
  }

  await mkdir(path.dirname(resolved.outputPath), { recursive: true });

  const { width, height } = getCanvasSize(options.aspectRatio, options.resolution);
  const filterGraph = buildFilterGraph({
    width,
    height,
    resolution: options.resolution,
    aspectRatio: options.aspectRatio,
  });

  const ffmpegArgs = [
    options.force ? "-y" : "-n",
    "-loop",
    "1",
    "-framerate",
    String(options.fps),
    "-i",
    resolved.imagePath,
    "-i",
    resolved.audioPath,
    "-filter_complex",
    filterGraph,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-r",
    String(options.fps),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "stillimage",
    "-crf",
    options.resolution === "4K" ? "24" : "22",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    audioDurationSeconds.toFixed(3),
    "-shortest",
    resolved.outputPath,
  ];

  console.log(`Creating video for "${resolved.title}"`);
  console.log(`Image: ${resolved.imagePath}`);
  console.log(`Audio: ${resolved.audioPath}`);
  console.log(`Output: ${resolved.outputPath}`);
  console.log(`Canvas: ${width}x${height} @ ${options.fps}fps`);
  console.log(`Audio duration: ${audioDurationSeconds.toFixed(3)}s`);
  console.log(`ffmpeg: ${renderCommandPreview(ffmpegPath, ffmpegArgs)}`);

  await runFfmpeg(ffmpegPath, ffmpegArgs);

  console.log(`Created ${resolved.outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
