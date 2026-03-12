import test from "node:test";
import assert from "node:assert/strict";

import { prepareTimelineClipBake } from "../../../src/lib/editor/core/bake";
import { getTimelineClipPlacements } from "../../../src/lib/editor/core/timeline";
import {
  createDefaultAudioTrack,
  createDefaultVideoClip,
  createEmptyEditorProject,
} from "../../../src/lib/editor/storage";

test("prepareTimelineClipBake preserves selected clip order and actions", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const first = createDefaultVideoClip({ assetId: "asset-a", label: "Intro", durationSeconds: 6 });
  const second = createDefaultVideoClip({ assetId: "asset-b", label: "Body", durationSeconds: 5 });
  first.trimStartSeconds = 1;
  first.trimEndSeconds = 4.5;
  first.canvas.zoom = 1.35;
  first.actions.reverse = true;
  second.canvas.panX = 0.2;
  second.canvas.panY = -0.1;
  project.timeline.videoClips = [first, second];

  const placements = getTimelineClipPlacements(project.timeline.videoClips);
  const prepared = prepareTimelineClipBake({
    project,
    clipPlacements: [placements[1], placements[0]],
  });

  assert.deepEqual(prepared.bakedClipIds, [first.id, second.id]);
  assert.equal(prepared.bakedLabel, "Intro + Body");
  assert.equal(prepared.bakeProject.timeline.videoClips[0]?.actions.reverse, true);
  assert.equal(prepared.bakeProject.timeline.videoClips[0]?.trimStartSeconds, 1);
  assert.equal(prepared.bakeProject.timeline.videoClips[0]?.trimEndSeconds, 4.5);
  assert.equal(prepared.bakeProject.timeline.videoClips[1]?.canvas.panX, 0.2);
  assert.equal(prepared.bakeProject.timeline.videoClips[1]?.canvas.panY, -0.1);
});

test("prepareTimelineClipBake disables subtitles, clears groups, and clears audio items", () => {
  const project = createEmptyEditorProject({ aspectRatio: "9:16" });
  const first = createDefaultVideoClip({ assetId: "asset-a", label: "A", durationSeconds: 3 });
  const second = createDefaultVideoClip({ assetId: "asset-b", label: "B", durationSeconds: 4 });
  project.timeline.videoClips = [first, second];
  project.timeline.videoClipGroups = [
    {
      id: "group_1",
      kind: "joined",
      clipIds: [first.id, second.id],
      label: "A + B",
    },
  ];
  project.timeline.audioItems = [createDefaultAudioTrack({ assetId: "music-bed", durationSeconds: 10 })];

  const prepared = prepareTimelineClipBake({
    project,
    clipPlacements: getTimelineClipPlacements(project.timeline.videoClips),
  });

  assert.equal(prepared.bakeProject.subtitles.enabled, false);
  assert.deepEqual(prepared.bakeProject.timeline.videoClipGroups, []);
  assert.deepEqual(prepared.bakeProject.timeline.audioItems, []);
  assert.deepEqual(prepared.bakeProject.timeline.selectedItem, { kind: "video", id: first.id });
});

test("prepareTimelineClipBake dedupes required asset ids", () => {
  const project = createEmptyEditorProject({ aspectRatio: "1:1" });
  const first = createDefaultVideoClip({ assetId: "shared-asset", label: "Take 1", durationSeconds: 2 });
  const second = createDefaultVideoClip({ assetId: "shared-asset", label: "Take 2", durationSeconds: 2 });
  project.timeline.videoClips = [first, second];

  const prepared = prepareTimelineClipBake({
    project,
    clipPlacements: getTimelineClipPlacements(project.timeline.videoClips),
  });

  assert.deepEqual(prepared.requiredAssetIds, ["shared-asset"]);
  assert.deepEqual(prepared.bakeProject.assetIds, ["shared-asset"]);
});
