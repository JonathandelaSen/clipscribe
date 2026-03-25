import test from "node:test";
import assert from "node:assert/strict";

import { buildPopCaptionChunks } from "../../../src/lib/creator/core/pop-captions";

test("buildPopCaptionChunks returns single-word cues in word mode", () => {
  const chunks = buildPopCaptionChunks([
    { text: "hola", timestamp: [0, 0.2] },
    { text: "mundo", timestamp: [0.2, 0.5] },
  ], "word");

  assert.deepEqual(chunks, [
    { text: "hola", timestamp: [0, 0.2] },
    { text: "mundo", timestamp: [0.2, 0.5] },
  ]);
});

test("buildPopCaptionChunks pairs words but respects sentence boundaries", () => {
  const chunks = buildPopCaptionChunks([
    { text: "hola", timestamp: [0, 0.2] },
    { text: "mundo.", timestamp: [0.2, 0.5] },
    { text: "vamos", timestamp: [0.8, 1.0] },
    { text: "ya", timestamp: [1.0, 1.2] },
    { text: "mismo", timestamp: [1.2, 1.5] },
  ], "pair");

  assert.deepEqual(chunks, [
    { text: "hola mundo.", timestamp: [0, 0.5] },
    { text: "vamos ya", timestamp: [0.8, 1.2] },
    { text: "mismo", timestamp: [1.2, 1.5] },
  ]);
});

test("buildPopCaptionChunks groups triples in triple mode", () => {
  const chunks = buildPopCaptionChunks([
    { text: "uno", timestamp: [0, 0.2] },
    { text: "dos", timestamp: [0.2, 0.4] },
    { text: "tres", timestamp: [0.4, 0.6] },
    { text: "cuatro", timestamp: [0.7, 0.9] },
  ], "triple");

  assert.deepEqual(chunks, [
    { text: "uno dos tres", timestamp: [0, 0.6] },
    { text: "cuatro", timestamp: [0.7, 0.9] },
  ]);
});
