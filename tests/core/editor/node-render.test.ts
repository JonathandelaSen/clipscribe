import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildNodeEditorExportCommand,
  exportEditorProjectWithSystemFfmpeg,
} from "../../../src/lib/editor/node-render";
import {
  createDefaultAudioTrack,
  createDefaultImageTrackItem,
  createDefaultVideoClip,
  createEditorAssetRecord,
  createEmptyEditorProject,
} from "../../../src/lib/editor/storage";

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

function createImageOnlyRenderableProject(input: { withAudio: boolean }) {
  const project = createEmptyEditorProject({
    id: input.withAudio ? "image_audio_project" : "image_only_project",
    now: 200,
    name: input.withAudio ? "Image + Audio" : "Image Only",
    aspectRatio: "16:9",
  });
  const image = createEditorAssetRecord({
    projectId: project.id,
    kind: "image",
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 64,
    durationSeconds: 0,
    width: 1920,
    height: 1080,
    hasAudio: false,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: `${project.id}_image`,
    now: 200,
  });

  project.assetIds = [image.id];
  project.timeline.imageItems = [createDefaultImageTrackItem({ assetId: image.id, label: "Cover" })];

  const assets: Array<{ asset: typeof image; absolutePath: string }> = [
    { asset: image, absolutePath: "/media/cover.png" },
  ];

  if (input.withAudio) {
    const audio = createEditorAssetRecord({
      projectId: project.id,
      kind: "audio",
      filename: "bed.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: 64,
      durationSeconds: 12,
      hasAudio: true,
      sourceType: "upload",
      captionSource: { kind: "none" },
      id: `${project.id}_audio`,
      now: 200,
    });
    project.assetIds.push(audio.id);
    project.timeline.audioItems = [createDefaultAudioTrack({ assetId: audio.id, durationSeconds: 12 })];
    assets.push({ asset: audio, absolutePath: "/media/bed.mp3" });
  }

  return { project, assets };
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

test("exportEditorProjectWithSystemFfmpeg injects ASS burn-in when the global subtitle track is active", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { project, asset } = createRenderableProject();
  project.subtitles = {
    ...project.subtitles,
    source: {
      kind: "uploaded-srt",
    },
    label: "subs.srt",
    chunks: [{ text: "Hello world", timestamp: [0, 1.5] }],
    trimEndSeconds: 1.5,
  };
  const outputPath = path.join(tempDir, "exports", "render.mp4");

  await exportEditorProjectWithSystemFfmpeg({
    project,
    assets: [{ asset, absolutePath: "/media/clip.mp4" }],
    resolution: "1080p",
    outputPath,
    overwrite: true,
    commandRunner: async (_command, args) => {
      const filterIndex = args.indexOf("-filter_complex");
      assert.ok(filterIndex >= 0);
      assert.match(args[filterIndex + 1] ?? "", /ass='/);
      await writeFile(outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
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

test("buildNodeEditorExportCommand uses the still-image compatibility preset for image-only timelines with audio", () => {
  const { project, assets } = createImageOnlyRenderableProject({ withAudio: true });

  const command = buildNodeEditorExportCommand({
    project,
    assets,
    resolution: "1080p",
    outputPath: "/tmp/image-audio.mp4",
    overwrite: true,
  });

  assert.deepEqual(command.ffmpegArgs.slice(0, 6), ["-y", "-loop", "1", "-framerate", "30", "-i"]);
  assert.ok(command.ffmpegArgs.includes("-r"));
  assert.ok(command.ffmpegArgs.includes("30"));
  assert.ok(command.ffmpegArgs.includes("-tune"));
  assert.ok(command.ffmpegArgs.includes("stillimage"));
  assert.ok(command.ffmpegArgs.includes("-pix_fmt"));
  assert.ok(command.ffmpegArgs.includes("yuv420p"));
  assert.ok(command.ffmpegArgs.includes("-shortest"));
  assert.ok(command.ffmpegArgs.includes("+faststart"));
  assert.ok(command.ffmpegArgs.includes("-t"));
  assert.ok(command.ffmpegArgs.includes("12.000"));
  assert.match(command.notes.join("\n"), /Still-image compatibility preset enabled/);
});

test("buildNodeEditorExportCommand composes reactive overlays before subtitle burn-in", () => {
  const { project, asset } = createRenderableProject();

  const command = buildNodeEditorExportCommand({
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        overlayItems: [
          {
            id: "overlay_1",
            presetId: "waveform_line",
            startOffsetSeconds: 0,
            durationSeconds: 3,
            positionXPercent: 50,
            positionYPercent: 72,
            widthPercent: 72,
            heightPercent: 18,
            scale: 1,
            opacity: 0.9,
            tintHex: "#7CE7FF",
            sensitivity: 1,
            smoothing: 0.6,
          },
        ],
      },
    },
    assets: [{ asset, absolutePath: "/media/clip.mp4" }],
    overlays: [
      {
        absolutePath: "/media/overlay_atlas.png",
        start: 0,
        end: 3,
        x: 120,
        y: 980,
        width: 800,
        height: 240,
        cropExpression: "between(t,0.000,0.033)*240",
      },
    ],
    resolution: "1080p",
    outputPath: "/tmp/render.mp4",
    subtitleTrackPath: "/tmp/render.ass",
  });

  const filterIndex = command.ffmpegArgs.indexOf("-filter_complex");
  assert.ok(filterIndex >= 0);
  const filterGraph = command.ffmpegArgs[filterIndex + 1] ?? "";
  assert.match(filterGraph, /\[1:v\]setpts=PTS-STARTPTS\[overlay_input_0\]/);
  assert.match(filterGraph, /\[video_track\]\[overlay_crop_0\]overlay=/);
  assert.match(filterGraph, /\[overlay_0\]ass='/);
  assert.ok(command.notes.some((note) => note.includes("Reactive overlay items=1")));
});

test("buildNodeEditorExportCommand keeps the still-image compatibility preset for image-only timelines without audio", () => {
  const { project, assets } = createImageOnlyRenderableProject({ withAudio: false });

  const command = buildNodeEditorExportCommand({
    project,
    assets,
    resolution: "1080p",
    outputPath: "/tmp/image-only.mp4",
    overwrite: true,
  });

  assert.deepEqual(command.ffmpegArgs.slice(0, 6), ["-y", "-loop", "1", "-framerate", "30", "-i"]);
  assert.ok(command.ffmpegArgs.includes("-r"));
  assert.ok(command.ffmpegArgs.includes("-tune"));
  assert.ok(command.ffmpegArgs.includes("stillimage"));
  assert.ok(command.ffmpegArgs.includes("-pix_fmt"));
  assert.ok(command.ffmpegArgs.includes("yuv420p"));
  assert.ok(command.ffmpegArgs.includes("-t"));
  assert.ok(command.ffmpegArgs.includes("5.000"));
  assert.ok(command.ffmpegArgs.includes("-shortest"));
  assert.ok(command.ffmpegArgs.includes("-movflags"));
  assert.ok(command.ffmpegArgs.includes("+faststart"));
  assert.ok(!command.ffmpegArgs.includes("-c:a"));
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
