import test from "node:test";
import assert from "node:assert/strict";

import {
  materializeEditorProjectBundle,
  normalizeEditorProjectBundleManifest,
} from "../../../src/lib/editor/bundle";
import { getEditorOutputDimensions } from "../../../src/lib/editor/core/aspect-ratio";
import {
  buildEditorAudioExportPlan,
  buildEditorExportPlan,
} from "../../../src/lib/editor/core/export-plan";
import {
  createDefaultAudioTrack,
  createDefaultImageTrackItem,
  createDefaultVideoClip,
  createEmptyEditorProject,
  createEditorAssetRecord,
} from "../../../src/lib/editor/storage";

test("getEditorOutputDimensions maps aspect ratios and resolution presets", () => {
  assert.deepEqual(getEditorOutputDimensions("16:9", "1080p"), { width: 1920, height: 1080 });
  assert.deepEqual(getEditorOutputDimensions("9:16", "4K"), { width: 2160, height: 3840 });
  assert.deepEqual(getEditorOutputDimensions("4:5", "720p"), { width: 720, height: 900 });
});

test("buildEditorExportPlan assembles concat + multi-item audio mix graph", () => {
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
  const audioA = createEditorAssetRecord({
    projectId: project.id,
    kind: "audio",
    filename: "bed-a.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 10,
    durationSeconds: 20,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  const audioB = createEditorAssetRecord({
    projectId: project.id,
    kind: "audio",
    filename: "bed-b.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 10,
    durationSeconds: 8,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  project.assetIds = [videoA.id, videoB.id, audioA.id, audioB.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: videoA.id, label: "A", durationSeconds: 8 }),
    createDefaultVideoClip({ assetId: videoB.id, label: "B", durationSeconds: 6 }),
  ];
  project.timeline.audioItems = [
    {
      ...createDefaultAudioTrack({ assetId: audioA.id, durationSeconds: 20 }),
      startOffsetSeconds: 1.5,
      trimEndSeconds: 12,
    },
    {
      ...createDefaultAudioTrack({ assetId: audioB.id, durationSeconds: 8 }),
      startOffsetSeconds: 14.5,
      trimEndSeconds: 6,
      muted: true,
    },
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
      { inputIndex: 2, assetId: audioA.id, path: "bed-a.mp3", asset: audioA },
      { inputIndex: 3, assetId: audioB.id, path: "bed-b.mp3", asset: audioB },
    ],
    resolution: "1080p",
  });

  assert.equal(plan.width, 1920);
  assert.equal(plan.height, 1080);
  assert.equal(plan.durationSeconds, 20.5);
  assert.ok(
    plan.filterComplex.includes("[vseg0][aseg0][vseg1][aseg1]concat=n=2:v=1:a=1[video_track][clip_audio_track]")
  );
  assert.ok(plan.filterComplex.includes("music_track_0"));
  assert.ok(plan.filterComplex.includes("music_track_1"));
  assert.ok(plan.filterComplex.includes("volume=0"));
  assert.ok(plan.filterComplex.includes("amix=inputs=2"));
  assert.deepEqual(plan.ffmpegArgs, ["-i", "a.mp4", "-i", "b.mp4", "-i", "bed-a.mp3", "-i", "bed-b.mp3"]);
});

test("buildEditorExportPlan applies reverse filters to reversed clips before concat", () => {
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
  const reversedClip = createDefaultVideoClip({ assetId: videoA.id, label: "A", durationSeconds: 8 });
  reversedClip.actions.reverse = true;

  project.assetIds = [videoA.id, videoB.id];
  project.timeline.videoClips = [
    reversedClip,
    createDefaultVideoClip({ assetId: videoB.id, label: "B", durationSeconds: 6 }),
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
    ],
    resolution: "1080p",
  });

  assert.match(plan.filterComplex, /\[0:v\]trim=start=0:end=8,setpts=PTS-STARTPTS,reverse,/);
  assert.match(plan.filterComplex, /\[0:a\]atrim=start=0:end=8,asetpts=PTS-STARTPTS,areverse,volume=1\.000\[aseg0\]/);
  assert.ok(
    plan.filterComplex.includes("[vseg0][aseg0][vseg1][aseg1]concat=n=2:v=1:a=1[video_track][clip_audio_track]")
  );
});

test("buildEditorExportPlan preserves reverse filters for imported bundle clips", async () => {
  const manifest = normalizeEditorProjectBundleManifest({
    schemaVersion: 1,
    createdAt: 100,
    name: "Imported Reverse",
    aspectRatio: "16:9",
    videoClips: [
      { path: "media/a.mp4", reverse: true },
      { path: "media/b.mp4" },
    ],
  });

  const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
  const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });
  const { project, assets } = await materializeEditorProjectBundle({
    manifest,
    filesByPath: new Map([
      ["media/a.mp4", fileA],
      ["media/b.mp4", fileB],
    ]),
    readMetadata: async (file) => ({
      kind: "video",
      durationSeconds: file.name === "a.mp4" ? 8 : 6,
      width: 1920,
      height: 1080,
      hasAudio: true,
    }),
  });

  const [videoA, videoB] = assets;
  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
    ],
    resolution: "1080p",
  });

  assert.match(plan.filterComplex, /\[0:v\]trim=start=0:end=8,setpts=PTS-STARTPTS,reverse,/);
  assert.match(plan.filterComplex, /\[0:a\]atrim=start=0:end=8,asetpts=PTS-STARTPTS,areverse,volume=1\.000\[aseg0\]/);
});

test("buildEditorExportPlan reuses one input when imported clips share the same asset", async () => {
  const manifest = normalizeEditorProjectBundleManifest({
    schemaVersion: 1,
    createdAt: 101,
    name: "Imported Repeat",
    aspectRatio: "16:9",
    videoClips: [
      { path: "media/shared.mp4", reverse: true },
      { path: "media/shared.mp4", trimStartSeconds: 1, trimEndSeconds: 4 },
    ],
  });

  const sharedFile = new File(["shared"], "shared.mp4", { type: "video/mp4" });
  const { project, assets } = await materializeEditorProjectBundle({
    manifest,
    filesByPath: new Map([["media/shared.mp4", sharedFile]]),
    readMetadata: async () => ({
      kind: "video",
      durationSeconds: 8,
      width: 1920,
      height: 1080,
      hasAudio: true,
    }),
  });

  assert.equal(assets.length, 1);
  const [sharedAsset] = assets;
  const plan = buildEditorExportPlan({
    project,
    inputs: [{ inputIndex: 0, assetId: sharedAsset!.id, path: "shared.mp4", asset: sharedAsset! }],
    resolution: "1080p",
  });

  assert.deepEqual(plan.ffmpegArgs, ["-i", "shared.mp4"]);
  assert.match(plan.filterComplex, /\[0:v\]trim=start=0:end=8,setpts=PTS-STARTPTS,reverse,/);
  assert.match(plan.filterComplex, /\[0:a\]atrim=start=0:end=8,asetpts=PTS-STARTPTS,areverse,volume=1\.000\[aseg0\]/);
  assert.ok(
    plan.filterComplex.includes("[vseg0][aseg0][vseg1][aseg1]concat=n=2:v=1:a=1[video_track][clip_audio_track]")
  );
});

test("buildEditorExportPlan ignores joined groups and still exports the flat clip sequence", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const videoA = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "a.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 5,
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
    durationSeconds: 4,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  const first = createDefaultVideoClip({ assetId: videoA.id, label: "A", durationSeconds: 5 });
  const second = createDefaultVideoClip({ assetId: videoB.id, label: "B", durationSeconds: 4 });
  project.assetIds = [videoA.id, videoB.id];
  project.timeline.videoClips = [first, second];
  project.timeline.videoClipGroups = [
    {
      id: "group_1",
      kind: "joined",
      clipIds: [first.id, second.id],
      label: "A + B",
    },
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
    ],
    resolution: "1080p",
  });

  assert.ok(plan.filterComplex.includes("[vseg0][aseg0][vseg1][aseg1]concat=n=2:v=1:a=1[video_track][clip_audio_track]"));
  assert.equal(plan.durationSeconds, 9);
});

test("buildEditorExportPlan warns when an audio item source is missing", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const video = createEditorAssetRecord({
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
  const missingAudio = createEditorAssetRecord({
    projectId: project.id,
    kind: "audio",
    filename: "missing.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 10,
    durationSeconds: 8,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  project.assetIds = [video.id, missingAudio.id];
  project.timeline.videoClips = [createDefaultVideoClip({ assetId: video.id, label: "A", durationSeconds: 8 })];
  project.timeline.audioItems = [
    {
      ...createDefaultAudioTrack({ assetId: missingAudio.id, durationSeconds: 8 }),
      startOffsetSeconds: 2,
    },
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [{ inputIndex: 0, assetId: video.id, path: "a.mp4", asset: video }],
    resolution: "1080p",
  });

  assert.deepEqual(plan.warnings, ["Audio track item 1 is missing its source file."]);
});

test("buildEditorExportPlan keeps concat inputs interleaved when a clip uses fallback audio", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const videoA = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "a.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 5,
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
    durationSeconds: 4,
    width: 1920,
    height: 1080,
    hasAudio: false,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  const videoC = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "c.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 6,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  project.assetIds = [videoA.id, videoB.id, videoC.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: videoA.id, label: "A", durationSeconds: 5 }),
    createDefaultVideoClip({ assetId: videoB.id, label: "B", durationSeconds: 4 }),
    createDefaultVideoClip({ assetId: videoC.id, label: "C", durationSeconds: 6 }),
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
      { inputIndex: 2, assetId: videoC.id, path: "c.mp4", asset: videoC },
    ],
    resolution: "1080p",
  });

  assert.match(
    plan.filterComplex,
    /\[vseg0\]\[aseg0\]\[vseg1\]\[aseg1\]\[vseg2\]\[aseg2\]concat=n=3:v=1:a=1\[video_track\]\[clip_audio_track\]/
  );
  assert.ok(plan.filterComplex.includes("anullsrc=r=48000:cl=stereo,atrim=duration=4.000[aseg1]"));
});

test("buildEditorExportPlan can build a video-only concat graph for segmented browser renders", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const videoA = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "a.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 5,
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
    durationSeconds: 4,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  project.assetIds = [videoA.id, videoB.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: videoA.id, label: "A", durationSeconds: 5 }),
    createDefaultVideoClip({ assetId: videoB.id, label: "B", durationSeconds: 4 }),
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: videoA.id, path: "a.mp4", asset: videoA },
      { inputIndex: 1, assetId: videoB.id, path: "b.mp4", asset: videoB },
    ],
    resolution: "1080p",
    includeAudio: false,
  });

  assert.equal(plan.mixedAudioLabel, null);
  assert.ok(plan.filterComplex.includes("[vseg0][vseg1]concat=n=2:v=1:a=0[video_track]"));
  assert.doesNotMatch(plan.filterComplex, /\[aseg0\]/);
});

test("buildEditorAudioExportPlan builds one audio-only mix for clip audio plus timeline audio", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const video = createEditorAssetRecord({
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
  project.assetIds = [video.id, audio.id];
  project.timeline.videoClips = [createDefaultVideoClip({ assetId: video.id, label: "A", durationSeconds: 8 })];
  project.timeline.audioItems = [
    {
      ...createDefaultAudioTrack({ assetId: audio.id, durationSeconds: 20 }),
      startOffsetSeconds: 1.5,
      trimEndSeconds: 12,
    },
  ];

  const plan = buildEditorAudioExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: video.id, path: "a.mp4", asset: video },
      { inputIndex: 1, assetId: audio.id, path: "bed.mp3", asset: audio },
    ],
  });

  assert.equal(plan.durationSeconds, 13.5);
  assert.equal(plan.mixedAudioLabel, "mixed_audio_0");
  assert.ok(plan.filterComplex.includes("concat=n=1:v=0:a=1[clip_audio_track]"));
  assert.ok(plan.filterComplex.includes("adelay=1500|1500"));
  assert.ok(plan.filterComplex.includes("amix=inputs=2:duration=longest:dropout_transition=0[mixed_audio_0]"));
});

test("buildEditorExportPlan overlays a full-length image track on top of the base video track", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const video = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });
  const image = createEditorAssetRecord({
    projectId: project.id,
    kind: "image",
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 10,
    durationSeconds: 0,
    width: 1920,
    height: 1080,
    hasAudio: false,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });

  project.assetIds = [video.id, image.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: video.id, label: "Clip", durationSeconds: 8 }),
  ];
  project.timeline.imageItems = [
    createDefaultImageTrackItem({ assetId: image.id, label: "Cover" }),
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: video.id, path: "clip.mp4", asset: video },
      { inputIndex: 1, assetId: image.id, path: "cover.png", asset: image },
    ],
    resolution: "1080p",
  });

  assert.equal(plan.videoTrackLabel, "video_track");
  assert.ok(plan.ffmpegArgs.includes("-loop"));
  assert.ok(plan.filterComplex.includes("[video_track_base][img0]overlay=shortest=1:eof_action=pass[video_track]"));
});

test("buildEditorExportPlan keeps mismatched image ratios truthful until the frame is fit", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const image = createEditorAssetRecord({
    projectId: project.id,
    kind: "image",
    filename: "square.png",
    mimeType: "image/png",
    sizeBytes: 10,
    durationSeconds: 0,
    width: 1200,
    height: 1200,
    hasAudio: false,
    sourceType: "upload",
    captionSource: { kind: "none" },
  });

  const defaultItem = createDefaultImageTrackItem({ assetId: image.id, label: "Square" });
  project.assetIds = [image.id];
  project.timeline.imageItems = [defaultItem];

  const defaultPlan = buildEditorExportPlan({
    project,
    inputs: [{ inputIndex: 0, assetId: image.id, path: "square.png", asset: image }],
    resolution: "1080p",
  });

  assert.match(
    defaultPlan.filterComplex,
    /\[0:v\]scale=1080:1080,pad=1920:1080:420:0:black,crop=1920:1080:0:0,format=yuv420p\[img0\]/
  );

  project.timeline.imageItems = [
    {
      ...defaultItem,
      canvas: {
        ...defaultItem.canvas,
        zoom: 1.7778,
      },
    },
  ];

  const fitPlan = buildEditorExportPlan({
    project,
    inputs: [{ inputIndex: 0, assetId: image.id, path: "square.png", asset: image }],
    resolution: "1080p",
  });

  assert.match(
    fitPlan.filterComplex,
    /\[0:v\]scale=1920:1920,crop=1920:1080:0:420,format=yuv420p\[img0\]/
  );
});

test("buildEditorExportPlan can render an image-only project and mix timeline audio over it", () => {
  const project = createEmptyEditorProject({ aspectRatio: "16:9" });
  const image = createEditorAssetRecord({
    projectId: project.id,
    kind: "image",
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 10,
    durationSeconds: 0,
    width: 1920,
    height: 1080,
    hasAudio: false,
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

  project.assetIds = [image.id, audio.id];
  project.timeline.imageItems = [
    createDefaultImageTrackItem({ assetId: image.id, label: "Cover" }),
  ];
  project.timeline.audioItems = [
    {
      ...createDefaultAudioTrack({ assetId: audio.id, durationSeconds: 20 }),
      startOffsetSeconds: 2,
      trimEndSeconds: 12,
    },
  ];

  const plan = buildEditorExportPlan({
    project,
    inputs: [
      { inputIndex: 0, assetId: image.id, path: "cover.png", asset: image },
      { inputIndex: 1, assetId: audio.id, path: "bed.mp3", asset: audio },
    ],
    resolution: "1080p",
  });

  assert.equal(plan.durationSeconds, 14);
  assert.equal(plan.mixedAudioLabel, "mixed_audio_0");
  assert.ok(plan.filterComplex.includes("color=c=black:s=1920x1080:d=14.000[video_track_base]"));
  assert.ok(plan.filterComplex.includes("anullsrc=r=48000:cl=stereo,atrim=duration=14.000[clip_audio_track]"));
});
