import test from "node:test";
import assert from "node:assert/strict";

import { buildTranscriptChunksFromWordChunks } from "../../../src/lib/transcriber/core/word-timestamps";

test("buildTranscriptChunksFromWordChunks groups short runs into readable segments", () => {
  const chunks = buildTranscriptChunksFromWordChunks([
    { text: "hola", timestamp: [0, 0.4] },
    { text: "mundo.", timestamp: [0.4, 0.9] },
    { text: "esto", timestamp: [1.3, 1.6] },
    { text: "fluye", timestamp: [1.6, 2.0] },
  ]);

  assert.deepEqual(chunks, [
    { text: "hola mundo.", timestamp: [0, 0.9] },
    { text: "esto fluye", timestamp: [1.3, 2] },
  ]);
});

test("buildTranscriptChunksFromWordChunks starts a new segment after large gaps", () => {
  const chunks = buildTranscriptChunksFromWordChunks([
    { text: "uno", timestamp: [0, 0.2] },
    { text: "dos", timestamp: [0.2, 0.45] },
    { text: "tres", timestamp: [1.5, 1.8] },
  ]);

  assert.deepEqual(chunks, [
    { text: "uno dos", timestamp: [0, 0.45] },
    { text: "tres", timestamp: [1.5, 1.8] },
  ]);
});
