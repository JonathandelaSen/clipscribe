import test from "node:test";
import assert from "node:assert/strict";

import { getEditorOutputDimensions } from "../../../src/lib/editor/core/aspect-ratio";
import { buildEditorExportPlan } from "../../../src/lib/editor/core/export-plan";
import { createDefaultAudioTrack, createDefaultVideoClip, createEmptyEditorProject, createEditorAssetRecord } from "../../../src/lib/editor/storage";

test("getEditorOutputDimensions maps aspect ratios and resolution presets", () => {
  assert.deepEqual(getEditorOutputDimensions("16:9", "1080p"), { width: 1920, height: 1080 });
  assert.deepEqual(getEditorOutputDimensions("9:16", "4K"), { width: 2160, height: 3840 });
  assert.deepEqual(getEditorOutputDimensions("4:5", "720p"), { width: 720, height: 900 });
});

test("buildEditorExportPlan assembles concat + amix graph", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const videoA = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "a.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  const videoB = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "b.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 6,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  const audio = createEditorAssetRecord({
    projectId: project.id,
    kind: "audio",
    filename: "bed.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 10,
    durationSeconds: 20,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  project.assetIds = [videoA.id, videoB.id, audio.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: videoA.id, label: "A", durationSeconds: 8 }),
    createDefaultVideoClip({ assetId: videoB.id, label: "B", durationSeconds: 6 }),
  ];
  project.timeline.audioTrack = {
    ...createDefaultAudioTrack({ assetId: audio.id, durationSeconds: 20 }),
    startOffsetSeconds: 1.5,
  };

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
      { inputIndex: 2, assetId: audio.id, path: "bed.mp3", asset: audio },
    ],
    resolution: "1080p",
  });

  assert.equal(plan.width, 1920);
  assert.equal(plan.height, 1080);
  assert.equal(plan.durationSeconds, 21.5);
  assert.ok(plan.filterComplex.includes("concat=n=2:v=1:a=1"));
  assert.ok(plan.filterComplex.includes("amix=inputs=2"));
  assert.deepEqual(plan.ffmpegArgs, ["-i", "a.mp4", "-i", "b.mp4", "-i", "bed.mp3"]);
});
