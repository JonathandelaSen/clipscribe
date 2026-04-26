import test from "node:test";
import assert from "node:assert/strict";

import type { ProjectAssetRecord, ProjectExportRecord } from "../../../src/lib/projects/types";
import {
  buildShortSuggestionPublishDraft,
  buildYouTubeShortPublishPromptProfile,
  DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS,
  appendChapterBlockToDescription,
  applySuggestedDescription,
  applySuggestedTags,
  applySuggestedTitle,
  buildVideoInfoPublishDraft,
  buildProjectYouTubeUploadRecord,
  getEligibleYouTubeProjectAssets,
  getEligibleYouTubeProjectExports,
  inferYouTubePublishIntent,
  resolveMatchingVideoInfoRecord,
  resolveYouTubeShortEligibility,
  resolveInitialYouTubePublishSelection,
  resolveYouTubeShortExportForProjectAsset,
  resolveYouTubeShortPublishTranscriptContext,
  resolveYouTubePublishView,
  YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS,
  YOUTUBE_SHORTS_MAX_DURATION_SECONDS,
} from "../../../src/lib/creator/youtube-publish";
import type { YouTubePublishResult, YouTubeUploadDraft } from "../../../src/lib/youtube/types";
import type { CreatorVideoInfoProjectRecord } from "../../../src/lib/creator/types";
import type { CreatorShortProjectRecord } from "../../../src/lib/creator/storage";
import type { TranscriptVersion } from "../../../src/lib/history";

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
    width: overrides.width ?? 1080,
    height: overrides.height ?? 1920,
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
    shortProjectId: overrides.shortProjectId,
    shortProjectName: overrides.shortProjectName,
    createdAt: overrides.createdAt ?? 2_000,
    status: overrides.status ?? "completed",
    sourceAssetId: overrides.sourceAssetId ?? "asset_1",
    filename: overrides.filename ?? "export.mp4",
    mimeType: overrides.mimeType ?? "video/mp4",
    sizeBytes: overrides.sizeBytes ?? 2048,
    outputAssetId: overrides.outputAssetId ?? "asset_1",
    clip: overrides.clip,
    plan: overrides.plan,
    short: overrides.short,
    editor: overrides.editor,
  };
}

function createVideoInfoRecord(overrides: Partial<CreatorVideoInfoProjectRecord> = {}): CreatorVideoInfoProjectRecord {
  return {
    id: overrides.id ?? "vi_1",
    generatedAt: overrides.generatedAt ?? 1_000,
    sourceAssetId: overrides.sourceAssetId ?? "asset_1",
    sourceSignature: overrides.sourceSignature,
    inputSummary: overrides.inputSummary ?? {
      videoInfoBlocks: ["titleIdeas", "description", "hashtags"],
    },
    analysis: overrides.analysis ?? {
      ok: true,
      providerMode: "openai",
      model: "gpt-test",
      generatedAt: 1_000,
      runtimeSeconds: 2,
      youtube: {
        titleIdeas: ["Launch this clip"],
        description: "Description from AI",
        pinnedComment: "",
        hashtags: ["#clipscribe", "#launch"],
        thumbnailHooks: [],
        chapterText: "",
      },
      content: {
        videoSummary: "",
        keyMoments: [],
        hookIdeas: [],
        ctaIdeas: [],
        repurposeIdeas: [],
      },
      chapters: [],
      insights: {
        transcriptWordCount: 10,
        estimatedSpeakingRateWpm: 120,
        repeatedTerms: [],
        detectedTheme: "Testing",
      },
    },
  };
}

function createShortProject(overrides: Partial<CreatorShortProjectRecord> = {}): CreatorShortProjectRecord {
  const short = overrides.short ?? {
    id: "short_1",
    startSeconds: 0,
    endSeconds: 25,
    durationSeconds: 25,
    score: 0.88,
    title: "Linked short title",
    reason: "Reason",
    caption: "Linked short caption #shorts",
    openingText: "Opening",
    endCardText: "Outro",
    sourceChunkIndexes: [0],
    suggestedSubtitleLanguage: "en",
    editorPreset: {
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleStyle: "clean_caption",
      safeTopPct: 10,
      safeBottomPct: 14,
      targetDurationRange: [20, 45],
    },
  };
  const plan = overrides.plan ?? {
    id: short.id,
    clipId: short.id,
    title: short.title,
    caption: short.caption,
    openingText: short.openingText,
    endCardText: short.endCardText,
    editorPreset: short.editorPreset,
  };
  return {
    id: overrides.id ?? "short_project_1",
    projectId: overrides.projectId ?? "project_1",
    sourceAssetId: overrides.sourceAssetId ?? "source_asset_1",
    sourceFilename: overrides.sourceFilename ?? "source.mp4",
    transcriptId: overrides.transcriptId ?? "transcript_1",
    subtitleId: overrides.subtitleId ?? "subtitle_1",
    clipId: overrides.clipId ?? short.id,
    planId: overrides.planId ?? plan.id,
    shortId: overrides.shortId ?? short.id,
    name: overrides.name ?? "Linked AI Suggestion",
    clip: overrides.clip ?? {
      id: short.id,
      startSeconds: short.startSeconds,
      endSeconds: short.endSeconds,
      durationSeconds: short.durationSeconds,
      score: short.score,
      title: short.title,
      hook: short.openingText,
      reason: short.reason,
      punchline: short.endCardText,
      sourceChunkIndexes: short.sourceChunkIndexes,
      suggestedSubtitleLanguage: short.suggestedSubtitleLanguage,
    },
    plan,
    short,
    editor: overrides.editor ?? ({} as CreatorShortProjectRecord["editor"]),
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
    status: overrides.status ?? "exported",
    origin: overrides.origin ?? "ai_suggestion",
  };
}

function createTranscript(overrides: Partial<TranscriptVersion> = {}): TranscriptVersion {
  const chunks = overrides.chunks ?? [
    { text: "The host sets up the full topic.", timestamp: [0, 10] },
    { text: "This exact moment becomes the short.", timestamp: [10, 20] },
    { text: "The long video continues with more context.", timestamp: [20, 40] },
  ];
  return {
    id: overrides.id ?? "transcript_1",
    versionNumber: overrides.versionNumber ?? 1,
    label: overrides.label ?? "Original transcript",
    status: overrides.status ?? "completed",
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
    requestedLanguage: overrides.requestedLanguage ?? "en",
    detectedLanguage: overrides.detectedLanguage ?? "en",
    transcript: overrides.transcript ?? chunks.map((chunk) => chunk.text).join(" "),
    chunks,
    subtitles: overrides.subtitles ?? [
      {
        id: "subtitle_1",
        versionNumber: 1,
        label: "Original subtitles",
        language: "en",
        sourceLanguage: "en",
        kind: "original",
        createdAt: 1_000,
        updatedAt: 1_000,
        shiftSeconds: 0,
        chunks,
      },
    ],
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

test("buildVideoInfoPublishDraft maps the AI publish fields without adding chapters", () => {
  const draft = buildVideoInfoPublishDraft({
    youtube: {
      titleIdeas: ["  First title  "],
      description: "  Final description  ",
      pinnedComment: "Pin this",
      hashtags: ["#clipscribe", "#launch"],
      thumbnailHooks: ["Hook"],
      chapterText: "0:00 Intro",
    },
  });

  assert.deepEqual(draft, {
    title: "First title",
    description: "Final description",
    tagsInput: "clipscribe, launch",
  });
});

test("buildShortSuggestionPublishDraft maps short title and caption into publish fields", () => {
  const draft = buildShortSuggestionPublishDraft({
    short: {
      id: "short_1",
      startSeconds: 0,
      endSeconds: 30,
      durationSeconds: 30,
      score: 0.9,
      title: "  Viral short title  ",
      reason: "Hook",
      caption: "  This is the short caption. #shorts #clipscribe  ",
      openingText: "Opening",
      endCardText: "End",
      sourceChunkIndexes: [0],
      suggestedSubtitleLanguage: "en",
      editorPreset: {
        aspectRatio: "9:16",
        resolution: "1080x1920",
        subtitleStyle: "clean_caption",
        safeTopPct: 10,
        safeBottomPct: 14,
        targetDurationRange: [20, 45],
      },
    },
  });

  assert.deepEqual(draft, {
    title: "Viral short title",
    description: "This is the short caption. #shorts #clipscribe",
    tagsInput: "shorts, clipscribe",
  });
});

test("resolveYouTubeShortPublishTranscriptContext focuses the short subtitle chunks and keeps full context separate", () => {
  const transcript = createTranscript();
  const context = resolveYouTubeShortPublishTranscriptContext({
    transcript,
    subtitleId: "subtitle_1",
    short: {
      id: "short_1",
      startSeconds: 10,
      endSeconds: 20,
      durationSeconds: 10,
      score: 0.9,
      title: "Short",
      reason: "Reason",
      caption: "",
      openingText: "",
      endCardText: "",
      sourceChunkIndexes: [1],
      suggestedSubtitleLanguage: "en",
      editorPreset: {
        aspectRatio: "9:16",
        resolution: "1080x1920",
        subtitleStyle: "clean_caption",
        safeTopPct: 10,
        safeBottomPct: 14,
        targetDurationRange: [20, 45],
      },
    },
  });

  assert.equal(context?.shortTranscriptText, "This exact moment becomes the short.");
  assert.equal(context?.shortTranscriptChunks.length, 1);
  assert.match(context?.fullTranscriptText ?? "", /host sets up the full topic/);
  assert.match(context?.fullTranscriptText ?? "", /long video continues/);
});

test("resolveYouTubeShortPublishTranscriptContext truncates long full context around the short", () => {
  const transcript = createTranscript({
    chunks: [
      { text: "Intro context before the useful part.", timestamp: [0, 8] },
      { text: "The key short moment that needs packaging.", timestamp: [8, 16] },
      { text: "Follow up context after the useful part.", timestamp: [16, 24] },
      { text: "A very long tail that should not fit the request budget.", timestamp: [24, 80] },
    ],
  });
  const context = resolveYouTubeShortPublishTranscriptContext({
    transcript,
    clip: {
      id: "clip_1",
      startSeconds: 8,
      endSeconds: 16,
      durationSeconds: 8,
      score: 0.8,
      title: "Clip",
      hook: "Hook",
      reason: "Reason",
      punchline: "Punchline",
      sourceChunkIndexes: [1],
      suggestedSubtitleLanguage: "en",
    },
    maxContextChars: 90,
  });

  assert.equal(context?.shortTranscriptText, "The key short moment that needs packaging.");
  assert.equal(context?.contextTranscriptTruncated, true);
  assert.doesNotMatch(context?.fullTranscriptText ?? "", /very long tail/);
});

test("buildYouTubeShortPublishPromptProfile falls back to publish defaults for empty instructions", () => {
  const profile = buildYouTubeShortPublishPromptProfile({
    globalInstructions: " ",
    titleInstructions: "Use a numbered title.",
  });

  assert.equal(profile.globalInstructions, YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.global);
  assert.equal(profile.fieldInstructions?.titleIdeas, "Use a numbered title.");
  assert.equal(profile.fieldInstructions?.description, YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.description);
  assert.equal(profile.fieldInstructions?.hashtags, YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.hashtags);
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

test("resolveYouTubeShortEligibility requires known short exports to still fit YouTube rules", () => {
  assert.deepEqual(
    resolveYouTubeShortEligibility({
      exportKind: "short",
    }),
    {
      eligible: true,
      isVerticalOrSquare: true,
      durationWithinLimit: true,
      durationSeconds: undefined,
      width: undefined,
      height: undefined,
    }
  );

  assert.equal(
    resolveYouTubeShortEligibility({
      exportKind: "short",
      width: 1080,
      height: 1920,
      durationSeconds: YOUTUBE_SHORTS_MAX_DURATION_SECONDS + 1,
    }).eligible,
    false
  );

  assert.equal(
    resolveYouTubeShortEligibility({
      exportKind: "short",
      width: 1920,
      height: 1080,
      durationSeconds: 30,
    }).eligible,
    false
  );

  assert.deepEqual(
    resolveYouTubeShortEligibility({
      width: 1080,
      height: 1920,
      durationSeconds: YOUTUBE_SHORTS_MAX_DURATION_SECONDS,
    }),
    {
      eligible: true,
      isVerticalOrSquare: true,
      durationWithinLimit: true,
      durationSeconds: YOUTUBE_SHORTS_MAX_DURATION_SECONDS,
      width: 1080,
      height: 1920,
    }
  );

  assert.equal(
    resolveYouTubeShortEligibility({
      width: 1920,
      height: 1080,
      durationSeconds: 45,
    }).eligible,
    false
  );
  assert.equal(
    resolveYouTubeShortEligibility({
      width: 1080,
      height: 1920,
      durationSeconds: YOUTUBE_SHORTS_MAX_DURATION_SECONDS + 1,
    }).eligible,
    false
  );
});

test("inferYouTubePublishIntent defaults to short only for eligible sources", () => {
  assert.equal(
    inferYouTubePublishIntent({
      exportKind: "short",
      width: 1080,
      height: 1920,
      durationSeconds: YOUTUBE_SHORTS_MAX_DURATION_SECONDS + 1,
    }),
    "standard"
  );
  assert.equal(
    inferYouTubePublishIntent({
      width: 1080,
      height: 1920,
      durationSeconds: 30,
    }),
    "short"
  );
  assert.equal(
    inferYouTubePublishIntent({
      width: 1920,
      height: 1080,
      durationSeconds: 30,
    }),
    "standard"
  );
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
  assert.equal(results[0]?.sourceAssetId, eligible.sourceAssetId);
  assert.equal(results[0]?.durationSeconds, asset.durationSeconds);
  assert.equal(results[0]?.displayName, eligible.filename);
});

test("getEligibleYouTubeProjectExports preserves short suggestion metadata for publish prefill", () => {
  const asset = createAsset();
  const assetsById = new Map<string, ProjectAssetRecord>([[asset.id, asset]]);
  const exportRecord = createExport({
    id: "export_short_ai",
    kind: "short",
    outputAssetId: asset.id,
    shortProjectId: "short_project_1",
    shortProjectName: "Gemma 4 resumen",
    short: {
      id: "short_1",
      startSeconds: 0,
      endSeconds: 25,
      durationSeconds: 25,
      score: 0.88,
      title: "Short suggestion title",
      reason: "Reason",
      caption: "Short caption #shorts",
      openingText: "Opening",
      endCardText: "Outro",
      sourceChunkIndexes: [0],
      suggestedSubtitleLanguage: "en",
      editorPreset: {
        aspectRatio: "9:16",
        resolution: "1080x1920",
        subtitleStyle: "clean_caption",
        safeTopPct: 10,
        safeBottomPct: 14,
        targetDurationRange: [20, 45],
      },
    },
  });

  const [result] = getEligibleYouTubeProjectExports([exportRecord], assetsById);
  assert.equal(result?.shortProjectId, "short_project_1");
  assert.equal(result?.short?.title, "Short suggestion title");
  assert.equal(result?.displayName, "Gemma 4 resumen");
});

test("getEligibleYouTubeProjectExports falls back to linked short project metadata for short exports", () => {
  const asset = createAsset();
  const assetsById = new Map<string, ProjectAssetRecord>([[asset.id, asset]]);
  const linkedShortProject = createShortProject({
    id: "short_project_1",
    name: "Se puede psicoanalizar a una IA",
    short: {
      id: "short_ia",
      startSeconds: 0,
      endSeconds: 25,
      durationSeconds: 25,
      score: 0.88,
      title: "Short-specific AI title",
      reason: "Reason",
      caption: "Short-specific AI caption #shorts",
      openingText: "Opening",
      endCardText: "Outro",
      sourceChunkIndexes: [0],
      suggestedSubtitleLanguage: "es",
      editorPreset: {
        aspectRatio: "9:16",
        resolution: "1080x1920",
        subtitleStyle: "clean_caption",
        safeTopPct: 10,
        safeBottomPct: 14,
        targetDurationRange: [20, 45],
      },
    },
  });
  const exportRecord = createExport({
    id: "export_short_ai",
    kind: "short",
    outputAssetId: asset.id,
    shortProjectId: linkedShortProject.id,
  });

  const [result] = getEligibleYouTubeProjectExports(
    [exportRecord],
    assetsById,
    new Map([[linkedShortProject.id, linkedShortProject]])
  );

  assert.equal(result?.shortProjectId, linkedShortProject.id);
  assert.equal(result?.short?.title, "Short-specific AI title");
  assert.equal(result?.plan?.caption, "Short-specific AI caption #shorts");
  assert.equal(result?.displayName, "Se puede psicoanalizar a una IA");
});

test("resolveYouTubeShortExportForProjectAsset finds the short export that produced a selected project asset", () => {
  const shortAsset = createAsset({ id: "asset_short", createdAt: 3_000 });
  const timelineAsset = createAsset({ id: "asset_timeline", createdAt: 2_000 });
  const assetsById = new Map<string, ProjectAssetRecord>([
    [shortAsset.id, shortAsset],
    [timelineAsset.id, timelineAsset],
  ]);
  const exports = getEligibleYouTubeProjectExports(
    [
      createExport({ id: "export_short", kind: "short", outputAssetId: shortAsset.id, createdAt: 3_000 }),
      createExport({ id: "export_timeline", kind: "timeline", outputAssetId: timelineAsset.id, createdAt: 2_000 }),
    ],
    assetsById
  );

  assert.equal(
    resolveYouTubeShortExportForProjectAsset({
      assetId: shortAsset.id,
      exports,
    })?.exportId,
    "export_short"
  );
  assert.equal(
    resolveYouTubeShortExportForProjectAsset({
      assetId: timelineAsset.id,
      exports,
    }),
    null
  );
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
  assert.equal(results[0]?.width, videoAsset.width);
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
          displayName: "Clip corto",
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

test("resolveMatchingVideoInfoRecord returns the latest exact sourceAssetId match", () => {
  const latest = createVideoInfoRecord({ id: "latest", generatedAt: 2_000, sourceAssetId: "asset_1" });
  const older = createVideoInfoRecord({ id: "older", generatedAt: 1_000, sourceAssetId: "asset_1" });
  const other = createVideoInfoRecord({ id: "other", generatedAt: 3_000, sourceAssetId: "asset_2" });

  assert.equal(
    resolveMatchingVideoInfoRecord({
      history: [older, other, latest],
      sourceAssetId: "asset_1",
    })?.id,
    "latest"
  );
  assert.equal(
    resolveMatchingVideoInfoRecord({
      history: [other],
      sourceAssetId: "asset_1",
    }),
    null
  );
  assert.equal(
    resolveMatchingVideoInfoRecord({
      history: [latest],
      sourceAssetId: undefined,
    }),
    null
  );
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
    relatedVideo: {
      videoId: "video_related",
      title: "Related long-form",
      watchUrl: "https://youtube.com/watch?v=video_related",
      studioUrl: "https://studio.youtube.com/video/video_related/edit",
      privacyStatus: "public",
      publishedAt: "2026-03-20T09:00:00.000Z",
    },
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
    publishIntent: "short",
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
  assert.equal(record.draft.publishIntent, "short");
  assert.deepEqual(record.draft.tags, ["clipscribe", "launch"]);
  assert.equal(record.draft.localizations[0]?.locale, "es");
  assert.equal(record.draft.relatedVideo?.videoId, "video_related");
  assert.equal(record.draft.relatedVideo?.title, "Related long-form");
  assert.equal(record.result.processingStatus, "processing");
  assert.equal(record.result.thumbnailState, "applied");
  assert.equal(record.result.captionState, "skipped");
});
