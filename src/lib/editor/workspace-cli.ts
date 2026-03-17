import { access, readFile, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import {
  getEditorProjectBundleExpectedPaths,
  materializeEditorProjectBundleWithResolver,
  parseEditorProjectBundleManifest,
} from "./bundle";
import { normalizeCliPathInput } from "./bundle-cli";
import { buildEditorExportFilename } from "./export-output";
import { probeMediaFileWithFfprobe } from "./node-media";
import { exportEditorProjectWithSystemFfmpeg, type NodeEditorExportResult } from "./node-render";
import {
  buildEditorExportRecord,
  markEditorProjectExporting,
  markEditorProjectFailed,
  markEditorProjectSaved,
  serializeEditorProjectForPersistence,
} from "./storage";
import type { EditorAspectRatio, EditorProjectRecord, EditorResolution } from "./types";
import {
  EDITOR_PROJECT_WORKSPACE_FILENAME,
  createEditorProjectWorkspace,
  parseEditorProjectWorkspace,
  serializeEditorProjectWorkspace,
  type EditorProjectWorkspaceV1,
} from "./workspace";

const DEFAULT_EXPORT_RESOLUTION: EditorResolution = "1080p";
const VALID_EXPORT_RESOLUTIONS: EditorResolution[] = ["720p", "1080p", "4K"];

export interface ParsedImportTimelineProjectArgs {
  help: boolean;
  force: boolean;
  json: boolean;
  bundlePath?: string;
}

export interface ParsedExportTimelineProjectArgs {
  help: boolean;
  force: boolean;
  json: boolean;
  dryRun: boolean;
  projectPath?: string;
  outputPath?: string;
  resolution?: EditorResolution;
}

export interface ImportTimelineProjectOptions {
  bundlePath: string;
  force: boolean;
  json: boolean;
}

export interface ExportTimelineProjectOptions {
  projectPath: string;
  outputPath?: string;
  resolution: EditorResolution;
  dryRun: boolean;
  force: boolean;
  json: boolean;
}

export interface ImportedTimelineProjectWorkspaceResult {
  command: "import:timeline-project";
  bundlePath: string;
  workspacePath: string;
  projectId: string;
  name: string;
  clipCount: number;
  assetCount: number;
}

export interface ExportedTimelineProjectWorkspaceResult {
  command: "export:timeline-project";
  workspacePath: string;
  outputPath: string;
  resolution: EditorResolution;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  warnings: string[];
  dryRun: boolean;
  ffmpegCommandPreview: string[];
}

export interface TimelineProjectCliProgressUpdate {
  stage: "prepare" | "probe" | "render" | "write" | "done";
  message: string;
  percent: number;
}

export interface ImportTimelineProjectDependencies {
  now?: () => number;
  probeMedia?: typeof probeMediaFileWithFfprobe;
  onProgress?: (update: TimelineProjectCliProgressUpdate) => void;
}

export interface ExportTimelineProjectDependencies {
  now?: () => number;
  exportProject?: (input: Parameters<typeof exportEditorProjectWithSystemFfmpeg>[0]) => Promise<NodeEditorExportResult>;
  onProgress?: (update: TimelineProjectCliProgressUpdate) => void;
}

function emitCliProgress(
  callback: ImportTimelineProjectDependencies["onProgress"] | ExportTimelineProjectDependencies["onProgress"] | undefined,
  update: TimelineProjectCliProgressUpdate
) {
  callback?.({
    ...update,
    percent: Math.round(Math.min(100, Math.max(0, update.percent))),
  });
}

function readRequiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function isWorkspaceFilePath(value: string): boolean {
  return path.basename(value).toLowerCase() === EDITOR_PROJECT_WORKSPACE_FILENAME;
}

function getDefaultExportOutputPath(
  workspaceDirectory: string,
  projectName: string,
  aspectRatio: EditorAspectRatio,
  resolution: EditorResolution
): string {
  return path.join(
    workspaceDirectory,
    "exports",
    buildEditorExportFilename(projectName, aspectRatio, resolution)
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertReadableFile(targetPath: string, label: string) {
  try {
    await access(targetPath, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} is not readable: ${targetPath}`);
  }
}

function resolveWorkspaceRelativePath(rootDirectory: string, relativePath: string, label: string): string {
  const absolutePath = path.resolve(rootDirectory, relativePath);
  const relativeFromRoot = path.relative(rootDirectory, absolutePath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside ${rootDirectory}.`);
  }
  return absolutePath;
}

async function loadWorkspaceFromDisk(projectPath: string): Promise<{
  workspacePath: string;
  workspaceDirectory: string;
  workspace: EditorProjectWorkspaceV1;
}> {
  const candidatePath = path.resolve(projectPath);
  const workspacePath = isWorkspaceFilePath(candidatePath)
    ? candidatePath
    : path.join(candidatePath, EDITOR_PROJECT_WORKSPACE_FILENAME);
  await assertReadableFile(workspacePath, "Project workspace");
  const workspace = parseEditorProjectWorkspace(await readFile(workspacePath, "utf8"));

  return {
    workspacePath,
    workspaceDirectory: path.dirname(workspacePath),
    workspace,
  };
}

async function writeWorkspaceFile(workspacePath: string, workspace: EditorProjectWorkspaceV1) {
  await writeFile(workspacePath, serializeEditorProjectWorkspace(workspace), "utf8");
}

async function resolveWorkspaceAssetsForExport(
  workspace: EditorProjectWorkspaceV1,
  workspaceDirectory: string
) {
  return Promise.all(
    workspace.assets.map(async (asset) => {
      const absolutePath = resolveWorkspaceRelativePath(
        workspaceDirectory,
        asset.path,
        `Workspace asset "${asset.filename}"`
      );
      await assertReadableFile(absolutePath, `Workspace asset "${asset.filename}"`);
      return {
        asset,
        absolutePath,
      };
    })
  );
}

export function getImportTimelineProjectHelpText(): string {
  return [
    "Import a Timeline Studio bundle into an editable on-disk workspace.",
    "",
    "Usage:",
    "  npm run import:timeline-project -- --bundle /path/to/project.clipscribe-project [options]",
    "  npm run import:timeline-project",
    "",
    "Options:",
    "  --bundle <directory>         Bundle directory that contains manifest.json",
    "                               If omitted in a TTY, browse from the current directory",
    "  --force                      Overwrite an existing project.json workspace file",
    "  --json                       Print the result as JSON",
    "  --help                       Show this help text",
  ].join("\n");
}

export function getExportTimelineProjectHelpText(): string {
  return [
    "Render a Timeline Studio workspace to MP4 from the terminal.",
    "",
    "Usage:",
    "  npm run export:timeline-project -- --project /path/to/project.clipscribe-project [options]",
    "  npm run export:timeline-project",
    "",
    "Options:",
    "  --project <directory|file>   Workspace directory or project.json file",
    "                               If omitted in a TTY, browse from the current directory",
    "  --output <file>              MP4 destination path (default: workspace exports/ folder)",
    "  --resolution <720p|1080p|4K> Export resolution (default: 1080p)",
    "  --dry-run                    Print the computed render plan without running ffmpeg",
    "  --force                      Overwrite an existing output file",
    "  --json                       Print the result as JSON",
    "  --help                       Show this help text",
  ].join("\n");
}

export function parseImportTimelineProjectArgs(args: readonly string[]): ParsedImportTimelineProjectArgs {
  const parsed: ParsedImportTimelineProjectArgs = {
    help: false,
    force: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    switch (token) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--bundle":
        parsed.bundlePath = readRequiredValue(args, index, token);
        index += 1;
        break;
      default:
        throw new Error(`Unknown flag "${token}". Use --help to see supported options.`);
    }
  }

  return parsed;
}

export function parseExportTimelineProjectArgs(args: readonly string[]): ParsedExportTimelineProjectArgs {
  const parsed: ParsedExportTimelineProjectArgs = {
    help: false,
    force: false,
    json: false,
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    switch (token) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--project":
        parsed.projectPath = readRequiredValue(args, index, token);
        index += 1;
        break;
      case "--output":
        parsed.outputPath = readRequiredValue(args, index, token);
        index += 1;
        break;
      case "--resolution": {
        const resolution = readRequiredValue(args, index, token);
        if (!VALID_EXPORT_RESOLUTIONS.includes(resolution as EditorResolution)) {
          throw new Error(`--resolution must be one of ${VALID_EXPORT_RESOLUTIONS.join(", ")}.`);
        }
        parsed.resolution = resolution as EditorResolution;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown flag "${token}". Use --help to see supported options.`);
    }
  }

  return parsed;
}

export function normalizeImportTimelineProjectOptions(
  parsed: ParsedImportTimelineProjectArgs,
  cwd = process.cwd()
): ImportTimelineProjectOptions {
  if (!parsed.bundlePath) {
    throw new Error("--bundle is required.");
  }

  return {
    bundlePath: path.resolve(cwd, normalizeCliPathInput(parsed.bundlePath, "--bundle")),
    force: parsed.force,
    json: parsed.json,
  };
}

export function normalizeExportTimelineProjectOptions(
  parsed: ParsedExportTimelineProjectArgs,
  cwd = process.cwd()
): ExportTimelineProjectOptions {
  if (!parsed.projectPath) {
    throw new Error("--project is required.");
  }

  return {
    projectPath: path.resolve(cwd, normalizeCliPathInput(parsed.projectPath, "--project")),
    outputPath: parsed.outputPath ? path.resolve(cwd, normalizeCliPathInput(parsed.outputPath, "--output")) : undefined,
    resolution: parsed.resolution ?? DEFAULT_EXPORT_RESOLUTION,
    dryRun: parsed.dryRun,
    force: parsed.force,
    json: parsed.json,
  };
}

export async function importTimelineProjectWorkspace(
  options: ImportTimelineProjectOptions,
  dependencies: ImportTimelineProjectDependencies = {}
): Promise<ImportedTimelineProjectWorkspaceResult> {
  emitCliProgress(dependencies.onProgress, {
    stage: "prepare",
    percent: 0,
    message: "Reading bundle manifest",
  });
  const bundlePath = path.resolve(options.bundlePath);
  const manifestPath = path.join(bundlePath, "manifest.json");
  await assertReadableFile(manifestPath, "Bundle manifest");

  const manifest = parseEditorProjectBundleManifest(await readFile(manifestPath, "utf8"));
  const expectedPaths = getEditorProjectBundleExpectedPaths(manifest);
  const mediaPaths = new Map<string, string>();
  const missingPaths: string[] = [];

  for (const bundleRelativePath of expectedPaths) {
    const absolutePath = resolveWorkspaceRelativePath(bundlePath, bundleRelativePath, `Bundle media path "${bundleRelativePath}"`);
    if (!(await pathExists(absolutePath))) {
      missingPaths.push(bundleRelativePath);
      continue;
    }
    mediaPaths.set(bundleRelativePath, absolutePath);
  }

  if (missingPaths.length > 0) {
    throw new Error(`The selected bundle is missing ${missingPaths.join(", ")}.`);
  }

  const now = dependencies.now?.() ?? Date.now();
  const probeMedia = dependencies.probeMedia ?? probeMediaFileWithFfprobe;
  const totalProbeCount = expectedPaths.length;
  let probedCount = 0;

  emitCliProgress(dependencies.onProgress, {
    stage: "prepare",
    percent: totalProbeCount === 0 ? 70 : 10,
    message: "Bundle verified",
  });
  const { project, assets, assetPathsById } = await materializeEditorProjectBundleWithResolver({
    manifest,
    now,
    resolveMedia: async (bundleRelativePath) => {
      const absolutePath = mediaPaths.get(bundleRelativePath);
      if (!absolutePath) {
        throw new Error(`Bundle media file "${bundleRelativePath}" is missing.`);
      }
      const result = await probeMedia(absolutePath);
      probedCount += 1;
      emitCliProgress(dependencies.onProgress, {
        stage: "probe",
        percent: 10 + (probedCount / Math.max(1, totalProbeCount)) * 75,
        message: `Probed ${probedCount}/${totalProbeCount} media file${totalProbeCount === 1 ? "" : "s"}`,
      });
      return result;
    },
  });

  const workspace = createEditorProjectWorkspace({
    project,
    assets,
    assetPathsById,
    createdAt: now,
  });

  const workspacePath = path.join(bundlePath, EDITOR_PROJECT_WORKSPACE_FILENAME);
  if (!options.force && (await pathExists(workspacePath))) {
    throw new Error(`Project workspace already exists: ${workspacePath}`);
  }

  emitCliProgress(dependencies.onProgress, {
    stage: "write",
    percent: 92,
    message: "Writing workspace file",
  });
  await writeWorkspaceFile(workspacePath, workspace);
  emitCliProgress(dependencies.onProgress, {
    stage: "done",
    percent: 100,
    message: "Workspace ready",
  });

  return {
    command: "import:timeline-project",
    bundlePath,
    workspacePath,
    projectId: workspace.project.id,
    name: workspace.project.name,
    clipCount: workspace.project.timeline.videoClips.length,
    assetCount: workspace.assets.length,
  };
}

export async function exportTimelineProjectWorkspace(
  options: ExportTimelineProjectOptions,
  dependencies: ExportTimelineProjectDependencies = {}
): Promise<ExportedTimelineProjectWorkspaceResult> {
  emitCliProgress(dependencies.onProgress, {
    stage: "prepare",
    percent: 0,
    message: "Loading workspace",
  });
  const { workspace, workspaceDirectory, workspacePath } = await loadWorkspaceFromDisk(options.projectPath);
  let resolvedOutputPath =
    options.outputPath ??
    getDefaultExportOutputPath(
      workspaceDirectory,
      workspace.project.name,
      workspace.project.aspectRatio,
      options.resolution
    );

  if (options.outputPath) {
    try {
      const stats = await stat(resolvedOutputPath);
      if (stats.isDirectory()) {
        resolvedOutputPath = path.join(
          resolvedOutputPath,
          buildEditorExportFilename(workspace.project.name, workspace.project.aspectRatio, options.resolution)
        );
      }
    } catch {
      // Path doesn't exist yet, which is fine for a file
    }
  }
  const exportProject = dependencies.exportProject ?? exportEditorProjectWithSystemFfmpeg;

  if (options.dryRun) {
    emitCliProgress(dependencies.onProgress, {
      stage: "prepare",
      percent: 35,
      message: "Resolving workspace assets",
    });
    const resolvedAssets = await resolveWorkspaceAssetsForExport(workspace, workspaceDirectory);
    emitCliProgress(dependencies.onProgress, {
      stage: "render",
      percent: 80,
      message: "Building render plan",
    });
    const result = await exportProject({
      project: workspace.project,
      assets: resolvedAssets,
      resolution: options.resolution,
      outputPath: resolvedOutputPath,
      overwrite: options.force,
      dryRun: true,
    });
    emitCliProgress(dependencies.onProgress, {
      stage: "done",
      percent: 100,
      message: "Plan ready",
    });

    return {
      command: "export:timeline-project",
      workspacePath,
      outputPath: result.outputPath,
      resolution: options.resolution,
      width: result.width,
      height: result.height,
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      warnings: result.warnings,
      dryRun: true,
      ffmpegCommandPreview: result.ffmpegCommandPreview,
    };
  }

  const startTime = dependencies.now?.() ?? Date.now();
  const exportingProject = markEditorProjectExporting(
    serializeEditorProjectForPersistence(workspace.project, workspace.project.timeline.playheadSeconds),
    startTime
  );
  emitCliProgress(dependencies.onProgress, {
    stage: "prepare",
    percent: 8,
    message: "Preparing workspace export state",
  });
  await writeWorkspaceFile(workspacePath, {
    ...workspace,
    project: exportingProject,
  });

  try {
    emitCliProgress(dependencies.onProgress, {
      stage: "prepare",
      percent: 14,
      message: "Resolving workspace assets",
    });
    const resolvedAssets = await resolveWorkspaceAssetsForExport(workspace, workspaceDirectory);
    const result = await exportProject({
      project: exportingProject,
      assets: resolvedAssets,
      resolution: options.resolution,
      outputPath: resolvedOutputPath,
      overwrite: options.force,
      onProgress: (progress) => {
        emitCliProgress(dependencies.onProgress, {
          stage: "render",
          percent: 18 + progress.percent * 0.76,
          message: `Rendering ${Math.round(progress.percent)}%`,
        });
      },
    });

    const completedAt = dependencies.now?.() ?? Date.now();
    const exportRecord = buildEditorExportRecord({
      projectId: exportingProject.id,
      engine: "system",
      filename: result.filename,
      mimeType: "video/mp4",
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      aspectRatio: exportingProject.aspectRatio,
      resolution: options.resolution,
      width: result.width,
      height: result.height,
      warnings: result.warnings,
      debugFfmpegCommand: result.ffmpegCommandPreview,
      debugNotes: result.notes,
      createdAt: completedAt,
    });
    const nextProject: EditorProjectRecord = markEditorProjectSaved(
      {
        ...exportingProject,
        latestExport: {
          id: exportRecord.id,
          createdAt: exportRecord.createdAt,
          filename: exportRecord.filename,
          aspectRatio: exportRecord.aspectRatio,
          resolution: exportRecord.resolution,
          engine: exportRecord.engine,
          status: exportRecord.status,
        },
        lastError: undefined,
      },
      completedAt
    );
    emitCliProgress(dependencies.onProgress, {
      stage: "write",
      percent: 96,
      message: "Writing export metadata",
    });
    await writeWorkspaceFile(workspacePath, {
      ...workspace,
      project: nextProject,
    });
    emitCliProgress(dependencies.onProgress, {
      stage: "done",
      percent: 100,
      message: "Export complete",
    });

    return {
      command: "export:timeline-project",
      workspacePath,
      outputPath: result.outputPath,
      resolution: options.resolution,
      width: result.width,
      height: result.height,
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      warnings: result.warnings,
      dryRun: false,
      ffmpegCommandPreview: result.ffmpegCommandPreview,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedProject = markEditorProjectFailed(exportingProject, message, dependencies.now?.() ?? Date.now());
    await writeWorkspaceFile(workspacePath, {
      ...workspace,
      project: failedProject,
    });
    throw error;
  }
}
