import test from "node:test";
import assert from "node:assert/strict";

import {
  getDefaultCreatorTextOverlayState,
  hydrateCreatorShortEditorState,
  resolveCreatorTextOverlayWindow,
} from "../../../src/lib/creator/core/text-overlays";

const samplePlan = {
  id: "plan_1",
  clipId: "clip_1",
  title: "De idea a codigo en minutos",
  caption: "Caption",
  openingText: "Opening",
  endCardText: "Follow for more",
  editorPreset: {
    aspectRatio: "9:16" as const,
    resolution: "1080x1920" as const,
    subtitleStyle: "clean_caption" as const,
    safeTopPct: 12,
    safeBottomPct: 14,
    targetDurationRange: [15, 60] as [number, number],
  },
};

test("AI suggestion defaults preload intro and outro overlay text", () => {
  const intro = getDefaultCreatorTextOverlayState("intro", {
    origin: "ai_suggestion",
    plan: samplePlan,
    clipDurationSeconds: 18,
  });
  const outro = getDefaultCreatorTextOverlayState("outro", {
    origin: "ai_suggestion",
    plan: samplePlan,
    clipDurationSeconds: 18,
  });

  assert.equal(intro.enabled, true);
  assert.equal(intro.text, samplePlan.title);
  assert.equal(intro.startOffsetSeconds, 0);
  assert.equal(outro.enabled, true);
  assert.equal(outro.text, samplePlan.endCardText);
  assert.equal(outro.startOffsetSeconds, 15.4);
});

test("manual editor hydration keeps overlays disabled when missing", () => {
  const hydrated = hydrateCreatorShortEditorState(
    {
      zoom: 1.2,
      panX: 10,
      panY: -5,
      subtitleScale: 1,
      subtitleXPositionPct: 50,
      subtitleYOffsetPct: 78,
    },
    {
      origin: "manual",
      plan: samplePlan,
      clipDurationSeconds: 22,
    }
  );

  assert.equal(hydrated.introOverlay?.enabled, false);
  assert.equal(hydrated.outroOverlay?.enabled, false);
  assert.equal(hydrated.introOverlay?.text, "");
  assert.equal(hydrated.outroOverlay?.text, "");
});

test("overlay windows clamp to clip duration instead of failing", () => {
  const window = resolveCreatorTextOverlayWindow(
    {
      enabled: true,
      text: "Outro",
      startOffsetSeconds: 14,
      durationSeconds: 4,
      positionXPercent: 50,
      positionYPercent: 34,
      scale: 1,
      maxWidthPct: 70,
      style: {},
    },
    15
  );

  assert.equal(window.enabled, true);
  assert.equal(window.startOffsetSeconds, 14);
  assert.equal(window.durationSeconds, 1);
  assert.equal(window.endOffsetSeconds, 15);
});
