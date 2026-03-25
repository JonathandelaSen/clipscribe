import assert from "node:assert/strict";
import test from "node:test";

import { computeCreatorTextOverlayRasterBounds } from "../../../src/lib/creator/text-overlay-bounds";

test("headline_bold intro overlays stay bounded well below fullscreen", () => {
  const bounds = computeCreatorTextOverlayRasterBounds({
    positionXPercent: 50,
    positionYPercent: 24,
    fontSize: 94,
    style: {
      backgroundEnabled: true,
      backgroundOpacity: 0.48,
      backgroundPaddingX: 34,
      backgroundPaddingY: 18,
      borderWidth: 3.8,
      shadowOpacity: 0.34,
      shadowDistance: 4.2,
    },
    lineWidths: [620],
  });

  assert.ok(bounds.width > 620);
  assert.ok(bounds.width < 1080);
  assert.ok(bounds.height < 320);
  assert.ok(bounds.x > 0);
  assert.ok(bounds.y > 0);
});

test("glass_card outro overlays expand for multiline text and background padding", () => {
  const bounds = computeCreatorTextOverlayRasterBounds({
    positionXPercent: 50,
    positionYPercent: 34,
    fontSize: 67,
    style: {
      backgroundEnabled: true,
      backgroundOpacity: 0.58,
      backgroundPaddingX: 30,
      backgroundPaddingY: 18,
      borderWidth: 1.2,
      shadowOpacity: 0.2,
      shadowDistance: 3.2,
    },
    lineWidths: [360, 540, 420],
  });

  assert.ok(bounds.width > 600);
  assert.ok(bounds.height > 220);
  assert.equal(bounds.x + bounds.width <= 1080, true);
  assert.equal(bounds.y + bounds.height <= 1920, true);
});

test("neon_punch overlays clamp safely near the top-left corner", () => {
  const bounds = computeCreatorTextOverlayRasterBounds({
    positionXPercent: 6,
    positionYPercent: 7,
    fontSize: 113,
    style: {
      backgroundEnabled: true,
      backgroundOpacity: 0.5,
      backgroundPaddingX: 32,
      backgroundPaddingY: 17,
      borderWidth: 3,
      shadowOpacity: 0.42,
      shadowDistance: 4.6,
    },
    lineWidths: [680, 620],
  });

  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0);
  assert.ok(bounds.width < 1080);
  assert.ok(bounds.height < 1920);
});

test("thick borders and shadows still clamp within the output canvas near the bottom-right", () => {
  const bounds = computeCreatorTextOverlayRasterBounds({
    positionXPercent: 94,
    positionYPercent: 92,
    fontSize: 81,
    style: {
      backgroundEnabled: true,
      backgroundOpacity: 0.5,
      backgroundPaddingX: 32,
      backgroundPaddingY: 17,
      borderWidth: 8,
      shadowOpacity: 0.42,
      shadowDistance: 16,
    },
    lineWidths: [560, 520],
  });

  assert.equal(bounds.x + bounds.width <= 1080, true);
  assert.equal(bounds.y + bounds.height <= 1920, true);
  assert.ok(bounds.x > 0);
  assert.ok(bounds.y > 0);
});
