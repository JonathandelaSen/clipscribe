import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorCanvasPreviewLayout,
  getEditorCanvasCoverZoom,
} from "../../../src/lib/editor/core/canvas-frame";

test("buildEditorCanvasPreviewLayout shows the true contained image framing by default", () => {
  const layout = buildEditorCanvasPreviewLayout({
    sourceWidth: 1200,
    sourceHeight: 900,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    viewportWidth: 800,
    viewportHeight: 450,
  });

  assert.equal(layout.scaledWidth, 600);
  assert.equal(layout.scaledHeight, 450);
  assert.equal(layout.padX, 100);
  assert.equal(layout.padY, 0);
  assert.equal(layout.cropX, 0);
  assert.equal(layout.cropY, 0);
});

test("getEditorCanvasCoverZoom returns the minimum zoom needed to cover the full frame", () => {
  const zoom = getEditorCanvasCoverZoom({
    sourceWidth: 1200,
    sourceHeight: 900,
    outputWidth: 1920,
    outputHeight: 1080,
  });

  assert.equal(zoom, 1.3333);
});

test("buildEditorCanvasPreviewLayout crops instead of padding once the image is fit to frame", () => {
  const layout = buildEditorCanvasPreviewLayout({
    sourceWidth: 1200,
    sourceHeight: 900,
    canvas: { zoom: 1.3333, panX: 0, panY: 0 },
    viewportWidth: 800,
    viewportHeight: 450,
  });

  assert.equal(layout.scaledWidth, 800);
  assert.equal(layout.scaledHeight, 600);
  assert.equal(layout.padX, 0);
  assert.equal(layout.padY, 0);
  assert.equal(layout.cropX, 0);
  assert.equal(layout.cropY, 75);
});
