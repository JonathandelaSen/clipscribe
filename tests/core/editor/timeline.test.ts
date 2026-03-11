import test from "node:test";
import assert from "node:assert/strict";

import {
  clampAudioTrackToAsset,
  clampVideoClipToAsset,
  findClipAtProjectTime,
  getProjectDuration,
  getTimelineClipPlacements,
  reorderTimelineClip,
  splitTimelineClip,
} from "../../../src/lib/editor/core/timeline";
import { createDefaultAudioTrack, createDefaultVideoClip, createEmptyEditorProject } from "../../../src/lib/editor/storage";

test("getTimelineClipPlacements creates a continuous ripple sequence", () => {
  const clips = [
    createDefaultVideoClip({ assetId: "a", label: "Intro", durationSeconds: 5 }),
    createDefaultVideoClip({ assetId: "b", label: "Body", durationSeconds: 7 }),
  ];
  const placements = getTimelineClipPlacements(clips);

  assert.equal(placements[0].startSeconds, 0);
  assert.equal(placements[0].endSeconds, 5);
  assert.equal(placements[1].startSeconds, 5);
  assert.equal(placements[1].endSeconds, 12);
});

test("splitTimelineClip splits the selected clip around the playhead", () => {
  const clips = [createDefaultVideoClip({ assetId: "a", label: "Scene", durationSeconds: 10 })];
  const split = splitTimelineClip(clips, clips[0].id, 4);

  assert.equal(split.length, 2);
  assert.equal(split[0].trimStartSeconds, 0);
  assert.equal(split[0].trimEndSeconds, 4);
  assert.equal(split[1].trimStartSeconds, 4);
  assert.equal(split[1].trimEndSeconds, 10);
});

test("reorderTimelineClip moves a clip to the requested index", () => {
  const clips = [
    createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 2 }),
    createDefaultVideoClip({ assetId: "b", label: "B", durationSeconds: 2 }),
    createDefaultVideoClip({ assetId: "c", label: "C", durationSeconds: 2 }),
  ];
  const reordered = reorderTimelineClip(clips, clips[2].id, 0);

  assert.deepEqual(reordered.map((clip) => clip.assetId), ["c", "a", "b"]);
});

test("clamp trim helpers enforce asset boundaries and minimum durations", () => {
  const video = clampVideoClipToAsset(
    {
      ...createDefaultVideoClip({ assetId: "a", label: "Clip", durationSeconds: 10 }),
      trimStartSeconds: 9.8,
      trimEndSeconds: 20,
    },
    10
  );
  const audio = clampAudioTrackToAsset(
    {
      ...createDefaultAudioTrack({ assetId: "aud", durationSeconds: 30 }),
      trimStartSeconds: 29.9,
      trimEndSeconds: 80,
      startOffsetSeconds: -5,
    },
    30
  );

  assert.equal(video.trimStartSeconds, 9.5);
  assert.equal(video.trimEndSeconds, 10);
  assert.equal(audio.trimStartSeconds, 29.5);
  assert.equal(audio.trimEndSeconds, 30);
  assert.equal(audio.startOffsetSeconds, 0);
});

test("getProjectDuration respects the longer of video sequence or audio bed", () => {
  const project = createEmptyEditorProject();
  project.timeline.videoClips = [createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 8 })];
  project.timeline.audioTrack = {
    ...createDefaultAudioTrack({ assetId: "aud", durationSeconds: 15 }),
    startOffsetSeconds: 2,
  };

  assert.equal(getProjectDuration(project), 17);
});

test("findClipAtProjectTime resolves the active clip in sequence time", () => {
  const clips = [
    createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 4 }),
    createDefaultVideoClip({ assetId: "b", label: "B", durationSeconds: 6 }),
  ];
  const found = findClipAtProjectTime(clips, 6.1);

  assert.equal(found?.clip.assetId, "b");
  assert.equal(found?.startSeconds, 4);
});
