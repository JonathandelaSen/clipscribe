import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreatorSemanticSubtitlePayload,
  shouldUseCreatorPngSubtitleFallback,
} from "../../../src/lib/creator/semantic-subtitles";

const short = {
  id: "short_1",
  startSeconds: 12,
  endSeconds: 32,
  durationSeconds: 20,
  score: 90,
  title: "Short",
  reason: "Reason",
  caption: "Caption",
  openingText: "Hook",
  endCardText: "Outro",
  sourceChunkIndexes: [0],
  suggestedSubtitleLanguage: "en",
  editorPreset: {
    aspectRatio: "9:16" as const,
    resolution: "1080x1920" as const,
    subtitleStyle: "clean_caption" as const,
    safeTopPct: 10,
    safeBottomPct: 12,
    targetDurationRange: [15, 60] as [number, number],
  },
};

const editor = {
  zoom: 1,
  panX: 0,
  panY: 0,
  subtitleScale: 1,
  subtitleXPositionPct: 50,
  subtitleYOffsetPct: 78,
  showSubtitles: true,
};

test("buildCreatorSemanticSubtitlePayload prepares semantic subtitle cues with time offsets", () => {
  const payload = buildCreatorSemanticSubtitlePayload({
    subtitleChunks: [
      {
        text: "hello world",
        timestamp: [12.5, 14.5],
      },
    ],
    short,
    editor,
    timeOffsetSeconds: 3,
  });

  assert.ok(payload);
  assert.equal(payload?.chunks.length, 1);
  assert.equal(payload?.chunks[0]?.text, "hello world");
  assert.equal(payload?.chunks[0]?.start, 3.5);
  assert.equal(payload?.chunks[0]?.end, 5.5);
});

test("shouldUseCreatorPngSubtitleFallback only trips for unsupported parity-sensitive styles", () => {
  const payload = buildCreatorSemanticSubtitlePayload({
    subtitleChunks: [{ text: "hello", timestamp: [12.5, 13.5] }],
    short,
    editor,
  });

  assert.ok(payload);
  assert.equal(shouldUseCreatorPngSubtitleFallback(payload!.style), false);

  assert.equal(
    shouldUseCreatorPngSubtitleFallback({
      ...payload!.style,
      backgroundEnabled: true,
      backgroundOpacity: 0.8,
    }),
    true
  );
  assert.equal(
    shouldUseCreatorPngSubtitleFallback({
      ...payload!.style,
      letterWidth: payload!.style.letterWidth + 0.2,
    }),
    true
  );
});
