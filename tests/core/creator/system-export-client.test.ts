import assert from "node:assert/strict";
import test from "node:test";

import { rebaseSubtitleChunksForTrim } from "../../../src/lib/creator/system-export-client";
import type { SubtitleChunk } from "../../../src/lib/history";

test("rebaseSubtitleChunksForTrim shifts subtitle timestamps into the trimmed clip timeline", () => {
  const chunks: SubtitleChunk[] = [
    { text: "hello", timestamp: [60.5, 62.25] },
    { text: "world", timestamp: [63, 64] },
  ];

  const rebased = rebaseSubtitleChunksForTrim(chunks, 50);

  assert.deepEqual(rebased, [
    { text: "hello", timestamp: [10.5, 12.25] },
    { text: "world", timestamp: [13, 14] },
  ]);
});

test("rebaseSubtitleChunksForTrim is a no-op when the source was not trimmed", () => {
  const chunks: SubtitleChunk[] = [{ text: "hello", timestamp: [12.5, 13.5] }];

  assert.equal(rebaseSubtitleChunksForTrim(chunks, 0), chunks);
});
