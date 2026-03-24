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
import { buildShortExportGeometry } from "../../../src/lib/creator/core/export-geometry";

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
    geometry: buildShortExportGeometry({
      sourceWidth: 1920,
      sourceHeight: 1080,
      editor: { zoom: 1.15, panX: 0, panY: 0 },
      previewViewport: { width: 400, height: 800 },
      outputWidth: 1080,
      outputHeight: 1920,
    }),
    previewViewport: { width: 400, height: 800 },
    previewVideoRect: null,
    subtitleBurnedIn: true,
    overlaySummary: {
      subtitleFrameCount: 1,
      introOverlayFrameCount: 1,
      outroOverlayFrameCount: 0,
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
  assert.equal(parsed.overlays[0]?.file.name, "overlay.png");
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

test("renderCreatorShortSystemExport returns bytes and cleans up temp files on success", async () => {
  const { payload, sourceFile, overlayFile, overlays } = createFormData();
  let tempRoot = "";

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
    },
    {
      exportShort: async (input) => {
        tempRoot = path.dirname(path.dirname(input.sourceFilePath));
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
          ffmpegCommandPreview: ["ffmpeg", "-i", "source.mp4"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
    }
  );

  assert.equal(result.filename, "short.mp4");
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.sizeBytes, 2048);
  assert.equal(result.bytes.byteLength, 2048);
  await assert.rejects(() => access(tempRoot));
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
        }
      ),
    (error) => error instanceof Error && error.name === "AbortError"
  );

  await assert.rejects(() => access(tempRoot));
});
