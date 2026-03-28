import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBrowserRenderPlan,
  buildSegmentedBrowserRenderSegments,
  selectBrowserRenderProfile,
  shouldUseSegmentedBrowserRender,
} from "../../../src/lib/editor/local-render-segments";
import type { EditorProjectRecord } from "../../../src/lib/editor/types";

function createTestProject(options?: {
  clipDurations?: number[];
  audioItemCount?: number;
  subtitlesEnabled?: boolean;
  reverseFirstClip?: boolean;
}): EditorProjectRecord {
  const clipDurations = options?.clipDurations ?? [40, 40, 40, 40, 40];
  const audioItemCount = options?.audioItemCount ?? 0;

  const videoClips = clipDurations.map((durationSeconds, index) => ({
    id: `clip_${index + 1}`,
    assetId: `video_${index + 1}`,
    label: `Clip ${index + 1}`,
    trimStartSeconds: 0,
    trimEndSeconds: durationSeconds,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    volume: 1,
    muted: false,
    actions: { reverse: options?.reverseFirstClip === true && index === 0 },
  }));

  return {
    id: "project_1",
    name: "Long Timeline",
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: 0,
    status: "draft",
    aspectRatio: "16:9",
    assetIds: [
      ...videoClips.map((clip) => clip.assetId),
      ...Array.from({ length: audioItemCount }, (_value, index) => `music_${index + 1}`),
    ],
    timeline: {
      playheadSeconds: 0,
      zoomLevel: 1,
      selectedItem: undefined,
      imageItems: [],
      videoClips,
      videoClipGroups: [
        {
          id: "group_1",
          kind: "joined",
          clipIds: videoClips.slice(0, 2).map((clip) => clip.id),
          label: "Pair 1",
        },
      ],
      audioItems: Array.from({ length: audioItemCount }, (_value, index) => ({
        id: `audio_${index + 1}`,
        assetId: `music_${index + 1}`,
        startOffsetSeconds: 0,
        trimStartSeconds: 0,
        trimEndSeconds: 180,
        volume: 0.65,
        muted: false,
      })),
    },
    subtitles: {
      source: options?.subtitlesEnabled
        ? {
            kind: "uploaded-srt",
          }
        : {
            kind: "none",
          },
      label: options?.subtitlesEnabled ? "subs.srt" : undefined,
      language: options?.subtitlesEnabled ? "en" : undefined,
      chunks: options?.subtitlesEnabled ? [{ text: "Hello", timestamp: [0, 1] }] : [],
      subtitleTimingMode: "segment",
      offsetSeconds: 0,
      trimStartSeconds: 0,
      trimEndSeconds: options?.subtitlesEnabled ? 1 : 0,
      enabled: options?.subtitlesEnabled ?? false,
      preset: "clean_caption",
      positionXPercent: 50,
      positionYPercent: 90,
      scale: 1,
      style: {},
    },
  };
}

test("selectBrowserRenderProfile chooses low, medium, high, and extreme tiers", () => {
  const lowProject = createTestProject({ clipDurations: [300, 300, 300], audioItemCount: 0 });
  const mediumProject = createTestProject({ clipDurations: [300, 300, 300], audioItemCount: 1 });
  const highProject = createTestProject({ clipDurations: [300, 300, 300], subtitlesEnabled: true });

  assert.equal(selectBrowserRenderProfile({ project: lowProject, resolution: "720p" }).name, "low");
  assert.equal(selectBrowserRenderProfile({ project: mediumProject, resolution: "720p" }).name, "medium");
  assert.equal(selectBrowserRenderProfile({ project: highProject, resolution: "720p" }).name, "high");
  assert.equal(selectBrowserRenderProfile({ project: lowProject, resolution: "4K" }).name, "extreme");
});

test("shouldUseSegmentedBrowserRender respects the active browser budgets", () => {
  assert.equal(
    shouldUseSegmentedBrowserRender({
      clipCount: 3,
      durationSeconds: 120,
      maxClipCount: 3,
      maxDurationSeconds: 120,
    }),
    false
  );
  assert.equal(
    shouldUseSegmentedBrowserRender({
      clipCount: 4,
      durationSeconds: 120,
      maxClipCount: 3,
      maxDurationSeconds: 120,
    }),
    true
  );
  assert.equal(
    shouldUseSegmentedBrowserRender({
      clipCount: 3,
      durationSeconds: 121,
      maxClipCount: 3,
      maxDurationSeconds: 120,
    }),
    true
  );
});

test("buildBrowserRenderPlan broadens segment budgets for long clean 720p exports", () => {
  const project = createTestProject({ clipDurations: [900], audioItemCount: 0 });
  const plan = buildBrowserRenderPlan({ project, resolution: "720p" });
  const segments = buildSegmentedBrowserRenderSegments({
    project,
    maxClipCount: plan.profile.maxClipCount,
    maxDurationSeconds: plan.profile.maxDurationSeconds,
  });

  assert.equal(plan.profile.name, "low");
  assert.equal(plan.profile.maxClipCount, 3);
  assert.equal(plan.profile.maxDurationSeconds, 120);
  assert.equal(plan.shouldSegment, true);
  assert.equal(segments.length, 8);
});

test("buildBrowserRenderPlan skips audio remix and final mux for segmented clip-audio-only exports", () => {
  const project = createTestProject({ clipDurations: [900], audioItemCount: 0 });
  const plan = buildBrowserRenderPlan({ project, resolution: "720p" });

  assert.equal(plan.shouldSegment, true);
  assert.equal(plan.includeAudioInSegments, true);
  assert.equal(plan.needsAudioRemixPass, false);
  assert.equal(plan.needsFinalMuxPass, false);
});

test("buildBrowserRenderPlan keeps the safer segmented audio flow when timeline audio exists", () => {
  const project = createTestProject({ clipDurations: [900], audioItemCount: 1 });
  const plan = buildBrowserRenderPlan({ project, resolution: "720p" });

  assert.equal(plan.profile.name, "medium");
  assert.equal(plan.shouldSegment, true);
  assert.equal(plan.includeAudioInSegments, false);
  assert.equal(plan.needsAudioRemixPass, true);
  assert.equal(plan.needsFinalMuxPass, true);
});

test("buildBrowserRenderPlan does not segment image-only timelines", () => {
  const project = createTestProject({ clipDurations: [], audioItemCount: 1 });
  project.timeline.videoClipGroups = [];
  project.timeline.imageItems = [
    {
      id: "image_1",
      assetId: "image_asset_1",
      label: "Cover",
      canvas: { zoom: 1, panX: 0, panY: 0 },
    },
  ];
  project.assetIds.push("image_asset_1");

  const plan = buildBrowserRenderPlan({ project, resolution: "1080p" });

  assert.equal(plan.shouldSegment, false);
  assert.equal(plan.needsAudioRemixPass, false);
  assert.equal(plan.needsFinalMuxPass, false);
});

test("buildSegmentedBrowserRenderSegments keeps clip boundaries and slices spanning audio tracks", () => {
  const project = createTestProject({ audioItemCount: 1 });
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

test("buildSegmentedBrowserRenderSegments splits long reversed clips into bounded trim windows", () => {
  const project = createTestProject({
    clipDurations: [100],
    audioItemCount: 0,
    reverseFirstClip: true,
  });
  project.timeline.videoClipGroups = [];

  const segments = buildSegmentedBrowserRenderSegments({
    project,
    maxClipCount: 1,
    maxDurationSeconds: 40,
  });

  assert.equal(segments.length, 3);
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.videoClips[0]?.trimStartSeconds),
    [60, 20, 0]
  );
  assert.deepEqual(
    segments.map((segment) => segment.project.timeline.videoClips[0]?.trimEndSeconds),
    [100, 60, 20]
  );
  assert.deepEqual(
    segments.map((segment) => segment.durationSeconds),
    [40, 40, 20]
  );
});
