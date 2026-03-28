import test from "node:test";
import assert from "node:assert/strict";

import type { ProjectAssetRecord, ProjectExportRecord } from "../../../src/lib/projects/types";
import {
  DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS,
  appendChapterBlockToDescription,
  applySuggestedDescription,
  applySuggestedTags,
  applySuggestedTitle,
  buildProjectYouTubeUploadRecord,
  getEligibleYouTubeProjectAssets,
  getEligibleYouTubeProjectExports,
  resolveInitialYouTubePublishSelection,
  resolveYouTubePublishView,
} from "../../../src/lib/creator/youtube-publish";
import type { YouTubePublishResult, YouTubeUploadDraft } from "../../../src/lib/youtube/types";

function createAsset(overrides: Partial<ProjectAssetRecord> = {}): ProjectAssetRecord {
  return {
    id: overrides.id ?? "asset_1",
    projectId: overrides.projectId ?? "project_1",
    role: overrides.role ?? "derived",
    origin: overrides.origin ?? "short-export",
    sourceType: overrides.sourceType ?? "upload",
    kind: overrides.kind ?? "video",
    filename: overrides.filename ?? "clip.mp4",
    mimeType: overrides.mimeType ?? "video/mp4",
    sizeBytes: overrides.sizeBytes ?? 1024,
    durationSeconds: overrides.durationSeconds ?? 15,
    captionSource: overrides.captionSource ?? { kind: "none" },
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
    fileBlob: Object.prototype.hasOwnProperty.call(overrides, "fileBlob")
      ? overrides.fileBlob
      : new File(["video"], "clip.mp4", { type: "video/mp4" }),
  };
}

function createExport(overrides: Partial<ProjectExportRecord> = {}): ProjectExportRecord {
  return {
    id: overrides.id ?? "export_1",
    projectId: overrides.projectId ?? "project_1",
    kind: overrides.kind ?? "short",
    createdAt: overrides.createdAt ?? 2_000,
    status: overrides.status ?? "completed",
    filename: overrides.filename ?? "export.mp4",
    mimeType: overrides.mimeType ?? "video/mp4",
    sizeBytes: overrides.sizeBytes ?? 2048,
    outputAssetId: overrides.outputAssetId ?? "asset_1",
  };
}

test("DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS keeps the upload-focused defaults", () => {
  assert.deepEqual(DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS, [
    "titleIdeas",
    "description",
    "hashtags",
    "thumbnailHooks",
    "chapters",
    "pinnedComment",
  ]);
});

test("apply suggestion helpers only update the targeted draft fields", () => {
  const draft = {
    title: "Original title",
    description: "Original description",
    tagsInput: "already, here",
  };

  const withTitle = applySuggestedTitle(draft, "  New title  ");
  assert.equal(withTitle.title, "New title");
  assert.equal(withTitle.description, draft.description);
  assert.equal(withTitle.tagsInput, draft.tagsInput);

  const withDescription = applySuggestedDescription(draft, "  Better description  ");
  assert.equal(withDescription.title, draft.title);
  assert.equal(withDescription.description, "Better description");
  assert.equal(withDescription.tagsInput, draft.tagsInput);
});

test("applySuggestedTags normalizes and deduplicates hashtags into the tags input", () => {
  const result = applySuggestedTags(
    {
      title: "",
      description: "",
      tagsInput: "",
    },
    {
      youtube: {
        titleIdeas: [],
        description: "",
        pinnedComment: "",
        hashtags: ["#workflow", "#Workflow", "#clipscribe"],
        thumbnailHooks: [],
        chapterText: "",
      },
    }
  );

  assert.equal(result.tagsInput, "workflow, clipscribe");
});

test("appendChapterBlockToDescription appends chapters once and preserves existing copy", () => {
  const initial = {
    title: "",
    description: "Intro copy",
    tagsInput: "",
  };

  const next = appendChapterBlockToDescription(initial, "0:00 Intro\n0:20 Demo");
  assert.equal(next.description, "Intro copy\n\n0:00 Intro\n0:20 Demo");

  const deduped = appendChapterBlockToDescription(next, "0:00 Intro\n0:20 Demo");
  assert.equal(deduped.description, next.description);
});

test("getEligibleYouTubeProjectExports only returns completed video exports backed by blobs", () => {
  const asset = createAsset();
  const assetsById = new Map<string, ProjectAssetRecord>([[asset.id, asset]]);
  const eligible = createExport({ id: "export_ok", outputAssetId: asset.id, createdAt: 3_000 });
  const failed = createExport({ id: "export_failed", status: "failed", createdAt: 4_000 });
  const missingBlobAsset = createAsset({ id: "asset_missing", fileBlob: undefined });
  const imageAsset = createAsset({ id: "asset_image", kind: "image", fileBlob: new File(["x"], "cover.png", { type: "image/png" }) });

  assetsById.set(missingBlobAsset.id, missingBlobAsset);
  assetsById.set(imageAsset.id, imageAsset);

  const results = getEligibleYouTubeProjectExports(
    [
      eligible,
      failed,
      createExport({ id: "export_no_blob", outputAssetId: missingBlobAsset.id, createdAt: 2_000 }),
      createExport({ id: "export_image", outputAssetId: imageAsset.id, createdAt: 1_000 }),
    ],
    assetsById
  );

  assert.deepEqual(results.map((item) => item.exportId), ["export_ok"]);
});

test("getEligibleYouTubeProjectAssets only returns project videos backed by blobs", () => {
  const videoAsset = createAsset({ id: "asset_video", createdAt: 3_000 });
  const mimeOnlyVideoAsset = createAsset({
    id: "asset_mime_video",
    kind: "audio",
    mimeType: "video/quicktime",
    filename: "clip.mov",
    createdAt: 2_000,
  });
  const missingBlobAsset = createAsset({ id: "asset_missing_blob", createdAt: 4_000, fileBlob: undefined });
  const imageAsset = createAsset({
    id: "asset_image",
    kind: "image",
    mimeType: "image/png",
    filename: "cover.png",
    fileBlob: new File(["image"], "cover.png", { type: "image/png" }),
    createdAt: 1_000,
  });

  const results = getEligibleYouTubeProjectAssets([
    videoAsset,
    mimeOnlyVideoAsset,
    missingBlobAsset,
    imageAsset,
  ]);

  assert.deepEqual(results.map((item) => item.assetId), ["asset_video", "asset_mime_video"]);
});

test("resolveInitialYouTubePublishSelection honors valid deep links and falls back safely", () => {
  const assetOptionsByProjectId = new Map([
    [
      "project_1",
      [
        {
          assetId: "asset_1",
          projectId: "project_1",
          filename: "source.mov",
          createdAt: 2_000,
          file: new File(["video"], "source.mov", { type: "video/quicktime" }),
        },
      ],
    ],
  ]);
  const exportOptionsByProjectId = new Map([
    [
      "project_1",
      [
        {
          exportId: "export_1",
          projectId: "project_1",
          outputAssetId: "asset_1",
          filename: "clip.mp4",
          createdAt: 1_000,
          kind: "short" as const,
          file: new File(["video"], "clip.mp4", { type: "video/mp4" }),
        },
      ],
    ],
  ]);

  assert.deepEqual(
    resolveInitialYouTubePublishSelection({
      projectId: "project_1",
      assetId: "asset_1",
      exportId: "export_1",
      availableProjectIds: ["project_1", "project_2"],
      assetOptionsByProjectId,
      exportOptionsByProjectId,
    }),
    {
      projectId: "project_1",
      assetId: "asset_1",
      exportId: "",
      sourceMode: "project_asset",
    }
  );

  assert.deepEqual(
    resolveInitialYouTubePublishSelection({
      projectId: "missing",
      assetId: "asset_1",
      exportId: "export_1",
      availableProjectIds: ["project_1", "project_2"],
      assetOptionsByProjectId,
      exportOptionsByProjectId,
    }),
    {
      projectId: "",
      assetId: "",
      exportId: "",
      sourceMode: "local_file",
    }
  );

  assert.deepEqual(
    resolveInitialYouTubePublishSelection({
      projectId: "project_1",
      assetId: "missing_asset",
      exportId: "export_1",
      availableProjectIds: ["project_1", "project_2"],
      assetOptionsByProjectId,
      exportOptionsByProjectId,
    }),
    {
      projectId: "project_1",
      assetId: "",
      exportId: "export_1",
      sourceMode: "project_export",
    }
  );
});

test("resolveYouTubePublishView defaults to list and forces the new flow for deep links", () => {
  assert.equal(resolveYouTubePublishView({ requestedView: null }), "list");
  assert.equal(resolveYouTubePublishView({ requestedView: "new" }), "new");
  assert.equal(resolveYouTubePublishView({ requestedView: "list", assetId: "asset_1" }), "new");
  assert.equal(resolveYouTubePublishView({ requestedView: "list", exportId: "export_1" }), "new");
});

test("buildProjectYouTubeUploadRecord preserves the upload snapshot needed for project history", () => {
  const draft: YouTubeUploadDraft = {
    title: "Launch video",
    description: "Long-form publish",
    privacyStatus: "unlisted",
    tags: ["clipscribe", "launch"],
    categoryId: "28",
    defaultLanguage: "en",
    publishAt: "2026-04-01T12:00",
    recordingDate: "2026-03-27",
    localizations: [
      {
        locale: "es",
        title: "Video lanzamiento",
        description: "Descripcion",
      },
    ],
  };
  const result: YouTubePublishResult = {
    ok: true,
    videoId: "yt_123",
    watchUrl: "https://youtube.com/watch?v=yt_123",
    studioUrl: "https://studio.youtube.com/video/yt_123/edit",
    processing: {
      videoId: "yt_123",
      processingStatus: "processing",
      uploadStatus: "uploaded",
      privacyStatus: "unlisted",
    },
    thumbnail: { state: "applied" },
    caption: { state: "skipped" },
  };

  const record = buildProjectYouTubeUploadRecord({
    projectId: "project_1",
    sourceMode: "project_export",
    sourceAssetId: "asset_1",
    sourceExportId: "export_1",
    outputAssetId: "asset_derived_1",
    sourceFilename: "launch-cut.mp4",
    draft,
    result,
    uploadedAt: 123_456,
  });

  assert.equal(record.projectId, "project_1");
  assert.equal(record.uploadedAt, 123_456);
  assert.equal(record.videoId, "yt_123");
  assert.equal(record.sourceMode, "project_export");
  assert.equal(record.sourceAssetId, "asset_1");
  assert.equal(record.sourceExportId, "export_1");
  assert.equal(record.outputAssetId, "asset_derived_1");
  assert.deepEqual(record.draft.tags, ["clipscribe", "launch"]);
  assert.equal(record.draft.localizations[0]?.locale, "es");
  assert.equal(record.result.processingStatus, "processing");
  assert.equal(record.result.thumbnailState, "applied");
  assert.equal(record.result.captionState, "skipped");
});
