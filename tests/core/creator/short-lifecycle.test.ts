import test from "node:test";
import assert from "node:assert/strict";

import type { CreatorViralClip } from "../../../src/lib/creator/types";
import {
  buildCompletedShortExportRecord,
  buildLocalBrowserRenderResponse,
  buildShortProjectRecord,
  deriveDefaultShortProjectName,
  markShortProjectExported,
  markShortProjectFailed,
  restoreShortProjectAfterCanceledExport,
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
  platforms: ["youtube_shorts", "instagram_reels", "tiktok"],
};

const samplePlan = {
  id: "plan_1",
  clipId: "clip_1",
  platform: "youtube_shorts" as const,
  title: "Plan",
  caption: "Caption",
  subtitleStyle: "clean_caption" as const,
  openingText: "Open",
  endCardText: "End",
  editorPreset: {
    platform: "youtube_shorts" as const,
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
  assert.equal(name, "YouTube Shorts • 12.5s-34.5s");
});

test("buildShortProjectRecord reuses explicit-id project and preserves createdAt", () => {
  const existing = {
    id: "shortproj_existing",
    sourceProjectId: "proj_1",
    sourceMediaId: "media_1",
    sourceFilename: "source.mp4",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
    clipId: "clip_1",
    planId: "plan_1",
    platform: "youtube_shorts" as const,
    name: "Existing Name",
    clip: sampleClip,
    plan: samplePlan,
    editor: sampleEditor,
    createdAt: 1000,
    updatedAt: 1000,
    status: "draft" as const,
    lastExportId: "exp_old",
  };

  const record = buildShortProjectRecord({
    status: "exporting",
    now: 2000,
    newId: "shortproj_new",
    sourceProjectId: "proj_1",
    sourceMediaId: "media_1",
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
    sourceProjectId: "proj_1",
    sourceMediaId: "media_1",
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
  assert.equal(record.name, "YouTube Shorts • clock-clock");
  assert.equal(record.createdAt, 5000);
  assert.equal(record.lastExportId, undefined);
});

test("markShortProjectExported and markShortProjectFailed update status metadata", () => {
  const base = buildShortProjectRecord({
    status: "exporting",
    now: 100,
    newId: "sp_1",
    sourceProjectId: "proj",
    sourceMediaId: "media",
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
    sourceProjectId: "proj",
    sourceMediaId: "media",
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

test("buildCompletedShortExportRecord and render response produce stable local-browser payloads", () => {
  const exportRecord = buildCompletedShortExportRecord({
    id: "exp_1",
    shortProjectId: "sp_1",
    sourceProjectId: "proj_1",
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
  });

  assert.equal(exportRecord.status, "completed");
  assert.equal(exportRecord.platform, "youtube_shorts");
  assert.equal(exportRecord.filename, "out.mp4");

  const response = buildLocalBrowserRenderResponse({
    jobId: exportRecord.id,
    createdAt: exportRecord.createdAt,
    plan: samplePlan,
    filename: exportRecord.filename,
    subtitleBurnedIn: true,
    ffmpegCommandPreview: exportRecord.debugFfmpegCommand || [],
    notes: exportRecord.debugNotes || [],
  });

  assert.equal(response.providerMode, "local-browser");
  assert.equal(response.output.filename, "out.mp4");
  assert.equal(response.output.subtitleBurnedIn, true);
  assert.deepEqual(response.debugPreview.notes, ["note 1"]);
});
