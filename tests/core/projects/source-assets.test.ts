import assert from "node:assert/strict";
import test from "node:test";

import { createEditorAssetRecord } from "../../../src/lib/editor/storage";
import {
  getActiveProjectSourceAsset,
  getSelectableProjectSourceAssets,
  isSelectableProjectSourceAsset,
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
