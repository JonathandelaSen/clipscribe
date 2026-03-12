import { spawn } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { buildEditorExportPlan } from "./core/export-plan";
import type { CommandRunResult, CommandRunner } from "./node-media";
import { buildMissingBinaryMessage, getBundledBinaryPath, isEnoentError } from "./node-binaries";
import type { EditorAssetRecord, EditorProjectRecord, EditorResolution } from "./types";

export interface NodeEditorExportAsset {
  asset: EditorAssetRecord;
  absolutePath: string;
}

export interface NodeEditorExportInput {
  project: EditorProjectRecord;
  assets: readonly NodeEditorExportAsset[];
  resolution: EditorResolution;
  outputPath: string;
  overwrite?: boolean;
  dryRun?: boolean;
  commandRunner?: CommandRunner;
  ffmpegPath?: string | null;
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
  const unsupportedSourceAsset = assets.find(({ asset }) => asset.sourceType !== "upload");
  if (unsupportedSourceAsset) {
    throw new Error(`CLI export currently supports only upload assets. Asset "${unsupportedSourceAsset.asset.filename}" uses sourceType "${unsupportedSourceAsset.asset.sourceType}".`);
  }

  const captionedAsset = assets.find(({ asset }) => asset.captionSource.kind !== "none");
  if (captionedAsset) {
    throw new Error(`CLI export does not support captionSource "${captionedAsset.asset.captionSource.kind}" yet. Use browser export or remove subtitles first.`);
  }

  if (project.timeline.videoClips.length === 0) {
    throw new Error("CLI export requires at least one video clip.");
  }
}

export function buildNodeEditorExportCommand(input: {
  project: EditorProjectRecord;
  assets: readonly NodeEditorExportAsset[];
  resolution: EditorResolution;
  outputPath: string;
  overwrite?: boolean;
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

  const mapArgs = ["-map", `[${exportPlan.videoTrackLabel}]`];
  if (exportPlan.mixedAudioLabel) {
    mapArgs.push("-map", `[${exportPlan.mixedAudioLabel}]`);
  }

  const ffmpegArgs = [
    input.overwrite ? "-y" : "-n",
    ...exportPlan.ffmpegArgs,
    "-filter_complex",
    exportPlan.filterComplex,
    ...mapArgs,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    input.resolution === "4K" ? "24" : "22",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];

  return {
    width: exportPlan.width,
    height: exportPlan.height,
    durationSeconds: exportPlan.durationSeconds,
    warnings: exportPlan.warnings,
    ffmpegArgs,
    ffmpegCommandPreview: ["ffmpeg", ...ffmpegArgs],
    notes: [
      `Timeline export via system ffmpeg (${input.project.aspectRatio} @ ${input.resolution}).`,
      `${input.project.timeline.videoClips.length} video clips in ripple sequence.`,
      input.project.timeline.audioItems.length
        ? `${input.project.timeline.audioItems.length} audio track item${input.project.timeline.audioItems.length === 1 ? "" : "s"} mixed with clip audio.`
        : "Clip audio only.",
      "No subtitle burn-in is rendered by the CLI exporter.",
      input.resolution === "4K" ? "4K uses a slightly higher CRF preset." : "Standard CLI export preset.",
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

  const command = buildNodeEditorExportCommand({
    project: input.project,
    assets: input.assets,
    resolution: input.resolution,
    outputPath,
    overwrite: input.overwrite,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  if (!input.dryRun) {
    const runner = input.commandRunner ?? runCommand;
    const commandCandidates = [
      "ffmpeg",
      input.ffmpegPath ?? getBundledBinaryPath("ffmpeg"),
    ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

    let result: CommandRunResult | null = null;
    for (const commandName of commandCandidates) {
      try {
        result = await runner(commandName, command.ffmpegArgs);
        break;
      } catch (error) {
        if (isEnoentError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!result) {
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
    width: command.width,
    height: command.height,
    sizeBytes: outputStats?.size ?? 0,
    durationSeconds: command.durationSeconds,
    warnings: command.warnings,
    ffmpegCommandPreview: command.ffmpegCommandPreview,
    notes: command.notes,
    dryRun: Boolean(input.dryRun),
  };
}
