import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  parseCreatorShortSystemExportFormData,
  renderCreatorShortSystemExport,
} from "../../../src/lib/server/creator/shorts/render-service";
import {
  CREATOR_SYSTEM_EXPORT_FORM_FIELDS,
  type CreatorShortSystemExportOverlayDescriptor,
  type CreatorShortSystemExportPayload,
} from "../../../src/lib/creator/system-export-contract";
import { buildCanonicalShortExportGeometry } from "../../../src/lib/creator/core/export-geometry";

function createPayload(): CreatorShortSystemExportPayload {
  return {
    sourceFilename: "source.mp4",
    short: {
      id: "short_1",
      startSeconds: 12,
      endSeconds: 32,
      durationSeconds: 20,
      score: 90,
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
    },
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
    subtitleRenderMode: "png_parity",
    semanticSubtitles: null,
    subtitleBurnedIn: true,
    overlaySummary: {
      subtitleFrameCount: 1,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
    },
    clientTimingsMs: {
      subtitlePreparation: 12,
    },
  };
}

function createFormData() {
  const payload = createPayload();
  const sourceFile = new File(["video"], "source.mp4", { type: "video/mp4" });
  const overlayFile = new File(["png"], "overlay.png", { type: "image/png" });
  const overlays: CreatorShortSystemExportOverlayDescriptor[] = [
    {
      start: 3,
      end: 5,
      fileField: "overlay_0",
      filename: "overlay.png",
      kind: "intro_overlay",
      x: 144,
      y: 308,
      width: 792,
      height: 244,
    },
  ];

  const formData = new FormData();
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload, JSON.stringify(payload));
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile, sourceFile, sourceFile.name);
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, JSON.stringify(overlays));
  formData.set("overlay_0", overlayFile, overlayFile.name);

  return {
    payload,
    sourceFile,
    overlayFile,
    overlays,
    formData,
  };
}

test("parseCreatorShortSystemExportFormData reads payload, source file, and overlays", () => {
  const { formData, payload } = createFormData();

  const parsed = parseCreatorShortSystemExportFormData(formData);

  assert.equal(parsed.engine, "system");
  assert.equal(parsed.payload.sourceFilename, payload.sourceFilename);
  assert.equal(parsed.sourceFile.name, "source.mp4");
  assert.equal(parsed.overlays.length, 1);
  assert.equal(parsed.overlays[0]?.descriptor.filename, "overlay.png");
  assert.equal(parsed.overlays[0]?.descriptor.kind, "intro_overlay");
  assert.equal(parsed.overlays[0]?.descriptor.x, 144);
  assert.equal(parsed.overlays[0]?.descriptor.width, 792);
  assert.equal(parsed.overlays[0]?.file.name, "overlay.png");
});

test("parseCreatorShortSystemExportFormData reads an optional visual source file", () => {
  const { formData } = createFormData();
  const visualFile = new File(["image"], "replacement.png", { type: "image/png" });
  const payload = {
    ...createPayload(),
    visualSource: {
      kind: "image" as const,
      filename: visualFile.name,
    },
  };
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload, JSON.stringify(payload));
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.visualSourceFile, visualFile, visualFile.name);

  const parsed = parseCreatorShortSystemExportFormData(formData);

  assert.equal(parsed.visualSourceFile?.name, "replacement.png");
  assert.equal(parsed.payload.visualSource?.kind, "image");
});

test("parseCreatorShortSystemExportFormData rejects missing source files", () => {
  const { formData } = createFormData();
  formData.delete(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile);

  assert.throws(
    () => parseCreatorShortSystemExportFormData(formData),
    /source_file is required/
  );
});

test("parseCreatorShortSystemExportFormData rejects malformed overlay descriptors", () => {
  const { formData } = createFormData();
  formData.set(
    CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays,
    JSON.stringify([{ start: 5, end: 5, fileField: "overlay_0", filename: "overlay.png" }])
  );

  assert.throws(
    () => parseCreatorShortSystemExportFormData(formData),
    /valid time range/
  );
});

test("parseCreatorShortSystemExportFormData keeps legacy fullscreen overlays compatible", () => {
  const { formData } = createFormData();
  formData.set(
    CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays,
    JSON.stringify([{ start: 3, end: 5, fileField: "overlay_0", filename: "overlay.png" }])
  );

  const parsed = parseCreatorShortSystemExportFormData(formData);

  assert.equal(parsed.overlays[0]?.descriptor.x, undefined);
  assert.equal(parsed.overlays[0]?.descriptor.height, undefined);
  assert.equal(parsed.overlays[0]?.descriptor.kind, undefined);
});

test("renderCreatorShortSystemExport returns bytes and cleans up temp files on success", async () => {
  const { payload, sourceFile, overlayFile, overlays } = createFormData();
  let tempRoot = "";
  const progressEvents: Array<{
    stage: string;
    message: string;
    progressPct?: number;
  }> = [];

  const result = await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      overlays: [
        {
          descriptor: overlays[0]!,
          file: overlayFile,
        },
      ],
      onProgressEvent: (event) => {
        progressEvents.push(event);
      },
    },
    {
      exportShort: async (input) => {
        tempRoot = path.dirname(path.dirname(input.sourceFilePath));
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        input.onLogEvent?.({
          stage: "ffmpeg",
          message: "FFmpeg warm-up complete.",
        });
        input.onProgress?.({
          percent: 50,
          processedSeconds: 10,
          durationSeconds: 20,
        });
        await writeFile(input.outputPath, Buffer.alloc(2048, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 2048,
          durationSeconds: 20,
          subtitleBurnedIn: true,
          renderModeUsed: "png_parity",
          encoderUsed: "libx264",
          ffmpegDurationMs: 33,
          ffmpegBenchmarkMs: {
            encode_video: { user: 10, system: 5, real: 20 },
          },
          ffmpegCommandPreview: ["ffmpeg", "-i", "source.mp4"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 20,
        audioDurationSeconds: 20,
        videoFrameCount: 600,
      }),
    }
  );

  assert.equal(result.filename, "short.mp4");
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.sizeBytes, 2048);
  assert.equal(result.bytes.byteLength, 2048);
  assert.equal(result.renderModeUsed, "png_parity");
  assert.equal(result.encoderUsed, "libx264");
  assert.equal(result.counts?.subtitleChunkCount, 1);
  assert.equal(result.counts?.pngOverlayCount, 1);
  assert.equal(result.counts?.overlayRasterPixelArea, 792 * 244);
  assert.equal(result.counts?.overlayRasterAreaPct, Number((((792 * 244) / (1080 * 1920)) * 100).toFixed(2)));
  assert.equal(result.counts?.introOverlayCount, 1);
  assert.equal(result.counts?.outroOverlayCount, 0);
  assert.equal(result.timingsMs?.server?.ffmpeg, 33);
  assert.equal(
    progressEvents.some((event) => event.stage === "setup" && /Server parsed export payload/.test(event.message)),
    true
  );
  assert.equal(
    progressEvents.some((event) => event.stage === "ffmpeg" && /FFmpeg warm-up complete/.test(event.message)),
    true
  );
  assert.equal(
    progressEvents.some(
      (event) =>
        event.stage === "ffmpeg" && event.progressPct === 50 && /FFmpeg progress 50.0%/.test(event.message)
    ),
    true
  );
  assert.equal(
    progressEvents.some((event) => event.stage === "finalize" && event.progressPct === 100),
    true
  );
  await assert.rejects(() => access(tempRoot));
});

test("renderCreatorShortSystemExport forwards replacement visual metadata to the renderer", async () => {
  const { payload, sourceFile } = createFormData();
  const visualSourceFile = new File(["video"], "replacement.mp4", { type: "video/mp4" });
  let receivedVisualPath = "";
  let receivedVisualKind = "";

  await renderCreatorShortSystemExport(
    {
      payload: {
        ...payload,
        visualSource: {
          kind: "video",
          filename: visualSourceFile.name,
        },
      },
      sourceFile,
      visualSourceFile,
      overlays: [],
    },
    {
      exportShort: async (input) => {
        receivedVisualPath = input.visualSourceFilePath ?? "";
        receivedVisualKind = input.visualSourceKind ?? "";
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(256, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 256,
          durationSeconds: 20,
          subtitleBurnedIn: false,
          renderModeUsed: "png_parity",
          encoderUsed: "libx264",
          ffmpegDurationMs: 12,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 20,
        audioDurationSeconds: 20,
        videoFrameCount: 600,
      }),
    }
  );

  assert.match(receivedVisualPath, /replacement\.mp4$/);
  assert.equal(receivedVisualKind, "video");
});

test("renderCreatorShortSystemExport infers visual kind from the uploaded file when payload metadata is missing", async () => {
  const { payload, sourceFile } = createFormData();
  const visualSourceFile = new File(["image"], "replacement.png", { type: "image/png" });
  let receivedVisualKind = "";

  await renderCreatorShortSystemExport(
    {
      payload: {
        ...payload,
        visualSource: null,
      },
      sourceFile,
      visualSourceFile,
      overlays: [],
    },
    {
      exportShort: async (input) => {
        receivedVisualKind = input.visualSourceKind ?? "";
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(256, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 256,
          durationSeconds: 20,
          subtitleBurnedIn: false,
          renderModeUsed: "png_parity",
          encoderUsed: "libx264",
          ffmpegDurationMs: 12,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 20,
        audioDurationSeconds: 20,
        videoFrameCount: 600,
      }),
    }
  );

  assert.equal(receivedVisualKind, "image");
});

test("renderCreatorShortSystemExport compensates lead-in drift from pre-trimmed uploads", async () => {
  const { sourceFile } = createFormData();
  const payload: CreatorShortSystemExportPayload = {
    ...createPayload(),
    short: {
      ...createPayload().short,
      startSeconds: 10,
      endSeconds: 30,
      durationSeconds: 20,
    },
    sourceTrim: {
      requestedOffsetSeconds: 34,
      requestedDurationSeconds: 35,
    },
    subtitleRenderMode: "fast_ass",
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption",
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        backgroundColor: "#000000",
        backgroundOpacity: 0,
        backgroundEnabled: false,
        backgroundPaddingX: 28,
        backgroundPaddingY: 16,
        backgroundRadius: 22,
        textCase: "uppercase",
      },
      chunks: [{ text: "HELLO", start: 0, end: 2 }],
    },
    subtitleBurnedIn: true,
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
    },
  };

  let exportedShortStart = 0;
  let exportedShortEnd = 0;
  let overlayStart = 0;
  let overlayEnd = 0;
  let builtAss = "";
  const progressEvents: string[] = [];

  const result = await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      overlays: [
        {
          descriptor: {
            start: 0,
            end: 2,
            fileField: "overlay_0",
            filename: "overlay.png",
            kind: "intro_overlay",
            x: 144,
            y: 308,
            width: 792,
            height: 244,
          },
          file: new File(["png"], "overlay.png", { type: "image/png" }),
        },
      ],
      onProgressEvent: (event) => {
        progressEvents.push(event.message);
      },
    },
    {
      buildAssDocument: (input) => {
        builtAss = JSON.stringify(input.chunks);
        return "[Script Info]";
      },
      exportShort: async (input) => {
        exportedShortStart = input.short.startSeconds;
        exportedShortEnd = input.short.endSeconds;
        overlayStart = input.overlays[0]?.start ?? 0;
        overlayEnd = input.overlays[0]?.end ?? 0;
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(512, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 512,
          durationSeconds: 20,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "libx264",
          ffmpegDurationMs: 12,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 39,
        audioDurationSeconds: 39,
        videoFrameCount: 1170,
      }),
    }
  );

  assert.equal(result.filename, "short.mp4");
  assert.equal(exportedShortStart, 14);
  assert.equal(exportedShortEnd, 34);
  assert.equal(overlayStart, 0);
  assert.equal(overlayEnd, 2);
  assert.match(builtAss, /"start":0/);
  assert.match(builtAss, /"end":2/);
  assert.equal(progressEvents.some((message) => /keyframe lead-in/.test(message)), true);
});

test("renderCreatorShortSystemExport cleans up temp files when the export is aborted", async () => {
  const { payload, sourceFile, overlayFile, overlays } = createFormData();
  const controller = new AbortController();
  let tempRoot = "";

  await assert.rejects(
    () =>
      renderCreatorShortSystemExport(
        {
          payload,
          sourceFile,
          overlays: [
            {
              descriptor: overlays[0]!,
              file: overlayFile,
            },
          ],
          signal: controller.signal,
        },
        {
          exportShort: async (input) => {
            tempRoot = path.dirname(path.dirname(input.sourceFilePath));
            return new Promise((_, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => {
                  const error = new Error("Short export canceled.");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true }
              );
              controller.abort();
            });
          },
          detectSourcePlaybackProfile: async () => ({
            mode: "normal",
            hasVideo: true,
            hasAudio: true,
            videoDurationSeconds: 20,
            audioDurationSeconds: 20,
            videoFrameCount: 600,
          }),
        }
      ),
    (error) => error instanceof Error && error.name === "AbortError"
  );

  await assert.rejects(() => access(tempRoot));
});

test("renderCreatorShortSystemExport writes an ASS subtitle file for the fast path", async () => {
  const payload = {
    ...createPayload(),
    subtitleRenderMode: "fast_ass" as const,
    subtitleBurnedIn: true,
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 0,
      outroOverlayFrameCount: 0,
    },
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption" as const,
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        textCase: "original" as const,
        backgroundEnabled: false,
        backgroundColor: "#111111",
        backgroundOpacity: 0.72,
        backgroundRadius: 22,
        backgroundPaddingX: 22,
        backgroundPaddingY: 11,
      },
      chunks: [{ text: "Hello world", start: 3, end: 5 }],
    },
  };
  const sourceFile = new File(["video"], "source.mp4", { type: "video/mp4" });
  let subtitleTrackPath = "";

  await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      overlays: [],
    },
    {
      exportShort: async (input) => {
        subtitleTrackPath = input.subtitleTrackPath ?? "";
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(2048, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 2048,
          durationSeconds: 20,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "h264_videotoolbox",
          ffmpegDurationMs: 22,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 20,
        audioDurationSeconds: 20,
        videoFrameCount: 600,
      }),
    }
  );

  assert.match(subtitleTrackPath, /short\.ass$/);
});

test("renderCreatorShortSystemExport rebases overlay and subtitle timing for still-video sources", async () => {
  const payload = {
    ...createPayload(),
    short: {
      ...createPayload().short,
      startSeconds: 44,
      endSeconds: 65,
      durationSeconds: 21,
    },
    subtitleRenderMode: "fast_ass" as const,
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption" as const,
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        textCase: "original" as const,
        backgroundEnabled: false,
        backgroundColor: "#111111",
        backgroundOpacity: 0.72,
        backgroundRadius: 22,
        backgroundPaddingX: 22,
        backgroundPaddingY: 11,
      },
      chunks: [{ text: "Hello world", start: 0, end: 3 }],
    },
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
    },
  };
  const sourceFile = new File(["video"], "source.mp4", { type: "video/mp4" });
  const overlayFile = new File(["png"], "overlay.png", { type: "image/png" });
  let receivedOverlayStart = -1;
  let receivedOverlayEnd = -1;
  let receivedSourcePlaybackMode = "";
  let assPayload = "";

  await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      overlays: [
        {
          descriptor: {
            start: 0,
            end: 3,
            fileField: "overlay_0",
            filename: "overlay.png",
            kind: "intro_overlay",
            x: 144,
            y: 308,
            width: 792,
            height: 244,
          },
          file: overlayFile,
        },
      ],
    },
    {
      buildAssDocument: (input) => {
        assPayload = JSON.stringify(input.chunks);
        return "[Script Info]\n";
      },
      exportShort: async (input) => {
        receivedOverlayStart = input.overlays[0]?.start ?? -1;
        receivedOverlayEnd = input.overlays[0]?.end ?? -1;
        receivedSourcePlaybackMode = input.sourcePlaybackMode ?? "";
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(2048, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 2048,
          durationSeconds: 21,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "libx264",
          ffmpegDurationMs: 25,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "still",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 0.04,
        audioDurationSeconds: 900,
        videoFrameCount: 1,
      }),
    }
  );

  assert.equal(receivedSourcePlaybackMode, "still");
  assert.equal(receivedOverlayStart, 0);
  assert.equal(receivedOverlayEnd, 3);
  assert.match(assPayload, /"start":0/);
  assert.match(assPayload, /"end":3/);
});

test("renderCreatorShortSystemExport rebases overlay and subtitle timing for static image visual overrides", async () => {
  const payload = {
    ...createPayload(),
    short: {
      ...createPayload().short,
      startSeconds: 44,
      endSeconds: 65,
      durationSeconds: 21,
    },
    visualSource: {
      kind: "image" as const,
      filename: "replacement.png",
    },
    subtitleRenderMode: "fast_ass" as const,
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption" as const,
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        textCase: "original" as const,
        backgroundEnabled: false,
        backgroundColor: "#111111",
        backgroundOpacity: 0.72,
        backgroundRadius: 22,
        backgroundPaddingX: 22,
        backgroundPaddingY: 11,
      },
      chunks: [{ text: "Hello world", start: 0, end: 3 }],
    },
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
    },
  };
  const sourceFile = new File(["video"], "source.mp4", { type: "video/mp4" });
  const visualSourceFile = new File(["image"], "replacement.png", { type: "image/png" });
  const overlayFile = new File(["png"], "overlay.png", { type: "image/png" });
  let receivedOverlayStart = -1;
  let receivedOverlayEnd = -1;
  let receivedSourcePlaybackMode = "";
  let receivedVisualKind = "";
  let assPayload = "";

  await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      visualSourceFile,
      overlays: [
        {
          descriptor: {
            start: 0,
            end: 3,
            fileField: "overlay_0",
            filename: "overlay.png",
            kind: "intro_overlay",
            x: 144,
            y: 308,
            width: 792,
            height: 244,
          },
          file: overlayFile,
        },
      ],
    },
    {
      buildAssDocument: (input) => {
        assPayload = JSON.stringify(input.chunks);
        return "[Script Info]\n";
      },
      exportShort: async (input) => {
        receivedOverlayStart = input.overlays[0]?.start ?? -1;
        receivedOverlayEnd = input.overlays[0]?.end ?? -1;
        receivedSourcePlaybackMode = input.sourcePlaybackMode ?? "";
        receivedVisualKind = input.visualSourceKind ?? "";
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(2048, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 2048,
          durationSeconds: 21,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "libx264",
          ffmpegDurationMs: 25,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 900,
        audioDurationSeconds: 900,
        videoFrameCount: 27000,
      }),
    }
  );

  assert.equal(receivedSourcePlaybackMode, "normal");
  assert.equal(receivedVisualKind, "image");
  assert.equal(receivedOverlayStart, 0);
  assert.equal(receivedOverlayEnd, 3);
  assert.match(assPayload, /"start":0/);
  assert.match(assPayload, /"end":3/);
});

test("renderCreatorShortSystemExport rebases overlay and subtitle timing for replacement video visual overrides", async () => {
  const payload = {
    ...createPayload(),
    short: {
      ...createPayload().short,
      startSeconds: 44,
      endSeconds: 65,
      durationSeconds: 21,
    },
    visualSource: {
      kind: "video" as const,
      filename: "replacement.mp4",
    },
    subtitleRenderMode: "fast_ass" as const,
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption" as const,
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        textCase: "original" as const,
        backgroundEnabled: false,
        backgroundColor: "#111111",
        backgroundOpacity: 0.72,
        backgroundRadius: 22,
        backgroundPaddingX: 22,
        backgroundPaddingY: 11,
      },
      chunks: [{ text: "Hello world", start: 0, end: 3 }],
    },
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
    },
  };
  const sourceFile = new File(["video"], "source.mp4", { type: "video/mp4" });
  const visualSourceFile = new File(["video"], "replacement.mp4", { type: "video/mp4" });
  const overlayFile = new File(["png"], "overlay.png", { type: "image/png" });
  let receivedOverlayStart = -1;
  let receivedOverlayEnd = -1;
  let receivedSourcePlaybackMode = "";
  let receivedVisualKind = "";
  let assPayload = "";

  await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      visualSourceFile,
      overlays: [
        {
          descriptor: {
            start: 0,
            end: 3,
            fileField: "overlay_0",
            filename: "overlay.png",
            kind: "intro_overlay",
            x: 144,
            y: 308,
            width: 792,
            height: 244,
          },
          file: overlayFile,
        },
      ],
    },
    {
      buildAssDocument: (input) => {
        assPayload = JSON.stringify(input.chunks);
        return "[Script Info]\n";
      },
      exportShort: async (input) => {
        receivedOverlayStart = input.overlays[0]?.start ?? -1;
        receivedOverlayEnd = input.overlays[0]?.end ?? -1;
        receivedSourcePlaybackMode = input.sourcePlaybackMode ?? "";
        receivedVisualKind = input.visualSourceKind ?? "";
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(2048, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 2048,
          durationSeconds: 21,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "libx264",
          ffmpegDurationMs: 25,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 900,
        audioDurationSeconds: 900,
        videoFrameCount: 27000,
      }),
    }
  );

  assert.equal(receivedSourcePlaybackMode, "normal");
  assert.equal(receivedVisualKind, "video");
  assert.equal(receivedOverlayStart, 0);
  assert.equal(receivedOverlayEnd, 3);
  assert.match(assPayload, /"start":0/);
  assert.match(assPayload, /"end":3/);
});

test("renderCreatorShortSystemExport keeps lead-in compensation active for image visual overrides", async () => {
  const { sourceFile } = createFormData();
  const visualSourceFile = new File(["image"], "replacement.png", { type: "image/png" });
  const payload: CreatorShortSystemExportPayload = {
    ...createPayload(),
    short: {
      ...createPayload().short,
      startSeconds: 10,
      endSeconds: 30,
      durationSeconds: 20,
    },
    visualSource: {
      kind: "image",
      filename: visualSourceFile.name,
    },
    sourceTrim: {
      requestedOffsetSeconds: 34,
      requestedDurationSeconds: 35,
    },
    subtitleRenderMode: "fast_ass",
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption",
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        backgroundColor: "#000000",
        backgroundOpacity: 0,
        backgroundEnabled: false,
        backgroundPaddingX: 28,
        backgroundPaddingY: 16,
        backgroundRadius: 22,
        textCase: "uppercase",
      },
      chunks: [{ text: "HELLO", start: 0, end: 2 }],
    },
    subtitleBurnedIn: true,
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
    },
  };

  let exportedShortStart = 0;
  let exportedShortEnd = 0;
  let assPayload = "";

  await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      visualSourceFile,
      overlays: [],
    },
    {
      buildAssDocument: (input) => {
        assPayload = JSON.stringify(input.chunks);
        return "[Script Info]\n";
      },
      exportShort: async (input) => {
        exportedShortStart = input.short.startSeconds;
        exportedShortEnd = input.short.endSeconds;
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(512, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 512,
          durationSeconds: 20,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "libx264",
          ffmpegDurationMs: 12,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "normal",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 39,
        audioDurationSeconds: 39,
        videoFrameCount: 1170,
      }),
    }
  );

  assert.equal(exportedShortStart, 14);
  assert.equal(exportedShortEnd, 34);
  assert.match(assPayload, /"start":0/);
  assert.match(assPayload, /"end":2/);
});

test("renderCreatorShortSystemExport keeps lead-in compensation from delaying still-source subtitles", async () => {
  const { sourceFile } = createFormData();
  const payload: CreatorShortSystemExportPayload = {
    ...createPayload(),
    short: {
      ...createPayload().short,
      startSeconds: 10,
      endSeconds: 30,
      durationSeconds: 20,
    },
    sourceTrim: {
      requestedOffsetSeconds: 34,
      requestedDurationSeconds: 35,
    },
    subtitleRenderMode: "fast_ass",
    semanticSubtitles: {
      canvasWidth: 1080,
      canvasHeight: 1920,
      anchorX: 540,
      anchorY: 1500,
      fontSize: 56,
      maxCharsPerLine: 24,
      style: {
        preset: "clean_caption",
        textColor: "#FFFFFF",
        letterWidth: 1.04,
        borderColor: "#2A2A2A",
        borderWidth: 3,
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowDistance: 2.2,
        backgroundColor: "#000000",
        backgroundOpacity: 0,
        backgroundEnabled: false,
        backgroundPaddingX: 28,
        backgroundPaddingY: 16,
        backgroundRadius: 22,
        textCase: "uppercase",
      },
      chunks: [{ text: "HELLO", start: 0, end: 2 }],
    },
    subtitleBurnedIn: true,
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 0,
      outroOverlayFrameCount: 0,
    },
  };

  let exportedShortStart = 0;
  let exportedShortEnd = 0;
  let assPayload = "";

  await renderCreatorShortSystemExport(
    {
      payload,
      sourceFile,
      overlays: [],
    },
    {
      buildAssDocument: (input) => {
        assPayload = JSON.stringify(input.chunks);
        return "[Script Info]\n";
      },
      exportShort: async (input) => {
        exportedShortStart = input.short.startSeconds;
        exportedShortEnd = input.short.endSeconds;
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(512, 1));
        return {
          outputPath: input.outputPath,
          filename: "short.mp4",
          width: 1080,
          height: 1920,
          sizeBytes: 512,
          durationSeconds: 20,
          subtitleBurnedIn: true,
          renderModeUsed: "fast_ass",
          encoderUsed: "libx264",
          ffmpegDurationMs: 12,
          ffmpegCommandPreview: ["ffmpeg"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
      detectSourcePlaybackProfile: async () => ({
        mode: "still",
        hasVideo: true,
        hasAudio: true,
        videoDurationSeconds: 39,
        audioDurationSeconds: 39,
        videoFrameCount: 1,
      }),
    }
  );

  assert.equal(exportedShortStart, 14);
  assert.equal(exportedShortEnd, 34);
  assert.match(assPayload, /"start":0/);
  assert.match(assPayload, /"end":2/);
});
