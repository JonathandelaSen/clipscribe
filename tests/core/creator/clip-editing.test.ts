import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTrimNudgesToClip,
  createManualFallbackClip,
  createManualFallbackPlan,
  deriveTrimNudgesFromSavedClip,
} from "../../../src/lib/creator/core/clip-editing";

test("createManualFallbackClip defaults to 60s and english when duration is unknown", () => {
  const clip = createManualFallbackClip({});

  assert.equal(clip.id, "manual_clip_fallback");
  assert.equal(clip.startSeconds, 0);
  assert.equal(clip.endSeconds, 60);
  assert.equal(clip.durationSeconds, 60);
  assert.equal(clip.suggestedSubtitleLanguage, "en");
});

test("createManualFallbackClip clamps to source duration and rounds to 2 decimals", () => {
  const clip = createManualFallbackClip({
    sourceDurationSeconds: 12.3456,
    subtitleLanguage: "es",
  });

  assert.equal(clip.endSeconds, 12.35);
  assert.equal(clip.durationSeconds, 12.35);
  assert.equal(clip.suggestedSubtitleLanguage, "es");
});

test("createManualFallbackPlan links to the requested clip id", () => {
  const plan = createManualFallbackPlan("clip_123");

  assert.equal(plan.clipId, "clip_123");

  assert.equal(plan.editorPreset.aspectRatio, "9:16");
  assert.deepEqual(plan.editorPreset.targetDurationRange, [15, 60]);
});

test("applyTrimNudgesToClip clamps start/end against source duration and minimum 1s duration", () => {
  const baseClip = {
    id: "clip_a",
    startSeconds: 10,
    endSeconds: 30,
    durationSeconds: 20,
    title: "A",
  };

  const edited = applyTrimNudgesToClip(baseClip, {
    sourceDurationSeconds: 20,
    trimStartNudge: 15,
    trimEndNudge: -100,
  });

  assert.equal(edited.startSeconds, 19);
  assert.equal(edited.endSeconds, 20);
  assert.equal(edited.durationSeconds, 1);
  assert.equal(edited.title, "A");
});

test("applyTrimNudgesToClip preserves precision to 2 decimals", () => {
  const baseClip = {
    id: "clip_b",
    startSeconds: 1.23,
    endSeconds: 9.87,
    durationSeconds: 8.64,
  };

  const edited = applyTrimNudgesToClip(baseClip, {
    trimStartNudge: 0.105,
    trimEndNudge: 0.205,
  });

  assert.equal(edited.startSeconds, 1.33);
  assert.equal(edited.endSeconds, 10.07);
  assert.equal(edited.durationSeconds, 8.74);
});

test("deriveTrimNudgesFromSavedClip returns rounded trim deltas", () => {
  const baseClip = {
    id: "clip_base",
    startSeconds: 12,
    endSeconds: 42,
    durationSeconds: 30,
  };
  const savedClip = {
    id: "clip_saved",
    startSeconds: 11.345,
    endSeconds: 43.789,
    durationSeconds: 32.444,
  };

  const nudges = deriveTrimNudgesFromSavedClip(baseClip, savedClip);
  assert.deepEqual(nudges, {
    trimStartNudge: -0.65,
    trimEndNudge: 1.79,
  });
});
