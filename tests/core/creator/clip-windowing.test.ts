import test from "node:test";
import assert from "node:assert/strict";

import { clampClipToMediaDuration, clipSubtitleChunks, findSubtitleChunkAtTime } from "../../../src/lib/creator/core/clip-windowing";
import type { CreatorViralClip } from "../../../src/lib/creator/types";
import type { SubtitleChunk } from "../../../src/lib/history";

const baseClip: CreatorViralClip = {
  id: "clip_1",
  startSeconds: 8,
  endSeconds: 20,
  durationSeconds: 12,
  score: 80,
  title: "Clip",
  hook: "Hook",
  reason: "Reason",
  punchline: "Punchline",
  sourceChunkIndexes: [],
  suggestedSubtitleLanguage: "en",
};

test("clipSubtitleChunks keeps only subtitle chunks that overlap clip range", () => {
  const chunks: SubtitleChunk[] = [
    { text: "before", timestamp: [1, 7] },
    { text: "overlap-start", timestamp: [7.9, 8.2] },
    { text: "inside", timestamp: [10, 12] },
    { text: "overlap-end", timestamp: [19.7, 20.4] },
    { text: "after", timestamp: [21, 22] },
  ];

  const selected = clipSubtitleChunks(baseClip, chunks);
  assert.deepEqual(
    selected.map((chunk) => chunk.text),
    ["overlap-start", "inside", "overlap-end"]
  );
});

test("findSubtitleChunkAtTime returns the subtitle active at the current playback time", () => {
  const chunks: SubtitleChunk[] = [
    { text: "first", timestamp: [8, 9.2] },
    { text: "current", timestamp: [11.5, 13] },
    { text: "open-ended", timestamp: [14.5, null] },
  ];

  assert.equal(findSubtitleChunkAtTime(chunks, 12.2)?.text, "current");
  assert.equal(findSubtitleChunkAtTime(chunks, 14.5)?.text, "open-ended");
  assert.equal(findSubtitleChunkAtTime(chunks, 10.1), undefined);
});

test("clampClipToMediaDuration preserves clip when media duration fully contains clip", () => {
  const clamped = clampClipToMediaDuration(baseClip, 90);
  assert.equal(clamped.startSeconds, baseClip.startSeconds);
  assert.equal(clamped.endSeconds, baseClip.endSeconds);
  assert.equal(clamped.durationSeconds, baseClip.durationSeconds);
});

test("clampClipToMediaDuration shifts and clamps clip into source bounds", () => {
  const outOfRange: CreatorViralClip = {
    ...baseClip,
    startSeconds: 14.8,
    endSeconds: 31.2,
    durationSeconds: 16.4,
  };

  const clamped = clampClipToMediaDuration(outOfRange, 15);
  assert.equal(clamped.startSeconds, 0);
  assert.equal(clamped.endSeconds, 15);
  assert.equal(clamped.durationSeconds, 15);
});

test("clampClipToMediaDuration enforces minimum duration while staying inside source bounds", () => {
  const clamped = clampClipToMediaDuration(
    {
      ...baseClip,
      startSeconds: 3,
      endSeconds: 3.05,
      durationSeconds: 0.05,
    },
    1
  );

  assert.equal(clamped.startSeconds, 0.5);
  assert.equal(clamped.endSeconds, 1);
  assert.equal(clamped.durationSeconds, 0.5);
});
