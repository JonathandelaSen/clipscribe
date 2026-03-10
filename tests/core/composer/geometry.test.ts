import test from "node:test";
import assert from "node:assert/strict";

import { buildComposerItemGeometry } from "../../../src/lib/composer/core/geometry";

test("fit geometry preserves full frame for portrait output", () => {
  const geometry = buildComposerItemGeometry({
    sourceWidth: 1920,
    sourceHeight: 1080,
    outputWidth: 1080,
    outputHeight: 1920,
    fitMode: "fit",
  });

  assert.equal(geometry.scaledWidth, 1080);
  assert.equal(geometry.scaledHeight, 608);
  assert.equal(geometry.padY, 656);
  assert.ok(geometry.filter.includes("pad=1080:1920"));
});

test("fill geometry crops landscape into square output with offset control", () => {
  const geometry = buildComposerItemGeometry({
    sourceWidth: 1920,
    sourceHeight: 1080,
    outputWidth: 1080,
    outputHeight: 1080,
    fitMode: "fill",
    offsetX: 100,
  });

  assert.equal(geometry.scaledWidth, 1920);
  assert.equal(geometry.scaledHeight, 1080);
  assert.equal(geometry.cropX, 840);
  assert.equal(geometry.cropY, 0);
  assert.ok(geometry.filter.includes("crop=1080:1080:840:0"));
});

test("fill geometry handles landscape output without stretching portrait footage", () => {
  const geometry = buildComposerItemGeometry({
    sourceWidth: 1080,
    sourceHeight: 1920,
    outputWidth: 1920,
    outputHeight: 1080,
    fitMode: "fill",
    offsetY: -100,
  });

  assert.equal(geometry.scaledWidth, 1920);
  assert.equal(geometry.scaledHeight, 3413);
  assert.equal(geometry.cropX, 0);
  assert.equal(geometry.cropY, 0);
  assert.ok(geometry.filter.includes("crop=1920:1080:0:0"));
});

