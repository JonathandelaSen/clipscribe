import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportEditorProjectWithSystemFfmpeg } from "../../../src/lib/editor/node-render";
import { createDefaultVideoClip, createEditorAssetRecord, createEmptyEditorProject } from "../../../src/lib/editor/storage";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-node-render-test-"));
}

function createRenderableProject() {
  const project = createEmptyEditorProject({
    id: "render_project",
    now: 100,
    name: "Render Me",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 128,
    durationSeconds: 5,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "render_asset",
    now: 100,
  });
  const clip = createDefaultVideoClip({
    assetId: asset.id,
    label: "Clip",
    durationSeconds: 5,
  });
  clip.actions.reverse = true;
  project.assetIds = [asset.id];
  project.timeline.videoClips = [clip];
  return { project, asset };
}

test("exportEditorProjectWithSystemFfmpeg returns render details after a successful mocked ffmpeg run", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { project, asset } = createRenderableProject();
  const outputPath = path.join(tempDir, "exports", "render.mp4");

  const result = await exportEditorProjectWithSystemFfmpeg({
    project,
    assets: [{ asset, absolutePath: "/media/clip.mp4" }],
    resolution: "1080p",
    outputPath,
    overwrite: true,
    commandRunner: async (command, args) => {
      assert.equal(command, "ffmpeg");
      assert.ok(args.includes("-filter_complex"));
      assert.ok(args.includes(outputPath));
      await writeFile(outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.sizeBytes, 2048);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.ok(result.ffmpegCommandPreview.includes("ffmpeg"));
});

test("exportEditorProjectWithSystemFfmpeg emits progress callbacks when rendering succeeds", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { project, asset } = createRenderableProject();
  const outputPath = path.join(tempDir, "exports", "render.mp4");
  const percents: number[] = [];

  await exportEditorProjectWithSystemFfmpeg({
    project,
    assets: [{ asset, absolutePath: "/media/clip.mp4" }],
    resolution: "1080p",
    outputPath,
    overwrite: true,
    onProgress: (progress) => {
      percents.push(Math.round(progress.percent));
    },
    commandRunner: async () => {
      await writeFile(outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.equal(percents[0], 0);
  assert.equal(percents[percents.length - 1], 100);
});

test("exportEditorProjectWithSystemFfmpeg falls back to the bundled binary when ffmpeg is missing on PATH", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { project, asset } = createRenderableProject();
  const outputPath = path.join(tempDir, "exports", "render.mp4");
  const attemptedCommands: string[] = [];

  const result = await exportEditorProjectWithSystemFfmpeg({
    project,
    assets: [{ asset, absolutePath: "/media/clip.mp4" }],
    resolution: "1080p",
    outputPath,
    overwrite: true,
    ffmpegPath: "/mock/bin/ffmpeg",
    commandRunner: async (command) => {
      attemptedCommands.push(command);
      if (command === "ffmpeg") {
        const error = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      await writeFile(outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.deepEqual(attemptedCommands, ["ffmpeg", "/mock/bin/ffmpeg"]);
  assert.equal(result.sizeBytes, 2048);
});

test("exportEditorProjectWithSystemFfmpeg fails clearly when ffmpeg is missing", async () => {
  const { project, asset } = createRenderableProject();

  await assert.rejects(
    () =>
      exportEditorProjectWithSystemFfmpeg({
        project,
        assets: [{ asset, absolutePath: "/media/clip.mp4" }],
        resolution: "1080p",
        outputPath: "/tmp/render.mp4",
        ffmpegPath: "",
        commandRunner: async () => {
          const error = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
      }),
    /ffmpeg is required to export timeline projects/
  );
});

test("exportEditorProjectWithSystemFfmpeg surfaces ffmpeg stderr on render failures", async () => {
  const { project, asset } = createRenderableProject();

  await assert.rejects(
    () =>
      exportEditorProjectWithSystemFfmpeg({
        project,
        assets: [{ asset, absolutePath: "/media/clip.mp4" }],
        resolution: "1080p",
        outputPath: "/tmp/render.mp4",
        commandRunner: async () => ({
          code: 1,
          stdout: "",
          stderr: "line one\nline two\nfatal error",
        }),
      }),
    /fatal error/
  );
});

test("exportEditorProjectWithSystemFfmpeg rejects empty output files", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { project, asset } = createRenderableProject();
  const outputPath = path.join(tempDir, "exports", "render.mp4");

  await assert.rejects(
    () =>
      exportEditorProjectWithSystemFfmpeg({
        project,
        assets: [{ asset, absolutePath: "/media/clip.mp4" }],
        resolution: "1080p",
        outputPath,
        overwrite: true,
        commandRunner: async () => {
          await writeFile(outputPath, Buffer.alloc(16, 1));
          return {
            code: 0,
            stdout: "",
            stderr: "",
          };
        },
      }),
    /Rendered output is empty/
  );
});
