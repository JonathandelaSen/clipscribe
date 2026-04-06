import assert from "node:assert/strict";
import test from "node:test";

import { resolveContainedPreviewVideoRect } from "../../../src/lib/creator/core/preview-video-rect";

test("resolveContainedPreviewVideoRect computes contain layout for 16:9 source in 9:16 viewport", () => {
  const rect = resolveContainedPreviewVideoRect({
    viewportWidth: 420,
    viewportHeight: 746,
    sourceWidth: 1920,
    sourceHeight: 1080,
  });

  assert.deepEqual(rect, { width: 420, height: 236 });
});

test("resolveContainedPreviewVideoRect computes contain layout for tall source in 9:16 viewport", () => {
  const rect = resolveContainedPreviewVideoRect({
    viewportWidth: 420,
    viewportHeight: 746,
    sourceWidth: 1080,
    sourceHeight: 1920,
  });

  assert.deepEqual(rect, { width: 420, height: 746 });
});

test("resolveContainedPreviewVideoRect returns null for invalid dimensions", () => {
  const rect = resolveContainedPreviewVideoRect({
    viewportWidth: 0,
    viewportHeight: 746,
    sourceWidth: 1920,
    sourceHeight: 1080,
  });

  assert.equal(rect, null);
});
