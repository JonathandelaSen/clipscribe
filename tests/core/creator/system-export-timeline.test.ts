import assert from "node:assert/strict";
import test from "node:test";

import { prepareSystemExportTimelineArtifacts } from "../../../src/lib/creator/system-export-timeline";

test("prepareSystemExportTimelineArtifacts keeps subtitle and overlay timing clip-relative after trim", async () => {
  const short = {
    id: "short_1",
    startSeconds: 44,
    endSeconds: 65,
    durationSeconds: 21,
    score: 90,
    title: "Short",
    reason: "Reason",
    caption: "Caption",
    openingText: "Hook",
    endCardText: "Outro",
    sourceChunkIndexes: [0],
    suggestedSubtitleLanguage: "es",
    editorPreset: {
      aspectRatio: "9:16" as const,
      resolution: "1080x1920" as const,
      subtitleStyle: "clean_caption" as const,
      safeTopPct: 10,
      safeBottomPct: 12,
      targetDurationRange: [15, 60] as [number, number],
    },
  };
  const adjustedShort = {
    ...short,
    startSeconds: 10,
    endSeconds: 31,
  };
  const editor = {
    zoom: 1,
    panX: 0,
    panY: 0,
    subtitleScale: 1,
    subtitleXPositionPct: 50,
    subtitleYOffsetPct: 78,
    showSubtitles: true,
    showSafeZones: false,
    introOverlay: {
      enabled: true,
      text: "Intro",
      startOffsetSeconds: 0,
      durationSeconds: 2,
      positionXPercent: 50,
      positionYPercent: 24,
      scale: 1,
      maxWidthPct: 78,
    },
  };

  const capturedOverlayOffsets: number[] = [];
  const capturedSubtitleOffsets: number[] = [];

  const result = await prepareSystemExportTimelineArtifacts(
    {
      short,
      adjustedShort,
      editor,
      subtitleChunks: [{ text: "hola", timestamp: [44, 46] }],
    },
    {
      renderTextOverlayToPngFramesFn: async (input) => {
        capturedOverlayOffsets.push(input.timeOffsetSeconds);
        if (!input.overlay.enabled) return [];
        return [
          {
            pngBytes: new Uint8Array([1, 2, 3]),
            start: input.overlay.startOffsetSeconds + input.timeOffsetSeconds,
            end: input.overlay.startOffsetSeconds + input.overlay.durationSeconds + input.timeOffsetSeconds,
            vfsPath: "/tmp/intro_overlay.png",
            kind: "intro_overlay",
            x: 100,
            y: 100,
            width: 400,
            height: 120,
          },
        ];
      },
      buildCreatorSemanticSubtitlePayloadFn: (input) => {
        capturedSubtitleOffsets.push(input.timeOffsetSeconds ?? 0);
        return {
          canvasWidth: 1080,
          canvasHeight: 1920,
          anchorX: 540,
          anchorY: 1500,
          fontSize: 56,
          maxCharsPerLine: 24,
          style: {
            preset: "clean_caption",
            textColor: "#FFFFFF",
            letterWidth: 1.04,
            borderColor: "#2A2A2A",
            borderWidth: 3,
            shadowColor: "#000000",
            shadowOpacity: 0.32,
            shadowDistance: 2.2,
            backgroundEnabled: false,
            backgroundColor: "#111111",
            backgroundOpacity: 0.72,
            backgroundRadius: 22,
            backgroundPaddingX: 22,
            backgroundPaddingY: 11,
            textCase: "original",
          },
          chunks: [{ text: "hola", start: input.timeOffsetSeconds ?? 0, end: 2 + (input.timeOffsetSeconds ?? 0) }],
        };
      },
    }
  );

  assert.deepEqual(capturedOverlayOffsets, [0, 0]);
  assert.deepEqual(capturedSubtitleOffsets, [0]);
  assert.equal(result.introOverlayFrames[0]?.start, 0);
  assert.equal(result.introOverlayFrames[0]?.end, 2);
  assert.equal(result.semanticSubtitles?.chunks[0]?.start, 0);
  assert.equal(result.semanticSubtitles?.chunks[0]?.end, 2);
  assert.equal(result.subtitleRenderMode, "fast_ass");
});
