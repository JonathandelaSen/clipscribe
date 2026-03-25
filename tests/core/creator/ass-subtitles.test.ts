import assert from "node:assert/strict";
import test from "node:test";

import { buildAssSubtitleDocument } from "../../../src/lib/server/creator/shorts/ass-subtitles";

test("buildAssSubtitleDocument emits ASS script info, style, and dialogue events", () => {
  const ass = buildAssSubtitleDocument({
    canvasWidth: 1080,
    canvasHeight: 1920,
    anchorX: 540,
    anchorY: 1498,
    fontSize: 56,
    maxCharsPerLine: 16,
    style: {
      preset: "clean_caption",
      textColor: "#FFFFFF",
      letterWidth: 1.04,
      borderColor: "#2A2A2A",
      borderWidth: 3,
      shadowColor: "#000000",
      shadowOpacity: 0.32,
      shadowDistance: 2.2,
      textCase: "original",
      backgroundEnabled: false,
      backgroundColor: "#111111",
      backgroundOpacity: 0.72,
      backgroundRadius: 22,
      backgroundPaddingX: 22,
      backgroundPaddingY: 11,
    },
    chunks: [
      {
        text: "This line should wrap into two rows",
        start: 3,
        end: 5,
      },
    ],
  });

  assert.match(ass, /\[Script Info\]/);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Style: Default,Inter,56/);
  assert.match(ass, /Dialogue: 0,0:00:03\.00,0:00:05\.00,Default/);
  assert.match(ass, /\\an5\\pos\(540,1498\)/);
  assert.match(ass, /\\N/);
});
