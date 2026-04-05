import test from "node:test";
import assert from "node:assert/strict";

import {
  getNextActiveShortPreviewId,
  getShortPreviewProgressPct,
  getShortPreviewSeekTime,
  isLikelyVideoSourceFilename,
  resolveShortPreviewBoundary,
} from "../../../src/lib/creator/core/short-preview";

const clip = {
  startSeconds: 12,
  endSeconds: 30,
  durationSeconds: 18,
};

test("short preview seek starts from the clip start and clamps to the clip duration", () => {
  assert.equal(getShortPreviewSeekTime(0, clip), 12);
  assert.equal(getShortPreviewSeekTime(50, clip), 21);
  assert.equal(getShortPreviewSeekTime(100, clip), 30);
  assert.equal(getShortPreviewSeekTime(180, clip), 30);
});

test("short preview progress only measures time inside the suggested clip window", () => {
  assert.equal(getShortPreviewProgressPct(5, clip), 0);
  assert.equal(getShortPreviewProgressPct(12, clip), 0);
  assert.equal(getShortPreviewProgressPct(21, clip), 50);
  assert.equal(getShortPreviewProgressPct(30, clip), 100);
  assert.equal(getShortPreviewProgressPct(40, clip), 100);
});

test("short preview boundary resets playback to the start when the clip reaches the end", () => {
  assert.deepEqual(resolveShortPreviewBoundary(20, clip), {
    shouldStop: false,
    nextTimeSeconds: 20,
  });
  assert.deepEqual(resolveShortPreviewBoundary(31, clip), {
    shouldStop: true,
    nextTimeSeconds: 12,
  });
  assert.deepEqual(resolveShortPreviewBoundary(Number.NaN, clip), {
    shouldStop: true,
    nextTimeSeconds: 12,
  });
});

test("only one AI suggestion preview can be active at a time", () => {
  assert.equal(getNextActiveShortPreviewId("", "short_a"), "short_a");
  assert.equal(getNextActiveShortPreviewId("short_a", "short_b"), "short_b");
  assert.equal(getNextActiveShortPreviewId("short_b", "short_b"), "");
});

test("video preview detection falls back cleanly for non-video sources", () => {
  assert.equal(isLikelyVideoSourceFilename("source.mp4"), true);
  assert.equal(isLikelyVideoSourceFilename("source.MOV"), true);
  assert.equal(isLikelyVideoSourceFilename("source.mp3"), false);
  assert.equal(isLikelyVideoSourceFilename(undefined), false);
});
