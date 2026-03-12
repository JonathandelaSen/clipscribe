import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT,
  BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS,
  buildSegmentedBrowserRenderSegments,
  shouldUseSegmentedBrowserRender,
} from "../../../src/lib/editor/local-render-segments";
import type { EditorProjectRecord } from "../../../src/lib/editor/types";

function createTestProject(): EditorProjectRecord {
  return {
    id: "project_1",
    name: "Long Timeline",
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: 0,
    status: "draft",
    aspectRatio: "16:9",
    assetIds: ["video_1", "video_2", "video_3", "video_4", "video_5", "music_1"],
    timeline: {
      playheadSeconds: 0,
      zoomLevel: 1,
      selectedItem: undefined,
      videoClips: [
        {
          id: "clip_1",
          assetId: "video_1",
          label: "Clip 1",
          trimStartSeconds: 0,
          trimEndSeconds: 40,
          canvas: { zoom: 1, panX: 0, panY: 0 },
          volume: 1,
          muted: false,
          actions: { reverse: false },
        },
        {
          id: "clip_2",
          assetId: "video_2",
          label: "Clip 2",
          trimStartSeconds: 0,
          trimEndSeconds: 40,
          canvas: { zoom: 1, panX: 0, panY: 0 },
          volume: 1,
          muted: false,
          actions: { reverse: false },
        },
        {
          id: "clip_3",
          assetId: "video_3",
          label: "Clip 3",
          trimStartSeconds: 0,
          trimEndSeconds: 40,
          canvas: { zoom: 1, panX: 0, panY: 0 },
          volume: 1,
          muted: false,
          actions: { reverse: false },
        },
        {
          id: "clip_4",
          assetId: "video_4",
          label: "Clip 4",
          trimStartSeconds: 0,
          trimEndSeconds: 40,
          canvas: { zoom: 1, panX: 0, panY: 0 },
          volume: 1,
          muted: false,
          actions: { reverse: false },
        },
        {
          id: "clip_5",
          assetId: "video_5",
          label: "Clip 5",
          trimStartSeconds: 0,
          trimEndSeconds: 40,
          canvas: { zoom: 1, panX: 0, panY: 0 },
          volume: 1,
          muted: false,
          actions: { reverse: false },
        },
      ],
      videoClipGroups: [
        {
          id: "group_1",
          kind: "joined",
          clipIds: ["clip_1", "clip_2"],
          label: "Pair 1",
        },
        {
          id: "group_2",
          kind: "joined",
          clipIds: ["clip_3", "clip_4"],
          label: "Pair 2",
        },
      ],
      audioItems: [
        {
          id: "audio_1",
          assetId: "music_1",
          startOffsetSeconds: 0,
          trimStartSeconds: 0,
          trimEndSeconds: 180,
          volume: 0.65,
          muted: false,
        },
      ],
    },
    subtitles: {
      enabled: false,
      preset: "clean_caption",
      positionXPercent: 50,
      positionYPercent: 84,
      scale: 1,
    },
  };
}

test("shouldUseSegmentedBrowserRender flips on for clip-heavy or duration-heavy timelines", () => {
  assert.equal(shouldUseSegmentedBrowserRender({ clipCount: 6, durationSeconds: 120 }), false);
  assert.equal(shouldUseSegmentedBrowserRender({ clipCount: 18, durationSeconds: 120 }), true);
  assert.equal(shouldUseSegmentedBrowserRender({ clipCount: 6, durationSeconds: 300 }), true);
});

test("buildSegmentedBrowserRenderSegments keeps clip boundaries and slices spanning audio tracks", () => {
  const project = createTestProject();
  const segments = buildSegmentedBrowserRenderSegments({
    project,
    maxClipCount: 2,
    maxDurationSeconds: 90,
  });

  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.videoClips.map((clip) => clip.id)),
    [
      ["clip_1", "clip_2"],
      ["clip_3", "clip_4"],
      ["clip_5"],
    ]
  );
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.audioItems.map((item) => ({
      startOffsetSeconds: item.startOffsetSeconds,
      trimStartSeconds: item.trimStartSeconds,
      trimEndSeconds: item.trimEndSeconds,
    }))),
    [
      [{ startOffsetSeconds: 0, trimStartSeconds: 0, trimEndSeconds: 80 }],
      [{ startOffsetSeconds: 0, trimStartSeconds: 80, trimEndSeconds: 160 }],
      [{ startOffsetSeconds: 0, trimStartSeconds: 160, trimEndSeconds: 180 }],
    ]
  );
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.videoClipGroups.map((group) => group.id)),
    [[], [], []]
  );
});

test("buildSegmentedBrowserRenderSegments defaults stay within the documented segment budgets", () => {
  const project = createTestProject();
  const segments = buildSegmentedBrowserRenderSegments({ project });

  assert.ok(segments.every((segment) => segment.clipCount <= BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT));
  assert.ok(segments.every((segment) => segment.durationSeconds <= BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS));
});

test("buildSegmentedBrowserRenderSegments splits long reversed clips into bounded trim windows", () => {
  const project = createTestProject();
  project.timeline.videoClips = [
    {
      ...project.timeline.videoClips[0],
      id: "reverse_clip",
      label: "Reverse Clip",
      trimStartSeconds: 10,
      trimEndSeconds: 110,
      actions: { reverse: true },
    },
  ];
  project.timeline.videoClipGroups = [];
  project.timeline.audioItems = [];

  const segments = buildSegmentedBrowserRenderSegments({
    project,
    maxClipCount: 1,
    maxDurationSeconds: 40,
  });

  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.videoClips[0]?.trimStartSeconds),
    [70, 30, 10]
  );
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.videoClips[0]?.trimEndSeconds),
    [110, 70, 30]
  );
  assert.deepEqual(
    segments.map((segment) => segment.durationSeconds),
    [40, 40, 20]
  );
});
