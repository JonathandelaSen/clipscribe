import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorSystemExportResponseHeaders,
  parseEditorSystemExportResponseHeaders,
} from "../../../src/lib/editor/system-export-contract";

test("editor system export headers round-trip diagnostics metadata", () => {
  const headers = new Headers(
    buildEditorSystemExportResponseHeaders({
      filename: "timeline.mp4",
      width: 1920,
      height: 1080,
      sizeBytes: 2048,
      durationSeconds: 12,
      warnings: ["warning"],
      debugNotes: ["rendered"],
      debugFfmpegCommand: ["ffmpeg", "-i", "clip.mp4"],
      encoderUsed: "h264_videotoolbox",
      hardwareAccelerated: true,
      timingsMs: {
        analysisReuseWait: 12,
        overlayPreparation: 34,
        upload: 56,
        serverFfmpeg: 78,
        total: 90,
      },
      counts: {
        overlayCount: 1,
        atlasCount: 2,
        overlayRasterPixelArea: 388800,
      },
    })
  );

  const parsed = parseEditorSystemExportResponseHeaders(headers, {
    filename: "fallback.mp4",
    resolution: "1080p",
  });

  assert.equal(parsed.filename, "timeline.mp4");
  assert.equal(parsed.encoderUsed, "h264_videotoolbox");
  assert.equal(parsed.hardwareAccelerated, true);
  assert.equal(parsed.timingsMs?.serverFfmpeg, 78);
  assert.equal(parsed.counts?.atlasCount, 2);
  assert.deepEqual(parsed.debugFfmpegCommand, ["ffmpeg", "-i", "clip.mp4"]);
});
