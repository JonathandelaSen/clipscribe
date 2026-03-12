import test from "node:test";
import assert from "node:assert/strict";

import {
  clampAudioItemToAsset,
  clampVideoClipToAsset,
  ensureProjectSelection,
  findClipAtProjectTime,
  getContiguousAudioStartOffset,
  getProjectDuration,
  getVideoClipMediaTime,
  getSelectionForLaneIndex,
  getTimelineClipPlacements,
  insertTimelineAudioItemAfter,
  insertTimelineClipAfter,
  replaceTimelineClipsWithMergedClip,
  reorderTimelineClip,
  resetTimelineAudioItemTrack,
  resetTimelineAudioItemTrim,
  resetTimelineVideoClipAudio,
  resetTimelineVideoClipFrame,
  resetTimelineVideoClipTrim,
  splitTimelineClip,
} from "../../../src/lib/editor/core/timeline";
import {
  DEFAULT_EDITOR_MEDIA_VOLUME,
  createDefaultAudioTrack,
  createDefaultVideoClip,
  createEmptyEditorProject,
  getDefaultEditorCanvasState,
  normalizeLegacyEditorProjectRecord,
} from "../../../src/lib/editor/storage";

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

test("createDefaultVideoClip starts with reverse disabled", () => {
  const clip = createDefaultVideoClip({ assetId: "video-1", label: "Clip", durationSeconds: 5 });

  assert.equal(clip.actions.reverse, false);
});

test("getVideoClipMediaTime maps forward and reversed clips to the correct source time", () => {
  const forwardClip = {
    ...createDefaultVideoClip({ assetId: "video-1", label: "Forward", durationSeconds: 12 }),
    trimStartSeconds: 2,
    trimEndSeconds: 8,
  };
  const reversedClip = {
    ...forwardClip,
    actions: {
      ...forwardClip.actions,
      reverse: true,
    },
  };

  assert.equal(getVideoClipMediaTime(forwardClip, 10, 12.5), 4.5);
  assert.equal(getVideoClipMediaTime(reversedClip, 10, 10), 7.999);
  assert.equal(getVideoClipMediaTime(reversedClip, 10, 12.5), 5.499);
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
  const audio = clampAudioItemToAsset(
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

test("getProjectDuration respects the longer of video sequence or audio items", () => {
  const project = createEmptyEditorProject();
  project.timeline.videoClips = [createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 8 })];
  project.timeline.audioItems = [
    {
      ...createDefaultAudioTrack({ assetId: "aud", durationSeconds: 15 }),
      startOffsetSeconds: 2,
    },
  ];

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

test("normalizeLegacyEditorProjectRecord upgrades selected clip and audio track fields", () => {
  const project = createEmptyEditorProject();
  const clip = createDefaultVideoClip({ assetId: "video-1", label: "Clip", durationSeconds: 5 });
  const audio = createDefaultAudioTrack({ assetId: "audio-1", durationSeconds: 8 });
  const legacyProject = {
    ...project,
    timeline: {
      ...project.timeline,
      selectedClipId: clip.id,
      videoClips: [clip],
      audioTrack: audio,
    },
  };

  const normalized = ensureProjectSelection(normalizeLegacyEditorProjectRecord(legacyProject));

  assert.deepEqual(normalized.timeline.selectedItem, { kind: "video", id: clip.id });
  assert.equal(normalized.timeline.audioItems.length, 1);
  assert.equal(normalized.timeline.audioItems[0].id, audio.id);
  assert.equal(normalized.timeline.videoClips[0]?.actions.reverse, false);
});

test("insertTimelineClipAfter supports merge-style insertion after the selected clip", () => {
  const first = createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 2 });
  const second = createDefaultVideoClip({ assetId: "b", label: "B", durationSeconds: 2 });
  const merged = createDefaultVideoClip({ assetId: "c", label: "C", durationSeconds: 2 });

  const nextClips = insertTimelineClipAfter([first, second], merged, first.id);

  assert.deepEqual(
    nextClips.map((clip) => clip.assetId),
    ["a", "c", "b"]
  );
});

test("replaceTimelineClipsWithMergedClip collapses selected clips into one clip", () => {
  const first = createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 2 });
  const second = createDefaultVideoClip({ assetId: "b", label: "B", durationSeconds: 2 });
  const third = createDefaultVideoClip({ assetId: "c", label: "C", durationSeconds: 2 });
  const merged = createDefaultVideoClip({ assetId: "merged", label: "Merged", durationSeconds: 4 });

  const nextClips = replaceTimelineClipsWithMergedClip([first, second, third], merged, [first.id, second.id]);

  assert.deepEqual(
    nextClips.map((clip) => clip.assetId),
    ["merged", "c"]
  );
});

test("insertTimelineAudioItemAfter ripples later audio items to the right", () => {
  const first = {
    ...createDefaultAudioTrack({ assetId: "aud-a", durationSeconds: 4 }),
    startOffsetSeconds: 0,
    trimEndSeconds: 4,
  };
  const second = {
    ...createDefaultAudioTrack({ assetId: "aud-b", durationSeconds: 3 }),
    startOffsetSeconds: 4,
    trimEndSeconds: 3,
  };
  const inserted = {
    ...createDefaultAudioTrack({ assetId: "aud-c", durationSeconds: 2 }),
    trimEndSeconds: 2,
  };

  const nextItems = insertTimelineAudioItemAfter([first, second], inserted, first.id);

  assert.deepEqual(
    nextItems.map((item) => ({
      assetId: item.assetId,
      startOffsetSeconds: item.startOffsetSeconds,
    })),
    [
      { assetId: "aud-a", startOffsetSeconds: 0 },
      { assetId: "aud-c", startOffsetSeconds: 4 },
      { assetId: "aud-b", startOffsetSeconds: 6 },
    ]
  );
});

test("getSelectionForLaneIndex falls back to the next remaining item after delete", () => {
  const videoA = createDefaultVideoClip({ assetId: "a", label: "A", durationSeconds: 2 });
  const videoB = createDefaultVideoClip({ assetId: "b", label: "B", durationSeconds: 2 });
  const audioA = createDefaultAudioTrack({ assetId: "aud-a", durationSeconds: 5 });
  const selection = getSelectionForLaneIndex("video", 1, [videoA, videoB], [audioA]);
  const nextSelection = getSelectionForLaneIndex("video", 1, [videoA], [audioA]);

  assert.deepEqual(selection, { kind: "video", id: videoB.id });
  assert.deepEqual(nextSelection, { kind: "video", id: videoA.id });
});

test("reset helpers restore selected clip defaults", () => {
  const clip = {
    ...createDefaultVideoClip({ assetId: "video-1", label: "Clip", durationSeconds: 12 }),
    trimStartSeconds: 3.25,
    trimEndSeconds: 8.75,
    canvas: {
      zoom: 1.6,
      panX: 48,
      panY: -72,
    },
    volume: 0.35,
    muted: true,
  };

  const resetTrim = resetTimelineVideoClipTrim(clip, 12);
  const resetFrame = resetTimelineVideoClipFrame(clip);
  const resetAudio = resetTimelineVideoClipAudio(clip);

  assert.equal(resetTrim.trimStartSeconds, 0);
  assert.equal(resetTrim.trimEndSeconds, 12);
  assert.deepEqual(resetFrame.canvas, getDefaultEditorCanvasState());
  assert.equal(resetAudio.volume, DEFAULT_EDITOR_MEDIA_VOLUME);
  assert.equal(resetAudio.muted, false);
});

test("reset helpers restore selected audio defaults", () => {
  const first = {
    ...createDefaultAudioTrack({ assetId: "audio-1", durationSeconds: 4 }),
    trimEndSeconds: 4,
    startOffsetSeconds: 0,
  };
  const second = {
    ...createDefaultAudioTrack({ assetId: "audio-2", durationSeconds: 6 }),
    trimStartSeconds: 2,
    trimEndSeconds: 5.5,
    startOffsetSeconds: 12,
    volume: 0.25,
    muted: true,
  };

  const resetTrim = resetTimelineAudioItemTrim(second, 6);
  const contiguousStart = getContiguousAudioStartOffset([first, second], second.id);
  const resetTrack = resetTimelineAudioItemTrack([first, second], second.id);

  assert.equal(resetTrim.trimStartSeconds, 0);
  assert.equal(resetTrim.trimEndSeconds, 6);
  assert.equal(contiguousStart, 4);
  assert.equal(resetTrack[1].startOffsetSeconds, 4);
  assert.equal(resetTrack[1].volume, DEFAULT_EDITOR_MEDIA_VOLUME);
  assert.equal(resetTrack[1].muted, false);
});
