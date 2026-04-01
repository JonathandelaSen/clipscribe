import test from "node:test";
import assert from "node:assert/strict";

import {
  CREATOR_SUBTITLE_MAX_BORDER_WIDTH,
  CREATOR_SUBTITLE_MAX_LETTER_WIDTH,
  cssTextShadowFromStyle,
  getDefaultCreatorSubtitleStyle,
  getSubtitleLetterWidthOffsets,
  getSubtitleMaxCharsPerLine,
  resolveCreatorSubtitleStyle,
} from "../../../src/lib/creator/subtitle-style";

test("getDefaultCreatorSubtitleStyle returns styling defaults with subtitle background config", () => {
  const style = getDefaultCreatorSubtitleStyle("clean_caption");

  assert.equal(style.preset, "clean_caption");
  assert.equal(style.letterWidth, 1.04);
  assert.equal(style.borderColor, "#2A2A2A");
  assert.equal(style.borderWidth, 3);
  assert.equal(style.shadowColor, "#000000");
  assert.equal(style.shadowOpacity, 0.32);
  assert.equal(style.shadowDistance, 2.2);
  assert.equal(style.backgroundEnabled, false);
  assert.equal(style.backgroundColor, "#111111");
  assert.equal(style.backgroundOpacity, 0.72);
  assert.equal(style.backgroundRadius, 22);
  assert.equal(style.backgroundPaddingX, 22);
  assert.equal(style.backgroundPaddingY, 11);
});

test("resolveCreatorSubtitleStyle maps legacy outline and background settings", () => {
  const style = resolveCreatorSubtitleStyle("clean_caption", {
    outlineColor: "#101010",
    outlineWidth: 4.5,
    backgroundColor: "#FF00FF",
    backgroundOpacity: 0.95,
    backgroundRadius: 24,
    backgroundPadding: 12,
    textCase: "uppercase",
  });

  assert.equal(style.borderColor, "#101010");
  assert.equal(style.borderWidth, 4.5);
  assert.equal(style.letterWidth, 1.04);
  assert.equal(style.shadowColor, "#000000");
  assert.equal(style.shadowOpacity, 0.32);
  assert.equal(style.shadowDistance, 2.2);
  assert.equal(style.textCase, "uppercase");
  assert.equal(style.backgroundEnabled, true);
  assert.equal(style.backgroundColor, "#FF00FF");
  assert.equal(style.backgroundOpacity, 0.95);
  assert.equal(style.backgroundRadius, 24);
  assert.equal(style.backgroundPaddingX, 12);
  assert.equal(style.backgroundPaddingY, 12);
});

test("resolveCreatorSubtitleStyle clamps letter width into the supported export range", () => {
  const style = resolveCreatorSubtitleStyle("bold_pop", {
    letterWidth: 2,
  });

  assert.equal(style.letterWidth, CREATOR_SUBTITLE_MAX_LETTER_WIDTH);
});

test("resolveCreatorSubtitleStyle clamps border width into the supported export range", () => {
  const style = resolveCreatorSubtitleStyle("clean_caption", {
    borderWidth: 999,
  });

  assert.equal(style.borderWidth, CREATOR_SUBTITLE_MAX_BORDER_WIDTH);
});

test("resolveCreatorSubtitleStyle honors switching text case back to original", () => {
  const style = resolveCreatorSubtitleStyle("bold_pop", {
    textCase: "original",
  });

  assert.equal(style.textCase, "original");
});

test("getSubtitleLetterWidthOffsets only widens text when the setting is meaningfully above default", () => {
  assert.deepEqual(getSubtitleLetterWidthOffsets(56, 1.04), []);
  assert.deepEqual(getSubtitleLetterWidthOffsets(56, 1.4), [-4.03, -2.22, 2.22, 4.03]);
});

test("cssTextShadowFromStyle returns deterministic CSS shadow values", () => {
  assert.equal(
    cssTextShadowFromStyle({
      shadowColor: "#000000",
      shadowOpacity: 0.35,
      shadowDistance: 2,
    }),
    "2.00px 2.00px 0 rgba(0, 0, 0, 0.350)"
  );

  assert.equal(
    cssTextShadowFromStyle({
      shadowColor: "#123456",
      shadowOpacity: 0,
      shadowDistance: 4,
    }),
    "none"
  );
});

test("getSubtitleMaxCharsPerLine narrows wrapping as letter width increases", () => {
  assert.equal(getSubtitleMaxCharsPerLine(56, 1, 1080), 28);
  assert.equal(getSubtitleMaxCharsPerLine(56, 1.2, 1080), 23);
  assert.equal(getSubtitleMaxCharsPerLine(56, 1.6, 1080), 19);
  assert.equal(getSubtitleMaxCharsPerLine(56, 2, 1080), 19);
});
