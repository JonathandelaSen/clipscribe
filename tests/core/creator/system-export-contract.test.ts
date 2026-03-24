import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreatorShortSystemExportResponseHeaders,
  parseCreatorShortSystemExportResponseHeaders,
} from "../../../src/lib/creator/system-export-contract";

test("creator system export headers round-trip metadata", () => {
  const headers = new Headers(
    buildCreatorShortSystemExportResponseHeaders({
      filename: "short.mp4",
      width: 1080,
      height: 1920,
      sizeBytes: 4096,
      durationSeconds: 20,
      subtitleBurnedIn: true,
      debugNotes: ["note a"],
      debugFfmpegCommand: ["ffmpeg", "-i", "source.mp4"],
    })
  );

  const parsed = parseCreatorShortSystemExportResponseHeaders(headers, {
    filename: "fallback.mp4",
  });

  assert.equal(parsed.filename, "short.mp4");
  assert.equal(parsed.width, 1080);
  assert.equal(parsed.height, 1920);
  assert.equal(parsed.sizeBytes, 4096);
  assert.equal(parsed.durationSeconds, 20);
  assert.equal(parsed.subtitleBurnedIn, true);
  assert.deepEqual(parsed.debugNotes, ["note a"]);
  assert.deepEqual(parsed.debugFfmpegCommand, ["ffmpeg", "-i", "source.mp4"]);
});

test("creator system export headers use fallback filename when header is missing", () => {
  const parsed = parseCreatorShortSystemExportResponseHeaders(new Headers(), {
    filename: "fallback.mp4",
  });

  assert.equal(parsed.filename, "fallback.mp4");
  assert.equal(parsed.subtitleBurnedIn, false);
  assert.deepEqual(parsed.debugNotes, []);
});
