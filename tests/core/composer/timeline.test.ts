import test from "node:test";
import assert from "node:assert/strict";

import type { ComposerTimelineItem } from "../../../src/lib/composer/types";
import {
  clampTimelineItemToAsset,
  computeProjectDurationSeconds,
  duplicateTimelineItem,
  hasVisualLaneOverlap,
  pasteTimelineItem,
} from "../../../src/lib/composer/core/timeline";

const audioItem: ComposerTimelineItem = {
  id: "audio_1",
  assetId: "asset_audio",
  lane: "audio",
  timelineStartSeconds: 8,
  sourceStartSeconds: 0,
  durationSeconds: 7,
  volume: 1,
  muted: false,
};

const videoItem: ComposerTimelineItem = {
  id: "video_1",
  assetId: "asset_video",
  lane: "video",
  timelineStartSeconds: 0,
  sourceStartSeconds: 0,
  durationSeconds: 10,
  volume: 0.8,
  muted: false,
  fitMode: "fill",
  offsetX: 0,
  offsetY: 0,
};

test("computeProjectDurationSeconds uses the furthest end across gaps and audio tails", () => {
  assert.equal(computeProjectDurationSeconds([videoItem, audioItem]), 15);
});

test("clampTimelineItemToAsset keeps trims within source media bounds", () => {
  const clamped = clampTimelineItemToAsset(
    {
      ...videoItem,
      sourceStartSeconds: 9.5,
      durationSeconds: 4,
    },
    11
  );

  assert.equal(clamped.sourceStartSeconds, 9.5);
  assert.equal(clamped.durationSeconds, 1.5);
});

test("hasVisualLaneOverlap rejects overlapping video placements but ignores audio items", () => {
  const overlap = hasVisualLaneOverlap(
    [videoItem, audioItem],
    {
      ...videoItem,
      id: "video_2",
      timelineStartSeconds: 9.5,
      durationSeconds: 5,
    }
  );
  const noOverlap = hasVisualLaneOverlap(
    [videoItem, audioItem],
    {
      ...videoItem,
      id: "video_3",
      timelineStartSeconds: 10,
      durationSeconds: 5,
    }
  );

  assert.equal(overlap, true);
  assert.equal(noOverlap, false);
});

test("duplicate and paste keep asset linkage while creating independent timeline instances", () => {
  const duplicate = duplicateTimelineItem(videoItem, "video_2");
  const pasted = pasteTimelineItem(videoItem, "video_3", 32.25);

  assert.equal(duplicate.assetId, videoItem.assetId);
  assert.equal(duplicate.id, "video_2");
  assert.equal(duplicate.timelineStartSeconds, 10);
  assert.equal(pasted.assetId, videoItem.assetId);
  assert.equal(pasted.id, "video_3");
  assert.equal(pasted.timelineStartSeconds, 32.25);
  assert.notEqual(pasted.id, videoItem.id);
});

