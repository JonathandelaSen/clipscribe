import assert from "node:assert/strict";
import test from "node:test";

import { CREATOR_SYSTEM_EXPORT_FORM_FIELDS } from "../../../src/lib/creator/system-export-contract";
import { buildCanonicalShortExportGeometry } from "../../../src/lib/creator/core/export-geometry";
import { postCreatorShortRender } from "../../../src/lib/server/creator/shorts/render-route";

function createPayload() {
  return {
    renderRequestId: "route_test_request",
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
        aspectRatio: "9:16" as const,
        resolution: "1080x1920" as const,
        subtitleStyle: "clean_caption" as const,
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
      visualSource: {
        mode: "asset" as const,
        assetId: "asset_visual",
        kind: "image" as const,
      },
    },
    sourceVideoSize: { width: 1024, height: 1536 },
    visualSource: {
      kind: "image" as const,
      filename: "replacement.png",
    },
    geometry: buildCanonicalShortExportGeometry({
      sourceWidth: 1024,
      sourceHeight: 1536,
      editor: { zoom: 1.15, panX: 0, panY: 0 },
      outputWidth: 1080,
      outputHeight: 1920,
    }),
    subtitleRenderMode: "fast_ass" as const,
    semanticSubtitles: null,
    subtitleBurnedIn: false,
    overlaySummary: {
      subtitleFrameCount: 0,
      introOverlayFrameCount: 0,
      outroOverlayFrameCount: 0,
    },
  };
}

test("postCreatorShortRender forwards visualSourceFile to the render service", async () => {
  const payload = createPayload();
  const sourceFile = new File(["video"], "source.mp4", { type: "video/mp4" });
  const visualSourceFile = new File(["image"], "replacement.png", { type: "image/png" });

  const formData = new FormData();
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload, JSON.stringify(payload));
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile, sourceFile, sourceFile.name);
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.visualSourceFile, visualSourceFile, visualSourceFile.name);
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, JSON.stringify([]));

  const request = new Request("http://localhost/api/creator/shorts/render", {
    method: "POST",
    body: formData,
  });

  let receivedVisualSourceFilename = "";

  const response = await postCreatorShortRender(request, {
    renderShort: async (input) => {
      receivedVisualSourceFilename = input.visualSourceFile?.name ?? "";
      return {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "short.mp4",
        mimeType: "video/mp4",
        width: 1080,
        height: 1920,
        sizeBytes: 3,
        durationSeconds: 20,
        subtitleBurnedIn: false,
        renderModeUsed: "fast_ass",
        encoderUsed: "libx264",
        timingsMs: {
          server: {
            formDataParse: 1,
            tempFileWrite: 1,
            ffmpeg: 1,
            outputReadback: 1,
            total: 1,
          },
        },
        counts: {
          subtitleChunkCount: 0,
          pngOverlayCount: 0,
          overlayRasterPixelArea: 0,
          overlayRasterAreaPct: 0,
          introOverlayCount: 0,
          outroOverlayCount: 0,
        },
        debugNotes: ["ok"],
        debugFfmpegCommand: ["ffmpeg"],
      };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(receivedVisualSourceFilename, "replacement.png");
});
