import test from "node:test";
import assert from "node:assert/strict";

import type {
  ComposerAssetRecord,
  ComposerExportSettings,
  ComposerTimelineItem,
} from "../../../src/lib/composer/types";
import { buildComposerRenderPlan } from "../../../src/lib/composer/core/render-plan";
import { getComposerExportPreset } from "../../../src/lib/composer/core/export-presets";

const exportSettings: ComposerExportSettings = {
  ratio: "9:16",
  quality: "medium",
};

const baseAssets: ComposerAssetRecord[] = [
  {
    id: "asset_audio",
    projectId: "proj",
    type: "audio",
    filename: "music.wav",
    mimeType: "audio/wav",
    sizeBytes: 1024,
    durationSeconds: 15,
    hasAudio: true,
    fileId: "file_audio",
    createdAt: 1,
  },
  {
    id: "asset_video",
    projectId: "proj",
    type: "video",
    filename: "loop.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    durationSeconds: 6,
    width: 1920,
    height: 1080,
    hasAudio: true,
    fileId: "file_video",
    createdAt: 2,
  },
];

test("export preset matrix maps ratio and quality to codec settings", () => {
  assert.deepEqual(getComposerExportPreset({ ratio: "1:1", quality: "low" }), {
    width: 540,
    height: 540,
    resolution: "540x540",
    crf: 28,
    audioBitrateKbps: 96,
  });
  assert.deepEqual(getComposerExportPreset({ ratio: "16:9", quality: "high" }), {
    width: 1920,
    height: 1080,
    resolution: "1920x1080",
    crf: 20,
    audioBitrateKbps: 192,
  });
});

test("render plan preserves audio tails with black frames after the last video clip", () => {
  const items: ComposerTimelineItem[] = [
    {
      id: "video_1",
      assetId: "asset_video",
      lane: "video",
      timelineStartSeconds: 0,
      sourceStartSeconds: 0,
      durationSeconds: 6,
      volume: 0.5,
      muted: false,
      fitMode: "fill",
      offsetX: 0,
      offsetY: 0,
    },
    {
      id: "audio_1",
      assetId: "asset_audio",
      lane: "audio",
      timelineStartSeconds: 8,
      sourceStartSeconds: 0,
      durationSeconds: 7,
      volume: 1,
      muted: false,
    },
  ];

  const plan = buildComposerRenderPlan({
    items,
    assets: baseAssets,
    exportSettings,
    outputBasename: "demo",
  });

  assert.equal(plan.durationSeconds, 15);
  assert.equal(plan.audioSourceCount, 2);
  assert.ok(plan.filterComplex.includes("overlay=0:0"));
  assert.ok(plan.notes.some((note) => /black frames/i.test(note)));
});

test("render plan skips video audio sources when the asset has no embedded audio", () => {
  const items: ComposerTimelineItem[] = [
    {
      id: "video_1",
      assetId: "asset_video_silent",
      lane: "video",
      timelineStartSeconds: 0,
      sourceStartSeconds: 0,
      durationSeconds: 5,
      volume: 1,
      muted: false,
      fitMode: "fill",
      offsetX: 0,
      offsetY: 0,
    },
  ];
  const assets = [
    {
      ...baseAssets[1],
      id: "asset_video_silent",
      filename: "silent.mp4",
      hasAudio: false,
    },
  ];

  const plan = buildComposerRenderPlan({
    items,
    assets,
    exportSettings,
    outputBasename: "silent",
  });

  assert.equal(plan.audioSourceCount, 0);
  assert.ok(plan.notes.some((note) => /no embedded audio/i.test(note)));
});

test("render plan excludes muted clip audio from the final mix", () => {
  const items: ComposerTimelineItem[] = [
    {
      id: "audio_1",
      assetId: "asset_audio",
      lane: "audio",
      timelineStartSeconds: 0,
      sourceStartSeconds: 0,
      durationSeconds: 10,
      volume: 1,
      muted: false,
    },
    {
      id: "video_1",
      assetId: "asset_video",
      lane: "video",
      timelineStartSeconds: 0,
      sourceStartSeconds: 0,
      durationSeconds: 5,
      volume: 0.75,
      muted: true,
      fitMode: "fill",
      offsetX: 0,
      offsetY: 0,
    },
  ];

  const plan = buildComposerRenderPlan({
    items,
    assets: baseAssets,
    exportSettings,
    outputBasename: "muted",
  });

  assert.equal(plan.audioSourceCount, 1);
  assert.ok(plan.notes.some((note) => /muted in the final mix/i.test(note)));
});

