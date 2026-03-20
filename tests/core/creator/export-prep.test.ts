import test from "node:test";
import assert from "node:assert/strict";

import { prepareShortExport } from "../../../src/lib/creator/core/export-prep";
import type { CreatorViralClip } from "../../../src/lib/creator/types";
import type { SubtitleChunk } from "../../../src/lib/history";

const baseClip: CreatorViralClip = {
  id: "clip_1",
  startSeconds: 20,
  endSeconds: 42,
  durationSeconds: 22,
  score: 75,
  title: "Clip",
  hook: "Hook",
  reason: "Reason",
  punchline: "Punchline",
  sourceChunkIndexes: [],
  suggestedSubtitleLanguage: "en",
};

const subtitleChunks: SubtitleChunk[] = [
  { text: "before", timestamp: [1, 3] },
  { text: "inside", timestamp: [20.1, 20.8] },
  { text: "tail", timestamp: [41.7, 42.8] },
];

test("prepareShortExport clamps clip and re-windows subtitle chunks to source duration", () => {
  const result = prepareShortExport({
    requestedClip: {
      ...baseClip,
      startSeconds: 41,
      endSeconds: 66,
      durationSeconds: 25,
    },
    allSubtitleChunks: subtitleChunks,
    sourceDurationSeconds: 45,
  });

  assert.equal(result.clipAdjustedToSource, true);
  assert.equal(result.exportClip.startSeconds, 20);
  assert.equal(result.exportClip.endSeconds, 45);
  assert.equal(result.durationValid, true);
  assert.deepEqual(
    result.exportSubtitleChunks.map((chunk) => chunk.text),
    ["inside", "tail"]
  );
});

test("prepareShortExport keeps clip unchanged when source duration is unknown", () => {
  const result = prepareShortExport({
    requestedClip: baseClip,
    allSubtitleChunks: subtitleChunks,
  });

  assert.equal(result.clipAdjustedToSource, false);
  assert.equal(result.exportClip.startSeconds, 20);
  assert.equal(result.exportClip.endSeconds, 42);
  assert.equal(result.durationValid, true);
});

test("prepareShortExport flags clips that are too short for export", () => {
  const result = prepareShortExport({
    requestedClip: {
      ...baseClip,
      startSeconds: 5,
      endSeconds: 5.1,
      durationSeconds: 0.1,
    },
    allSubtitleChunks: subtitleChunks,
    minClipDurationSeconds: 0.25,
  });

  assert.equal(result.durationValid, false);
  assert.match(result.validationError || "", /too short/i);
});
