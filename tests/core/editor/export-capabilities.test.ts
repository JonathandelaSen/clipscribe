import assert from "node:assert/strict";
import test from "node:test";

import { getEditorExportCapability } from "../../../src/lib/editor/export-capabilities";
import {
  createDefaultImageTrackItem,
  createDefaultVideoClip,
  createEditorAssetRecord,
  createEmptyEditorProject,
} from "../../../src/lib/editor/storage";

function createBaseProject() {
  const project = createEmptyEditorProject({
    id: "cap_project",
    now: 100,
    name: "Capability Test",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_main",
    now: 100,
  });

  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({
      assetId: asset.id,
      label: "Clip",
      durationSeconds: 8,
    }),
  ];

  return { project, asset };
}

test("system export capability passes for a supported upload-only timeline", () => {
  const { project, asset } = createBaseProject();

  const capability = getEditorExportCapability({
    engine: "system",
    project,
    assets: [{ asset }],
  });

  assert.equal(capability.supported, true);
  assert.deepEqual(capability.reasons, []);
});

test("system export capability allows global subtitle burn-in on used assets", () => {
  const { project, asset } = createBaseProject();
  project.subtitles = {
    ...project.subtitles,
    source: {
      kind: "uploaded-srt",
    },
    label: "captions.srt",
    chunks: [{ text: "Hello", timestamp: [0, 1] }],
    trimEndSeconds: 1,
  };

  const capability = getEditorExportCapability({
    engine: "system",
    project,
    assets: [{ asset }],
  });

  assert.equal(capability.supported, true);
  assert.deepEqual(capability.reasons, []);
});

test("system export capability blocks non-upload assets on the timeline", () => {
  const { project, asset } = createBaseProject();
  asset.sourceType = "history";

  const capability = getEditorExportCapability({
    engine: "system",
    project,
    assets: [{ asset }],
  });

  assert.equal(capability.supported, false);
  assert.match(capability.reasons.join("\n"), /upload assets only/);
});

test("system export capability blocks empty timelines", () => {
  const { project, asset } = createBaseProject();
  project.timeline.videoClips = [];

  const capability = getEditorExportCapability({
    engine: "system",
    project,
    assets: [{ asset }],
  });

  assert.equal(capability.supported, false);
  assert.match(capability.reasons.join("\n"), /Add at least one video clip or image track item/);
});

test("system export capability accepts image-only timelines when the image asset is upload-backed", () => {
  const project = createEmptyEditorProject({
    id: "cap_image_project",
    now: 100,
    name: "Image Capability Test",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "image",
    filename: "cover.png",
    mimeType: "image/png",
    sizeBytes: 100,
    durationSeconds: 0,
    width: 1920,
    height: 1080,
    hasAudio: false,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_image_main",
    now: 100,
  });

  project.assetIds = [asset.id];
  project.timeline.imageItems = [
    createDefaultImageTrackItem({
      assetId: asset.id,
      label: "Cover",
    }),
  ];

  const capability = getEditorExportCapability({
    engine: "system",
    project,
    assets: [{ asset }],
  });

  assert.equal(capability.supported, true);
  assert.deepEqual(capability.reasons, []);
});

test("system export capability ignores incompatible assets that are not used by the export", () => {
  const { project, asset } = createBaseProject();
  const unusedAsset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "unused.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    durationSeconds: 5,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "history",
    captionSource: { kind: "embedded-srt", label: "unused.srt", chunks: [] },
    id: "asset_unused",
    now: 100,
  });

  const capability = getEditorExportCapability({
    engine: "system",
    project,
    assets: [{ asset }, { asset: unusedAsset }],
  });

  assert.equal(capability.supported, true);
  assert.deepEqual(capability.reasons, []);
});
