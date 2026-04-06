import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalShortExportGeometry,
  buildShortExportGeometryFromLayout,
} from "../../../src/lib/creator/core/export-geometry";
import {
  buildShortPreviewStyle,
  resolveShortFramePanLimits,
  resolveShortFrameLayout,
} from "../../../src/lib/creator/core/short-frame-layout";

const sourceLandscape = { sourceWidth: 1920, sourceHeight: 1080 };

test("resolveShortFrameLayout uses cover crop as the baseline at zoom 1", () => {
  const layout = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  assert.equal(layout.mode, "cover_crop");
  assert.equal(layout.mediaWidth, 3413);
  assert.equal(layout.mediaHeight, 1920);
  assert.equal(layout.cropX, 1167);
  assert.equal(layout.cropY, 0);
  assert.equal(layout.padX, 0);
  assert.equal(layout.padY, 0);
  assert.equal(layout.objectPositionXPercent, 50);
  assert.equal(layout.objectPositionYPercent, 50);
});

test("resolveShortFrameLayout keeps pan clamped while zooming in", () => {
  const centered = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 1.35,
    panX: 0,
    panY: 0,
  });
  const panned = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 1.35,
    panX: 220,
    panY: 0,
  });

  assert.equal(centered.mode, "cover_crop");
  assert.equal(panned.mode, "cover_crop");
  assert.ok(panned.cropX < centered.cropX);
  assert.ok(panned.objectPositionXPercent < centered.objectPositionXPercent);
});

test("resolveShortFramePanLimits reaches the full lateral bounds for a landscape short", () => {
  const limits = resolveShortFramePanLimits({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  const leftEdge = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 1,
    panX: limits.minPanX,
    panY: 0,
  });
  const rightEdge = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 1,
    panX: limits.maxPanX,
    panY: 0,
  });

  assert.equal(limits.minPanX, -1167);
  assert.equal(limits.maxPanX, 1167);
  assert.equal(leftEdge.cropX, 2333);
  assert.equal(rightEdge.cropX, 0);
  assert.equal(leftEdge.objectPositionXPercent, 100);
  assert.equal(rightEdge.objectPositionXPercent, 0);
});

test("resolveShortFrameLayout enters pad mode when zooming out", () => {
  const layout = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 0.5,
    panX: 0,
    panY: 120,
  });

  assert.equal(layout.mode, "zoom_out_pad");
  assert.equal(layout.mediaWidth, 1707);
  assert.equal(layout.mediaHeight, 960);
  assert.equal(layout.canvasWidth, 1707);
  assert.equal(layout.canvasHeight, 1920);
  assert.equal(layout.cropX, 314);
  assert.equal(layout.cropY, 0);
  assert.equal(layout.padY, 600);
});

test("buildShortExportGeometryFromLayout produces the expected FFmpeg filter sequence", () => {
  const layout = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 1080,
    frameHeight: 1920,
    zoom: 0.5,
    panX: 0,
    panY: 0,
  });
  const geometry = buildShortExportGeometryFromLayout(layout);

  assert.equal(geometry.layoutMode, "zoom_out_pad");
  assert.match(
    geometry.filter,
    /^scale=1708:960,pad=1708:1920:0:480:black,crop=1080:1920:314:0,format=yuv420p$/
  );
});

test("buildCanonicalShortExportGeometry derives FFmpeg geometry from the canonical layout", () => {
  const geometry = buildCanonicalShortExportGeometry({
    ...sourceLandscape,
    editor: { zoom: 1, panX: 0, panY: 0 },
    outputWidth: 1080,
    outputHeight: 1920,
  });

  assert.equal(geometry.layoutMode, "cover_crop");
  assert.equal(geometry.scaledWidth, 3414);
  assert.equal(geometry.scaledHeight, 1920);
  assert.equal(geometry.cropX, 1166);
  assert.equal(geometry.cropY, 0);
});

test("buildShortPreviewStyle keeps zoom-out preview clamped to cover-fit", () => {
  const layout = resolveShortFrameLayout({
    ...sourceLandscape,
    frameWidth: 420,
    frameHeight: 746,
    zoom: 0.5,
    panX: 0,
    panY: 0,
  });
  const style = buildShortPreviewStyle(layout);

  assert.equal(style.width, "100%");
  assert.equal(style.height, "100%");
  assert.equal(style.objectPosition, "50% 50%");
});
