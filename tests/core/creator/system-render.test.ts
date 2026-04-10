import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  exportCreatorShortWithSystemFfmpeg,
  type CreatorSystemRenderOverlayInput,
} from "../../../src/lib/server/creator/shorts/system-render";
import { buildCanonicalShortExportGeometry } from "../../../src/lib/creator/core/export-geometry";
import type { CreatorSuggestedShort } from "../../../src/lib/creator/types";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-short-system-render-test-"));
}

function createShort(): CreatorSuggestedShort {
  return {
    id: "short_1",
    startSeconds: 12,
    endSeconds: 32,
    durationSeconds: 20,
    score: 92,
    title: "Short",
    reason: "Reason",
    caption: "Caption",
    openingText: "Hook",
    endCardText: "Outro",
    sourceChunkIndexes: [0, 1],
    suggestedSubtitleLanguage: "en",
    editorPreset: {
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleStyle: "clean_caption",
      safeTopPct: 10,
      safeBottomPct: 12,
      targetDurationRange: [15, 60] as [number, number],
    },
  };
}

function createRenderInput(tempDir: string) {
  return {
    sourceFilePath: "/media/source.mp4",
    sourceFilename: "source.mp4",
    short: createShort(),
    editor: {
      zoom: 1.15,
      panX: 0,
      panY: 0,
      subtitleScale: 1,
      subtitleXPositionPct: 50,
      subtitleYOffsetPct: 78,
      showSubtitles: true,
      showSafeZones: true,
    },
    sourceVideoSize: { width: 1920, height: 1080 },
    geometry: buildCanonicalShortExportGeometry({
      sourceWidth: 1920,
      sourceHeight: 1080,
      editor: { zoom: 1.15, panX: 0, panY: 0 },
      outputWidth: 1080,
      outputHeight: 1920,
    }),
    overlays: [] as CreatorSystemRenderOverlayInput[],
    subtitleBurnedIn: false,
    subtitleTrackPath: null as string | null,
    sourcePlaybackMode: "normal" as "normal" | "still",
    renderModeUsed: "fast_ass" as "fast_ass" | "png_parity",
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 0,
      outroOverlayFrameCount: 0,
      reactiveOverlayCount: 0,
      reactiveOverlayFrameCount: 0,
      reactiveOverlayPresetIds: [],
    },
    outputPath: path.join(tempDir, "exports", "short.mp4"),
    overwrite: true,
  };
}

test("exportCreatorShortWithSystemFfmpeg returns render details for a successful video-only export", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  const result = await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (command, args) => {
      assert.match(command, /ffmpeg$/);
      assert.ok(args.includes("-vf"));
      assert.ok(args.includes(input.outputPath));
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.equal(result.filename, "source__12-32.mp4");
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.sizeBytes, 2048);
  assert.equal(result.subtitleBurnedIn, false);
  assert.equal(result.renderModeUsed, "fast_ass");
});

test("exportCreatorShortWithSystemFfmpeg prefers the saved short name for the output filename", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = {
    ...createRenderInput(tempDir),
    shortName: "Gemma 4 resumen",
  };
  const result = await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      assert.ok(args.includes(input.outputPath));
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.equal(result.filename, "Gemma_4_resumen.mp4");
});

test("exportCreatorShortWithSystemFfmpeg builds an overlay filter graph when PNG overlays are present", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  input.overlays = [
    {
      absolutePath: "/media/overlay_0.png",
      filename: "overlay_0.png",
      start: 3,
      end: 5,
      kind: "intro_overlay",
      x: 148,
      y: 320,
      width: 784,
      height: 236,
    },
  ];
  input.subtitleBurnedIn = true;
  input.renderModeUsed = "png_parity";
  input.overlaySummary.subtitleFrameCount = 1;

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      const filterIndex = args.indexOf("-filter_complex");
      assert.notEqual(filterIndex, -1);
      const sourceInputIndex = args.indexOf(input.sourceFilePath);
      const firstSeekIndex = args.indexOf("-ss");
      assert.notEqual(firstSeekIndex, -1);
      assert.ok(firstSeekIndex < sourceInputIndex);
      assert.equal(args[firstSeekIndex + 1], String(input.short.startSeconds));
      assert.equal(args.slice(sourceInputIndex + 1, filterIndex).includes("-ss"), false);
      assert.match(args[filterIndex + 1] ?? "", /\[0:v\]setpts=PTS-STARTPTS,/);
      assert.match(args[filterIndex + 1] ?? "", /\[1:v\]setpts=PTS-STARTPTS\[overlay_input_0\]/);
      assert.match(args[filterIndex + 1] ?? "", /overlay=x=148:y=320:enable='between/);
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg crops bounded reactive overlay atlases to their own raster size", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  input.overlays = [
    {
      absolutePath: "/media/reactive_overlay_0.png",
      filename: "reactive_overlay_0.png",
      start: 0,
      end: 3,
      kind: "reactive_overlay",
      x: 0,
      y: 921,
      width: 1080,
      height: 346,
      cropExpression: "between(t,0.000,0.167)*346",
    },
  ];
  input.renderModeUsed = "png_parity";
  input.overlaySummary.reactiveOverlayCount = 1;
  input.overlaySummary.reactiveOverlayFrameCount = 1;

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      const filterIndex = args.indexOf("-filter_complex");
      assert.notEqual(filterIndex, -1);
      assert.match(args[filterIndex + 1] ?? "", /\[1:v\]setpts=PTS-STARTPTS\[overlay_input_0\]/);
      assert.match(args[filterIndex + 1] ?? "", /crop=1080:346:0:'between\(t,0\.000,0\.167\)\*346'/);
      assert.doesNotMatch(args[filterIndex + 1] ?? "", /crop=1080:1920:0:'between\(t,0\.000,0\.167\)\*346'/);
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg externalizes oversized filter graphs into a script file", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  input.overlays = [
    {
      absolutePath: "/media/reactive_overlay_big.png",
      filename: "reactive_overlay_big.png",
      start: 0,
      end: 20,
      kind: "reactive_overlay",
      x: 0,
      y: 921,
      width: 1080,
      height: 346,
      cropExpression: Array.from({ length: 1200 }, () => "between(t,0.000,0.167)*346").join("+"),
    },
  ];
  input.renderModeUsed = "png_parity";
  input.overlaySummary.reactiveOverlayCount = 1;
  input.overlaySummary.reactiveOverlayFrameCount = 1;

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      const scriptIndex = args.indexOf("-filter_complex_script");
      assert.notEqual(scriptIndex, -1);
      const scriptPath = args[scriptIndex + 1];
      assert.ok(scriptPath);
      const script = await readFile(scriptPath!, "utf8");
      assert.match(script, /\[1:v\]setpts=PTS-STARTPTS\[overlay_input_0\]/);
      assert.match(script, /overlay=x=0:y=921:enable='between/);
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg surfaces the relevant ffmpeg error context", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);

  await assert.rejects(
    exportCreatorShortWithSystemFfmpeg({
      ...input,
      commandRunner: async () => ({
        code: 1,
        stdout: "",
        stderr: [
          "Stream mapping:",
          "  Stream #351:0 (png) -> setpts:default",
          "  Stream #352:0 (png) -> setpts:default",
          "Press [q] to stop, [?] for help",
          "[Parsed_overlay_154 @ 0x123] Failed to configure input pad on Parsed_overlay_154",
          "Error reinitializing filters!",
          "Failed to inject frame into filter network: Invalid argument",
          "Error while processing the decoded data for stream #355:0",
          "Conversion failed!",
        ].join("\n"),
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Failed to configure input pad on Parsed_overlay_154/);
      assert.match(error.message, /Conversion failed!/);
      return true;
    }
  );
});

test("exportCreatorShortWithSystemFfmpeg keeps fullscreen legacy overlays at 0,0", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  input.overlays = [
    {
      absolutePath: "/media/overlay_legacy.png",
      filename: "overlay_legacy.png",
      start: 0,
      end: 2,
    },
  ];

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      const filterIndex = args.indexOf("-filter_complex");
      assert.notEqual(filterIndex, -1);
      assert.match(args[filterIndex + 1] ?? "", /\[1:v\]setpts=PTS-STARTPTS\[overlay_input_0\]/);
      assert.match(args[filterIndex + 1] ?? "", /overlay=x=0:y=0:enable='between/);
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg appends ASS subtitles in the fast path", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  input.subtitleBurnedIn = true;
  input.subtitleTrackPath = path.join(tempDir, "subtitles.ass");

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      const vfIndex = args.indexOf("-vf");
      assert.notEqual(vfIndex, -1);
      assert.match(args[vfIndex + 1] ?? "", /ass=/);
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg builds a static-video render path for still sources", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  input.short = {
    ...input.short,
    startSeconds: 44,
    endSeconds: 65,
    durationSeconds: 21,
  };
  input.overlays = [
    {
      absolutePath: "/media/overlay_0.png",
      filename: "overlay_0.png",
      start: 0,
      end: 3,
      kind: "intro_overlay",
      x: 148,
      y: 320,
      width: 784,
      height: 236,
    },
  ];
  input.sourcePlaybackMode = "still";

  const result = await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      const filterIndex = args.indexOf("-filter_complex");
      assert.notEqual(filterIndex, -1);
      assert.equal(args.filter((arg) => arg === "-i").length, 3);
      assert.equal(args.filter((arg) => arg === "-ss").length, 1);
      assert.match(args[filterIndex + 1] ?? "", /tpad=stop_mode=clone:stop_duration=21\.000/);
      assert.match(args[filterIndex + 1] ?? "", /\[2:v\]setpts=PTS-STARTPTS\[overlay_input_0\]/);
      assert.ok(args.includes("1:a?"));
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.match(result.notes.join("\n"), /still-video compatibility path/);
  assert.equal(result.encoderUsed, "libx264");
});

test("exportCreatorShortWithSystemFfmpeg uses a replacement video while keeping audio on the original source", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    visualSourceFilePath: "/media/replacement.mp4",
    visualSourceKind: "video",
    commandRunner: async (_, args) => {
      assert.equal(args.filter((arg) => arg === "-i").length, 2);
      assert.equal(args[args.indexOf("-i") + 1], "/media/replacement.mp4");
      assert.match(args.join(" "), /-ss 12/);
      assert.match(args.join(" "), /tpad=stop_mode=clone:stop_duration=20\.000/);
      assert.ok(args.includes("1:a?"));
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg uses a replacement image while keeping audio on the original source", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);

  await exportCreatorShortWithSystemFfmpeg({
    ...input,
    visualSourceFilePath: "/media/replacement.png",
    visualSourceKind: "image",
    sourcePlaybackMode: "still",
    commandRunner: async (_, args) => {
      assert.equal(args[args.indexOf("-loop") + 1], "1");
      assert.equal(args[args.indexOf("-i") + 1], "/media/replacement.png");
      assert.ok(args.includes("1:a?"));
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });
});

test("exportCreatorShortWithSystemFfmpeg retries with exact seek after a hybrid seek failure", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);
  const seekCounts: number[] = [];

  const result = await exportCreatorShortWithSystemFfmpeg({
    ...input,
    commandRunner: async (_, args) => {
      seekCounts.push(args.filter((arg) => arg === "-ss").length);
      if (seekCounts.length === 1) {
        return {
          code: 1,
          stdout: "",
          stderr: "bad seek",
        };
      }
      await writeFile(input.outputPath, Buffer.alloc(2048, 1));
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  assert.deepEqual(seekCounts, [2, 1]);
  assert.match(result.notes.join("\n"), /Fallback exact-seek mode used/);
});

test("exportCreatorShortWithSystemFfmpeg propagates cancellation errors", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const input = createRenderInput(tempDir);

  await assert.rejects(
    () =>
      exportCreatorShortWithSystemFfmpeg({
        ...input,
        commandRunner: async () => {
          const error = new Error("Short export canceled.");
          error.name = "AbortError";
          throw error;
        },
      }),
    (error) => error instanceof Error && error.name === "AbortError"
  );
});
