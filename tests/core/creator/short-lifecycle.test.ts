import test from "node:test";
import assert from "node:assert/strict";

import type { CreatorViralClip } from "../../../src/lib/creator/types";
import { buildCompletedCreatorShortRenderResponse } from "../../../src/lib/creator/system-export-contract";
import {
  buildAiSuggestionInputSummary,
  buildAiSuggestionProjectRecords,
  buildAiSuggestionSourceSignature,
  buildCompletedShortExportRecord,
  buildShortProjectRecord,
  deriveDefaultShortProjectName,
  markShortProjectExported,
  markShortProjectFailed,
  restoreShortProjectAfterCanceledExport,
  shouldReuseShortProjectId,
} from "../../../src/lib/creator/core/short-lifecycle";

const sampleClip: CreatorViralClip = {
  id: "clip_1",
  startSeconds: 12.5,
  endSeconds: 34.5,
  durationSeconds: 22,
  score: 88,
  title: "Clip",
  hook: "Hook",
  reason: "Reason",
  punchline: "Punchline",
  sourceChunkIndexes: [],
  suggestedSubtitleLanguage: "en",
};

const samplePlan = {
  id: "plan_1",
  clipId: "clip_1",
  title: "Plan",
  caption: "Caption",
  openingText: "Open",
  endCardText: "End",
  editorPreset: {
    aspectRatio: "9:16" as const,
    resolution: "1080x1920" as const,
    subtitleStyle: "clean_caption" as const,
    safeTopPct: 10,
    safeBottomPct: 12,
    targetDurationRange: [15, 60] as [number, number],
  },
};

const sampleEditor = {
  zoom: 1.1,
  panX: 10,
  panY: -20,
  subtitleScale: 1,
  subtitleXPositionPct: 50,
  subtitleYOffsetPct: 78,
  showSafeZones: true,
};

test("deriveDefaultShortProjectName uses platform + clip time range", () => {
  const name = deriveDefaultShortProjectName(samplePlan, sampleClip, (s) => `${s}s`);
  assert.equal(name, "Short Cut • 12.5s-34.5s");
});

test("buildShortProjectRecord reuses explicit-id project and preserves createdAt", () => {
  const existing = {
    id: "shortproj_existing",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clipId: "clip_1",
    planId: "plan_1",
    name: "Existing Name",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    createdAt: 1000,
    updatedAt: 1000,
    status: "draft" as const,
    origin: "manual" as const,
    lastExportId: "exp_old",
  };

  const record = buildShortProjectRecord({
    status: "exporting",
    now: 2000,
    newId: "shortproj_new",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [existing],
    explicitId: "shortproj_existing",
    explicitName: "Renamed",
    secondsToClock: (s) => `${s}s`,
  });

  assert.equal(record.id, "shortproj_existing");
  assert.equal(record.createdAt, 1000);
  assert.equal(record.updatedAt, 2000);
  assert.equal(record.name, "Renamed");
  assert.equal(record.lastExportId, "exp_old");
  assert.equal(record.status, "exporting");
});

test("buildShortProjectRecord generates default name for new record", () => {
  const record = buildShortProjectRecord({
    status: "draft",
    now: 5000,
    newId: "shortproj_new",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [],
    secondsToClock: () => "clock",
  });

  assert.equal(record.id, "shortproj_new");
  assert.equal(record.name, "Short Cut • clock-clock");
  assert.equal(record.createdAt, 5000);
  assert.equal(record.lastExportId, undefined);
  assert.equal(record.origin, "manual");
});

test("buildShortProjectRecord does not reuse an existing record from a different source asset", () => {
  const existing = buildShortProjectRecord({
    status: "draft",
    now: 1000,
    newId: "shortproj_existing",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source-a.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [],
    secondsToClock: (s) => `${s}s`,
  });

  const record = buildShortProjectRecord({
    status: "draft",
    now: 2000,
    newId: "shortproj_new",
    projectId: "proj_1",
    sourceAssetId: "media_2",
    sourceFilename: "source-b.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [existing],
    secondsToClock: (s) => `${s}s`,
  });

  assert.equal(record.id, "shortproj_new");
  assert.equal(record.createdAt, 2000);
  assert.equal(record.sourceAssetId, "media_2");
});

test("buildShortProjectRecord creates a new manual record unless an explicit id is provided", () => {
  const existing = buildShortProjectRecord({
    status: "draft",
    now: 1000,
    newId: "shortproj_existing",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [],
    secondsToClock: (s) => `${s}s`,
  });

  const record = buildShortProjectRecord({
    status: "draft",
    now: 2000,
    newId: "shortproj_new",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [existing],
    secondsToClock: (s) => `${s}s`,
  });

  assert.equal(record.id, "shortproj_new");
  assert.equal(record.createdAt, 2000);
  assert.equal(record.origin, "manual");
});

test("AI suggestion helpers build normalized signatures and records", () => {
  const signatureA = buildAiSuggestionSourceSignature({
    projectId: "proj_1",
    sourceAssetId: "media_1",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    niche: "  Productivity ",
    audience: "Founders",
    tone: " DIRECT ",
  });

  const signatureB = buildAiSuggestionSourceSignature({
    projectId: "proj_1",
    sourceAssetId: "media_1",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    niche: "productivity",
    audience: "founders",
    tone: "direct",
  });

  assert.equal(signatureA, signatureB);

  const inputSummary = buildAiSuggestionInputSummary({
    request: {
      niche: "Productivity",
      audience: "Founders",
      tone: "Direct",
      transcriptVersionLabel: "Transcript v2",
      subtitleVersionLabel: "English Subs",
    },
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    model: "gpt-test",
  });

  assert.deepEqual(inputSummary, {
    niche: "Productivity",
    audience: "Founders",
    tone: "Direct",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    transcriptVersionLabel: "Transcript v2",
    subtitleVersionLabel: "English Subs",
    model: "gpt-test",
  });

  const analysis = {
    ok: true as const,
    providerMode: "openai" as const,
    model: "gpt-test",
    generatedAt: 123,
    runtimeSeconds: 45,
    youtube: {
      titleIdeas: [],
      description: "",
      pinnedComment: "",
      hashtags: [],
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
    viralClips: [sampleClip],
    shortsPlans: [samplePlan],
    editorPresets: [samplePlan.editorPreset],
  };

  const records = buildAiSuggestionProjectRecords({
    analysis,
    now: 999,
    generationId: "gen_1",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    sourceSignature: signatureA,
    inputSummary,
    editor: sampleEditor,
    savedRecords: [],
    newId: () => "shortproj_ai_1",
    secondsToClock: (value) => `${value}s`,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].id, "shortproj_ai_1");
  assert.equal(records[0].origin, "ai_suggestion");
  assert.equal(records[0].suggestionGenerationId, "gen_1");
  assert.equal(records[0].suggestionGeneratedAt, 999);
  assert.equal(records[0].suggestionSourceSignature, signatureA);
  assert.deepEqual(records[0].suggestionInputSummary, inputSummary);
  assert.equal(records[0].name, "AI Suggestion • 12.5s-34.5s");
});

test("shouldReuseShortProjectId only reuses manual records", () => {
  assert.equal(shouldReuseShortProjectId(null), undefined);
  assert.equal(shouldReuseShortProjectId({ id: "manual_1", origin: "manual" }), "manual_1");
  assert.equal(shouldReuseShortProjectId({ id: "ai_1", origin: "ai_suggestion" }), undefined);
});

test("markShortProjectExported and markShortProjectFailed update status metadata", () => {
  const base = buildShortProjectRecord({
    status: "exporting",
    now: 100,
    newId: "sp_1",
    projectId: "proj",
    sourceAssetId: "media",
    sourceFilename: "f.mp4",
    transcriptId: "tx",
    subtitleId: "sub",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [],
    secondsToClock: (s) => `${s}`,
  });

  const exported = markShortProjectExported(base, { now: 200, exportId: "exp_1" });
  assert.equal(exported.status, "exported");
  assert.equal(exported.lastExportId, "exp_1");
  assert.equal(exported.lastError, undefined);

  const failed = markShortProjectFailed(base, { now: 300, error: "boom" });
  assert.equal(failed.status, "error");
  assert.equal(failed.lastError, "boom");
  assert.equal(failed.updatedAt, 300);
});

test("restoreShortProjectAfterCanceledExport keeps current config and restores prior non-exporting metadata", () => {
  const exporting = buildShortProjectRecord({
    status: "exporting",
    now: 100,
    newId: "sp_1",
    projectId: "proj",
    sourceAssetId: "media",
    sourceFilename: "f.mp4",
    transcriptId: "tx",
    subtitleId: "sub",
    clip: {
      ...sampleClip,
      startSeconds: 14,
      endSeconds: 30,
      durationSeconds: 16,
    },
    plan: samplePlan,
    editor: sampleEditor,
    savedRecords: [],
    secondsToClock: (s) => `${s}`,
  });

  const restored = restoreShortProjectAfterCanceledExport(exporting, {
    now: 250,
    previousProject: {
      status: "exported",
      lastExportId: "exp_prev",
      lastError: undefined,
    },
  });

  assert.equal(restored.clip.startSeconds, 14);
  assert.equal(restored.status, "exported");
  assert.equal(restored.lastExportId, "exp_prev");
  assert.equal(restored.updatedAt, 250);
});

test("buildCompletedShortExportRecord and render response produce stable system payloads", () => {
  const exportRecord = buildCompletedShortExportRecord({
    id: "exp_1",
    shortProjectId: "sp_1",
    projectId: "proj_1",
    sourceAssetId: "media_1",
    sourceFilename: "source.mp4",
    plan: samplePlan,
    clip: sampleClip,
    editor: sampleEditor,
    createdAt: 1234,
    filename: "out.mp4",
    mimeType: "video/mp4",
    sizeBytes: 9876,
    debugFfmpegCommand: ["ffmpeg", "-i", "source.mp4"],
    debugNotes: ["note 1"],
    renderModeUsed: "fast_ass",
    encoderUsed: "h264_videotoolbox",
    timingsMs: {
      server: {
        ffmpeg: 42,
      },
    },
    counts: {
      subtitleChunkCount: 6,
      pngOverlayCount: 1,
      overlayRasterPixelArea: 245760,
      overlayRasterAreaPct: 11.85,
      introOverlayCount: 1,
      outroOverlayCount: 0,
    },
  });

  assert.equal(exportRecord.status, "completed");
  assert.equal(exportRecord.filename, "out.mp4");
  assert.equal(exportRecord.renderModeUsed, "fast_ass");

  const response = buildCompletedCreatorShortRenderResponse({
    providerMode: "system",
    jobId: exportRecord.id,
    createdAt: exportRecord.createdAt,
    filename: exportRecord.filename,
    subtitleBurnedIn: true,
    ffmpegCommandPreview: exportRecord.debugFfmpegCommand || [],
    notes: exportRecord.debugNotes || [],
    renderModeUsed: exportRecord.renderModeUsed,
    encoderUsed: exportRecord.encoderUsed,
    timingsMs: exportRecord.timingsMs,
    counts: exportRecord.counts,
  });

  assert.equal(response.providerMode, "system");
  assert.equal(response.output.filename, "out.mp4");
  assert.equal(response.output.subtitleBurnedIn, true);
  assert.deepEqual(response.debugPreview.notes, ["note 1"]);
  assert.equal(response.debugPreview.renderModeUsed, "fast_ass");
  assert.equal(response.debugPreview.encoderUsed, "h264_videotoolbox");
});
