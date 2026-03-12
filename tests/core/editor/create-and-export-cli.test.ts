import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAndExportTimelineProject,
  parseCreateAndExportTimelineProjectArgs,
  prepareCreateAndExportTimelineProjectOptions,
} from "../../../src/lib/editor/create-and-export-cli";
import { parseEditorProjectWorkspace } from "../../../src/lib/editor/workspace";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-create-export-test-"));
}

test("create-and-export parsing keeps bundle output and export output separate", async () => {
  const parsed = parseCreateAndExportTimelineProjectArgs([
    "--name",
    "Launch Cut",
    "--aspect",
    "9:16",
    "--video",
    "./media/intro.mp4",
    "--output",
    "./bundles",
    "--resolution",
    "720p",
    "--export-output",
    "./final.mp4",
    "--force",
  ]);

  const options = await prepareCreateAndExportTimelineProjectOptions(parsed, "/repo", {
    isInteractive: false,
  });

  assert.equal(options.create.outputDirectory, "./bundles");
  assert.equal(options.exportOutputPath, "/repo/final.mp4");
  assert.equal(options.resolution, "720p");
  assert.equal(options.force, true);
});

test("create-and-export preparation rejects missing video paths in json mode", async () => {
  const parsed = parseCreateAndExportTimelineProjectArgs(["--json"]);

  await assert.rejects(
    () =>
      prepareCreateAndExportTimelineProjectOptions(parsed, "/repo", {
        isInteractive: true,
      }),
    /At least one --video path is required when using --json/
  );
});

test("interactive create-and-export prompts ask export settings before create fields", async () => {
  const messages: string[] = [];
  const parsed = parseCreateAndExportTimelineProjectArgs(["--interactive"]);

  await prepareCreateAndExportTimelineProjectOptions(parsed, "/repo", {
    isInteractive: true,
    promptApi: {
      promptForExportResolution: async (fallback) => {
        messages.push("Export resolution");
        return fallback;
      },
      promptTextValue: async ({ message, initial }) => {
        messages.push(message);
        switch (message) {
          case "Output directory":
            return "./exports";
          case "Project name":
            return "Interactive Flow";
          case "Video clip 1 path":
            return "/repo/source.mp4";
          case "Label":
            return "Clip One";
          case "Optional audio file path (leave blank to skip)":
            return "";
          default:
            return initial ?? "";
        }
      },
      promptConfirmValue: async ({ message }) => {
        messages.push(message);
        if (message === "Add another video clip?") return false;
        return true;
      },
      promptNumberValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptSelectValue: async <T>({ message, choices, initial }: { message: string; choices: Array<{ value: T }>; initial?: T }) => {
        messages.push(message);
        return (initial ?? choices[0]?.value) as T;
      },
    },
  });

  assert.deepEqual(messages.slice(0, 4), [
    "Export resolution",
    "Use the default MP4 destination inside the generated workspace exports folder?",
    "Output directory",
    "Project name",
  ]);
  assert.ok(messages.indexOf("Aspect ratio") > messages.indexOf("Project name"));
  assert.ok(messages.indexOf("Video clip 1 path") > messages.indexOf("Aspect ratio"));
});

test("hybrid create-and-export prompting only asks for missing values", async () => {
  const messages: string[] = [];
  const parsed = parseCreateAndExportTimelineProjectArgs([
    "--name",
    "Hybrid",
    "--video",
    "/repo/already-set.mp4",
    "--output",
    "./bundles",
    "--resolution",
    "720p",
  ]);

  const options = await prepareCreateAndExportTimelineProjectOptions(parsed, "/repo", {
    isInteractive: true,
    promptApi: {
      promptForExportResolution: async (fallback) => {
        messages.push("Export resolution");
        return fallback;
      },
      promptTextValue: async ({ message }) => {
        messages.push(message);
        if (message === "Optional audio file path (leave blank to skip)") {
          return "";
        }
        return "./unused";
      },
      promptConfirmValue: async ({ message }) => {
        messages.push(message);
        return true;
      },
      promptNumberValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptSelectValue: async <T>({ message, choices, initial }: { message: string; choices: Array<{ value: T }>; initial?: T }) => {
        messages.push(message);
        return (initial ?? choices[0]?.value) as T;
      },
    },
  });

  assert.equal(options.create.name, "Hybrid");
  assert.equal(options.create.videoClips.length, 1);
  assert.deepEqual(messages, [
    "Use the default MP4 destination inside the generated workspace exports folder?",
    "Aspect ratio",
    "Optional audio file path (leave blank to skip)",
  ]);
  assert.ok(!messages.includes("Project name"));
  assert.ok(!messages.includes("Label"));
  assert.ok(!messages.includes("Clip volume"));
});

test("create-and-export runs the full bundle to workspace to export pipeline and keeps intermediates", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const sourceVideoPath = path.join(tempDir, "source.mp4");
  await writeFile(sourceVideoPath, "video", "utf8");

  const exportOutputPath = path.join(tempDir, "final.mp4");
  const parsed = parseCreateAndExportTimelineProjectArgs([
    "--name",
    "Pipeline Demo",
    "--aspect",
    "9:16",
    "--video",
    sourceVideoPath,
    "--output",
    tempDir,
    "--resolution",
    "720p",
    "--export-output",
    exportOutputPath,
    "--force",
  ]);
  const options = await prepareCreateAndExportTimelineProjectOptions(parsed, tempDir, {
    isInteractive: false,
  });

  const progress: Array<{ stage: string; percent: number }> = [];
  const result = await createAndExportTimelineProject(options, {
    now: () => 1000,
    onProgress: (update) => {
      progress.push({ stage: update.stage, percent: update.percent });
    },
    importWorkspaceDependencies: {
      probeMedia: async () => ({
        kind: "video",
        filename: "source.mp4",
        mimeType: "video/mp4",
        sizeBytes: 128,
        durationSeconds: 6,
        width: 1080,
        height: 1920,
        hasAudio: true,
      }),
    },
    exportWorkspaceDependencies: {
      exportProject: async (input) => {
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, "mp4", "utf8");
        input.onProgress?.({
          percent: 50,
          processedSeconds: 3,
          durationSeconds: 6,
        });
        return {
          outputPath: input.outputPath,
          filename: path.basename(input.outputPath),
          width: 720,
          height: 1280,
          sizeBytes: 3,
          durationSeconds: 6,
          warnings: ["warn"],
          ffmpegCommandPreview: ["ffmpeg", "-i", "source.mp4"],
          notes: ["done"],
          dryRun: false,
        };
      },
    },
  });

  await access(result.bundlePath);
  await access(path.join(result.bundlePath, "manifest.json"));
  await access(path.join(result.bundlePath, "project.json"));
  await access(exportOutputPath);

  const workspace = parseEditorProjectWorkspace(await readFile(path.join(result.bundlePath, "project.json"), "utf8"));
  assert.equal(workspace.project.name, "Pipeline Demo");
  assert.equal(result.command, "create-and-export:timeline-project");
  assert.equal(result.clipCount, 1);
  assert.equal(result.assetCount, 1);
  assert.equal(result.outputPath, exportOutputPath);
  assert.deepEqual(result.warnings, ["warn"]);
  assert.ok(progress.some((entry) => entry.stage === "create" && entry.percent <= 25));
  assert.ok(progress.some((entry) => entry.stage === "import" && entry.percent >= 25 && entry.percent <= 55));
  assert.ok(progress.some((entry) => entry.stage === "export" && entry.percent >= 55));
  assert.equal(progress.at(-1)?.percent, 100);
});

test("create-and-export leaves bundle and workspace on disk when export fails", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const sourceVideoPath = path.join(tempDir, "source.mp4");
  await writeFile(sourceVideoPath, "video", "utf8");

  const parsed = parseCreateAndExportTimelineProjectArgs([
    "--name",
    "Pipeline Failure",
    "--aspect",
    "16:9",
    "--video",
    sourceVideoPath,
    "--output",
    tempDir,
    "--resolution",
    "1080p",
    "--force",
  ]);
  const options = await prepareCreateAndExportTimelineProjectOptions(parsed, tempDir, {
    isInteractive: false,
  });

  await assert.rejects(
    () =>
      createAndExportTimelineProject(options, {
        now: () => 2000,
        importWorkspaceDependencies: {
          probeMedia: async () => ({
            kind: "video",
            filename: "source.mp4",
            mimeType: "video/mp4",
            sizeBytes: 256,
            durationSeconds: 4,
            width: 1920,
            height: 1080,
            hasAudio: true,
          }),
        },
        exportWorkspaceDependencies: {
          exportProject: async () => {
            throw new Error("renderer failed");
          },
        },
      }),
    /renderer failed/
  );

  const bundlePath = path.join(tempDir, "pipeline-failure.clipscribe-project");
  await access(path.join(bundlePath, "manifest.json"));
  await access(path.join(bundlePath, "project.json"));
});
