import path from "node:path";

import {
  normalizeCliPathInput,
  normalizeCreateTimelineProjectBundleCliInput,
  parseCreateTimelineProjectBundleArgs,
  type CreateTimelineProjectBundleOptions,
  type ParsedCreateTimelineProjectBundleCliInput,
} from "./bundle-cli";
import {
  createTimelineProjectBundle,
  promptCreateTimelineProjectBundleOptions,
  type CreateTimelineProjectBundleDependencies,
  type CreateTimelineProjectBundlePromptApi,
  type CreatedTimelineProjectBundleResult,
} from "./create-bundle-cli";
import {
  promptConfirmValue,
  promptForExportResolution,
  promptNumberValue,
  promptSelectValue,
  promptTextValue,
} from "./node-interactive";
import type { EditorResolution } from "./types";
import {
  exportTimelineProjectWorkspace,
  importTimelineProjectWorkspace,
  type ExportTimelineProjectDependencies,
  type ExportTimelineProjectOptions,
  type ExportedTimelineProjectWorkspaceResult,
  type ImportTimelineProjectDependencies,
  type ImportedTimelineProjectWorkspaceResult,
} from "./workspace-cli";

const DEFAULT_EXPORT_RESOLUTION: EditorResolution = "1080p";
const VALID_EXPORT_RESOLUTIONS: EditorResolution[] = ["720p", "1080p", "4K"];

export interface ParsedCreateAndExportTimelineProjectArgs extends ParsedCreateTimelineProjectBundleCliInput {
  force: boolean;
  json: boolean;
  dryRun: boolean;
  exportOutputPath?: string;
  resolution?: EditorResolution;
}

export interface CreateAndExportTimelineProjectOptions {
  create: CreateTimelineProjectBundleOptions;
  exportOutputPath?: string;
  resolution: EditorResolution;
  dryRun: boolean;
  force: boolean;
  json: boolean;
}

export interface CreateAndExportTimelineProjectResult {
  command: "create-and-export:timeline-project";
  bundlePath: string;
  workspacePath: string;
  outputPath: string;
  resolution: EditorResolution;
  clipCount: number;
  assetCount: number;
  warnings: string[];
  dryRun: boolean;
}

export interface CreateAndExportTimelineProjectProgressUpdate {
  stage: "create" | "import" | "export" | "done";
  message: string;
  percent: number;
}

export interface CreateAndExportTimelineProjectDependencies {
  isInteractive?: boolean;
  promptApi?: CreateTimelineProjectBundlePromptApi & {
    promptForExportResolution?: (fallback: EditorResolution) => Promise<EditorResolution>;
  };
  now?: () => number;
  onProgress?: (update: CreateAndExportTimelineProjectProgressUpdate) => void;
  createBundle?: (
    options: CreateTimelineProjectBundleOptions,
    dependencies?: CreateTimelineProjectBundleDependencies
  ) => Promise<CreatedTimelineProjectBundleResult>;
  createBundleDependencies?: Omit<CreateTimelineProjectBundleDependencies, "now" | "onProgress">;
  importWorkspace?: (
    options: Parameters<typeof importTimelineProjectWorkspace>[0],
    dependencies?: ImportTimelineProjectDependencies
  ) => Promise<ImportedTimelineProjectWorkspaceResult>;
  importWorkspaceDependencies?: Omit<ImportTimelineProjectDependencies, "now" | "onProgress">;
  exportWorkspace?: (
    options: ExportTimelineProjectOptions,
    dependencies?: ExportTimelineProjectDependencies
  ) => Promise<ExportedTimelineProjectWorkspaceResult>;
  exportWorkspaceDependencies?: Omit<ExportTimelineProjectDependencies, "now" | "onProgress">;
}

type ResolvedCreateAndExportPromptApi = CreateTimelineProjectBundlePromptApi & {
  promptForExportResolution: (fallback: EditorResolution) => Promise<EditorResolution>;
};

function readRequiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mapPercentToRange(percent: number, start: number, end: number): number {
  return start + (clampNumber(percent, 0, 100) / 100) * (end - start);
}

function emitProgress(
  callback: CreateAndExportTimelineProjectDependencies["onProgress"] | undefined,
  update: CreateAndExportTimelineProjectProgressUpdate
) {
  callback?.({
    ...update,
    percent: Math.round(clampNumber(update.percent, 0, 100)),
  });
}

function hasTTY(isInteractive = process.stdin.isTTY && process.stdout.isTTY): boolean {
  return Boolean(isInteractive);
}

function buildInteractiveOnlyError(parsed: ParsedCreateAndExportTimelineProjectArgs): string {
  if (parsed.interactive) {
    return "The create-and-export wizard requires a TTY. Re-run in an interactive terminal or provide flags.";
  }
  if (parsed.videoPaths.length === 0) {
    return parsed.json
      ? "At least one --video path is required when using --json."
      : "At least one --video path is required when prompts are unavailable.";
  }
  return "Interactive prompts are unavailable in this terminal.";
}

function getPromptApi(
  promptApi: CreateAndExportTimelineProjectDependencies["promptApi"]
): ResolvedCreateAndExportPromptApi {
  return {
    promptTextValue: promptApi?.promptTextValue ?? promptTextValue,
    promptConfirmValue: promptApi?.promptConfirmValue ?? promptConfirmValue,
    promptNumberValue: promptApi?.promptNumberValue ?? promptNumberValue,
    promptSelectValue: promptApi?.promptSelectValue ?? promptSelectValue,
    promptForExportResolution: promptApi?.promptForExportResolution ?? promptForExportResolution,
  };
}

export function getCreateAndExportTimelineProjectHelpText(): string {
  return [
    "Create a Timeline Studio bundle, import it into a workspace, and export an MP4 in one run.",
    "",
    "Usage:",
    "  npm run create-and-export:timeline-project -- --video /path/to/a.mp4 --output ./exports [options]",
    "  npm run create-and-export:timeline-project",
    "",
    "Create options:",
    "  --interactive                Force the full prompt-based wizard",
    "  --name <value>               Project name",
    "  --aspect <16:9|9:16|1:1|4:5> Output aspect ratio",
    "  --video <path>               Add a video clip in sequence order (repeatable)",
    "  --audio <path>               Add one optional top-level audio track",
    "  --reverse <index>            Reverse the given 1-based video clip index (repeatable)",
    "  --video-trim <i:start:end>   Override one clip trim window (repeatable)",
    "  --video-volume <i:volume>    Override one clip volume from 0 to 1 (repeatable)",
    "  --video-muted <index>        Mute the given 1-based video clip index (repeatable)",
    "  --audio-trim <start:end>     Trim the optional audio item",
    "  --audio-start <seconds>      Audio start offset in project time",
    "  --audio-volume <0-1>         Audio item volume",
    "  --audio-muted                Mute the optional audio item",
    "  --output <directory>         Destination parent directory for the generated bundle",
    "",
    "Export options:",
    "  --resolution <720p|1080p|4K> Export resolution (default: 1080p)",
    "  --export-output <file>       Final MP4 destination path",
    "  --dry-run                    Build the render plan without running ffmpeg",
    "  --force                      Overwrite existing workspace/output files",
    "  --json                       Print the result as JSON and never open prompts",
    "  --help                       Show this help text",
  ].join("\n");
}

export function parseCreateAndExportTimelineProjectArgs(
  args: readonly string[]
): ParsedCreateAndExportTimelineProjectArgs {
  const createArgs: string[] = [];
  let help = false;
  let force = false;
  let json = false;
  let dryRun = false;
  let resolution: EditorResolution | undefined;
  let exportOutputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    switch (token) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--force":
        force = true;
        break;
      case "--json":
        json = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--resolution": {
        const value = readRequiredValue(args, index, token);
        if (!VALID_EXPORT_RESOLUTIONS.includes(value as EditorResolution)) {
          throw new Error(`--resolution must be one of ${VALID_EXPORT_RESOLUTIONS.join(", ")}.`);
        }
        resolution = value as EditorResolution;
        index += 1;
        break;
      }
      case "--export-output":
        exportOutputPath = readRequiredValue(args, index, token);
        index += 1;
        break;
      default:
        createArgs.push(token);
        if (
          [
            "--name",
            "--aspect",
            "--output",
            "--video",
            "--audio",
            "--reverse",
            "--video-trim",
            "--video-volume",
            "--video-muted",
            "--audio-trim",
            "--audio-start",
            "--audio-volume",
          ].includes(token)
        ) {
          const value = args[index + 1];
          if (!value) {
            throw new Error(`${token} requires a value.`);
          }
          createArgs.push(value);
          index += 1;
        }
        break;
    }
  }

  const parsedCreateInput = parseCreateTimelineProjectBundleArgs(createArgs);
  return {
    ...parsedCreateInput,
    help: parsedCreateInput.help || help,
    force,
    json,
    dryRun,
    resolution,
    exportOutputPath,
  };
}

export async function prepareCreateAndExportTimelineProjectOptions(
  parsed: ParsedCreateAndExportTimelineProjectArgs,
  cwd = process.cwd(),
  dependencies: Omit<
    CreateAndExportTimelineProjectDependencies,
    | "createBundle"
    | "createBundleDependencies"
    | "importWorkspace"
    | "importWorkspaceDependencies"
    | "exportWorkspace"
    | "exportWorkspaceDependencies"
    | "onProgress"
    | "now"
  > = {}
): Promise<CreateAndExportTimelineProjectOptions> {
  if (parsed.json && parsed.interactive) {
    throw new Error("--json cannot be combined with --interactive because prompts are disabled.");
  }

  const promptApi = getPromptApi(dependencies.promptApi);
  const interactive = hasTTY(dependencies.isInteractive);
  const canPrompt = !parsed.json && interactive;
  const baseCreateOptions = normalizeCreateTimelineProjectBundleCliInput(
    { ...parsed, interactive: true },
    cwd
  );

  if (parsed.videoPaths.length === 0 && !canPrompt) {
    throw new Error(buildInteractiveOnlyError(parsed));
  }
  if (parsed.interactive && !canPrompt) {
    throw new Error(buildInteractiveOnlyError(parsed));
  }

  let resolution = parsed.resolution ?? DEFAULT_EXPORT_RESOLUTION;
  let exportOutputPath = parsed.exportOutputPath
    ? path.resolve(cwd, normalizeCliPathInput(parsed.exportOutputPath, "--export-output"))
    : undefined;
  let createOptions = {
    ...baseCreateOptions,
    interactive: parsed.interactive,
  };

  if (!canPrompt) {
    if (createOptions.videoClips.length === 0) {
      throw new Error(buildInteractiveOnlyError(parsed));
    }
    return {
      create: createOptions,
      exportOutputPath,
      resolution,
      dryRun: parsed.dryRun,
      force: parsed.force,
      json: parsed.json,
    };
  }

  if (parsed.interactive || parsed.resolution == null) {
    resolution = await promptApi.promptForExportResolution(resolution);
  }

  if (parsed.interactive || parsed.exportOutputPath == null) {
    const useDefaultExportOutput = await promptApi.promptConfirmValue({
      message: "Use the default MP4 destination inside the generated workspace exports folder?",
      initial: exportOutputPath == null,
    });
    if (useDefaultExportOutput) {
      exportOutputPath = undefined;
    } else {
      exportOutputPath = path.resolve(
        cwd,
        normalizeCliPathInput(
          await promptApi.promptTextValue({
            message: "Final MP4 output path",
            initial: exportOutputPath ?? "",
            validate: (value) => (value.trim() ? true : "Final MP4 output path is required."),
          }),
          "Final MP4 output path"
        )
      );
    }
  }

  if (parsed.interactive || parsed.outputDirectory == null) {
    createOptions = {
      ...createOptions,
      outputDirectory: normalizeCliPathInput(
        await promptApi.promptTextValue({
          message: "Output directory",
          initial: createOptions.outputDirectory,
          validate: (value) => (value.trim() ? true : "Output directory is required."),
        }),
        "Output directory"
      ),
    };
  }

  createOptions = await promptCreateTimelineProjectBundleOptions(createOptions, {
    parsedInput: parsed,
    mode: parsed.interactive ? "full" : "missing-only",
    includeOutputDirectoryPrompt: false,
    promptApi,
  });

  return {
    create: createOptions,
    exportOutputPath,
    resolution,
    dryRun: parsed.dryRun,
    force: parsed.force,
    json: parsed.json,
  };
}

export async function createAndExportTimelineProject(
  options: CreateAndExportTimelineProjectOptions,
  dependencies: CreateAndExportTimelineProjectDependencies = {}
): Promise<CreateAndExportTimelineProjectResult> {
  const createBundleFn = dependencies.createBundle ?? createTimelineProjectBundle;
  const importWorkspaceFn = dependencies.importWorkspace ?? importTimelineProjectWorkspace;
  const exportWorkspaceFn = dependencies.exportWorkspace ?? exportTimelineProjectWorkspace;

  emitProgress(dependencies.onProgress, {
    stage: "create",
    percent: 0,
    message: "Creating bundle",
  });
  const createdBundle = await createBundleFn(options.create, {
    ...dependencies.createBundleDependencies,
    now: dependencies.now,
    onProgress: (update) => {
      emitProgress(dependencies.onProgress, {
        stage: "create",
        percent: mapPercentToRange(update.percent, 0, 25),
        message: update.message,
      });
    },
  });

  const importedWorkspace = await importWorkspaceFn(
    {
      bundlePath: createdBundle.bundlePath,
      force: options.force,
      json: options.json,
    },
    {
      ...dependencies.importWorkspaceDependencies,
      now: dependencies.now,
      onProgress: (update) => {
        emitProgress(dependencies.onProgress, {
          stage: "import",
          percent: mapPercentToRange(update.percent, 25, 55),
          message: update.message,
        });
      },
    }
  );

  const exportedProject = await exportWorkspaceFn(
    {
      projectPath: importedWorkspace.workspacePath,
      outputPath: options.exportOutputPath,
      resolution: options.resolution,
      dryRun: options.dryRun,
      force: options.force,
      json: options.json,
    },
    {
      ...dependencies.exportWorkspaceDependencies,
      now: dependencies.now,
      onProgress: (update) => {
        emitProgress(dependencies.onProgress, {
          stage: "export",
          percent: mapPercentToRange(update.percent, 55, 100),
          message: update.message,
        });
      },
    }
  );

  emitProgress(dependencies.onProgress, {
    stage: "done",
    percent: 100,
    message: exportedProject.dryRun ? "Export plan ready" : "Export complete",
  });

  return {
    command: "create-and-export:timeline-project",
    bundlePath: createdBundle.bundlePath,
    workspacePath: importedWorkspace.workspacePath,
    outputPath: exportedProject.outputPath,
    resolution: exportedProject.resolution,
    clipCount: importedWorkspace.clipCount,
    assetCount: importedWorkspace.assetCount,
    warnings: exportedProject.warnings,
    dryRun: exportedProject.dryRun,
  };
}
