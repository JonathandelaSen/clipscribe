import assert from "node:assert/strict";
import test from "node:test";

import { createEditorAssetRecord } from "../../../src/lib/editor/storage";
import {
  createEmptyContentProject,
  getActiveProjectSourceAsset,
  getSelectableProjectSourceAssets,
  getSelectableProjectVisualAssets,
  isSelectableProjectSourceAsset,
  isSelectableProjectVisualAsset,
  mergeProjectSourceAssetsWithHistory,
} from "../../../src/lib/projects/source-assets";
import type { ProjectAssetRecord } from "../../../src/lib/projects/types";

function createAsset(
  overrides: Partial<ProjectAssetRecord> & Pick<ProjectAssetRecord, "id" | "kind">
): ProjectAssetRecord {
  return createEditorAssetRecord({
    projectId: overrides.projectId ?? "project_1",
    role: overrides.role ?? "source",
    origin: overrides.origin ?? "upload",
    kind: overrides.kind,
    filename:
      overrides.filename ??
      (overrides.kind === "video"
        ? `${overrides.id}.mp4`
        : overrides.kind === "audio"
          ? `${overrides.id}.m4a`
          : `${overrides.id}.png`),
    mimeType:
      overrides.mimeType ??
      (overrides.kind === "video"
        ? "video/mp4"
        : overrides.kind === "audio"
          ? "audio/mp4"
          : "image/png"),
    sizeBytes: overrides.sizeBytes ?? 128,
    durationSeconds: overrides.durationSeconds ?? 12,
    hasAudio: overrides.hasAudio ?? (overrides.kind !== "image"),
    sourceType: overrides.sourceType ?? "upload",
    captionSource: overrides.captionSource ?? { kind: "none" },
    fileBlob: overrides.fileBlob,
    id: overrides.id,
    now: overrides.createdAt ?? 100,
  }) as ProjectAssetRecord;
}

test("empty content projects can be created without assets", () => {
  const project = createEmptyContentProject({
    name: "Sin assets",
    now: 123,
  });

  assert.equal(project.name, "Sin assets");
  assert.equal(project.createdAt, 123);
  assert.deepEqual(project.assetIds, []);
  assert.equal(project.activeSourceAssetId, undefined);
  assert.deepEqual(project.timeline.videoClips, []);
  assert.deepEqual(project.timeline.audioItems, []);
  assert.deepEqual(project.timeline.imageItems, []);
});

test("derived videos remain selectable as active project sources", () => {
  const uploadedAudio = createAsset({
    id: "asset_audio",
    kind: "audio",
    role: "source",
  });
  const derivedVideo = createAsset({
    id: "asset_video",
    kind: "video",
    role: "derived",
    origin: "timeline-export",
  });

  const activeAsset = getActiveProjectSourceAsset(
    [uploadedAudio, derivedVideo],
    derivedVideo.id
  );

  assert.equal(activeAsset?.id, derivedVideo.id);
});

test("selectable project sources include audio and video but exclude images", () => {
  const assets = [
    createAsset({ id: "asset_audio", kind: "audio" }),
    createAsset({ id: "asset_video", kind: "video", role: "derived" }),
    createAsset({ id: "asset_image", kind: "image", role: "support" }),
  ];

  assert.equal(isSelectableProjectSourceAsset(assets[0]!), true);
  assert.equal(isSelectableProjectSourceAsset(assets[1]!), true);
  assert.equal(isSelectableProjectSourceAsset(assets[2]!), false);
  assert.deepEqual(
    getSelectableProjectSourceAssets(assets).map((asset) => asset.id),
    ["asset_audio", "asset_video"]
  );
});

test("source history options include exported videos that do not have transcripts yet", () => {
  const transcriptBackedAudio = createAsset({
    id: "asset_audio",
    kind: "audio",
    createdAt: 200,
  });
  const exportedVideo = createAsset({
    id: "asset_export",
    kind: "video",
    role: "derived",
    origin: "timeline-export",
    createdAt: 300,
  });
  const supportImage = createAsset({
    id: "asset_image",
    kind: "image",
    role: "support",
    createdAt: 400,
  });

  const merged = mergeProjectSourceAssetsWithHistory(
    [
      {
        id: transcriptBackedAudio.id,
        mediaId: transcriptBackedAudio.id,
        filename: transcriptBackedAudio.filename,
        createdAt: transcriptBackedAudio.createdAt,
        updatedAt: transcriptBackedAudio.updatedAt,
        timestamp: transcriptBackedAudio.updatedAt,
        transcripts: [
          {
            id: "tx_1",
            versionNumber: 1,
            label: "Transcript",
            status: "completed",
            createdAt: 200,
            updatedAt: 200,
            requestedLanguage: "es",
            transcript: "Hola",
            subtitles: [],
          },
        ],
        projectId: transcriptBackedAudio.projectId,
      },
    ],
    [transcriptBackedAudio, exportedVideo, supportImage]
  );

  assert.deepEqual(
    merged.map((item) => [item.id, item.transcripts.length]),
    [
      ["asset_export", 0],
      ["asset_audio", 1],
    ]
  );
});

test("selectable project visuals include videos and images but exclude audio", () => {
  const assets = [
    createAsset({ id: "asset_audio", kind: "audio" }),
    createAsset({ id: "asset_video", kind: "video", role: "derived" }),
    createAsset({ id: "asset_image", kind: "image", role: "support" }),
  ];

  assert.equal(isSelectableProjectVisualAsset(assets[0]!), false);
  assert.equal(isSelectableProjectVisualAsset(assets[1]!), true);
  assert.equal(isSelectableProjectVisualAsset(assets[2]!), true);
  assert.deepEqual(
    getSelectableProjectVisualAssets(assets).map((asset) => asset.id),
    ["asset_video", "asset_image"]
  );
});
