import test from "node:test";
import assert from "node:assert/strict";

import {
  getAiSuggestionCreatorShortProjects,
  getManualCreatorShortProjects,
  groupCreatorShortProjectsBySuggestionGeneration,
} from "../../../src/lib/creator/core/short-library";
import type { CreatorShortProjectRecord } from "../../../src/lib/creator/storage";

const manualRecord: CreatorShortProjectRecord = {
  id: "manual_1",
  projectId: "proj_1",
  sourceAssetId: "asset_1",
  sourceFilename: "source.mp4",
  transcriptId: "tx_1",
  subtitleId: "sub_1",
  clipId: "clip_manual",
  planId: "plan_manual",

  name: "Manual short",
  clip: {
    id: "clip_manual",
    startSeconds: 5,
    endSeconds: 25,
    durationSeconds: 20,
    score: 70,
    title: "Manual clip",
    hook: "Manual hook",
    reason: "Manual reason",
    punchline: "Manual punchline",
    sourceChunkIndexes: [0],
    suggestedSubtitleLanguage: "en",
  },
  plan: {
    id: "plan_manual",
    clipId: "clip_manual",
  
    title: "Manual plan",
    caption: "Manual caption",
    openingText: "Open",
    endCardText: "End",
    editorPreset: {
    
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleStyle: "clean_caption",
      safeTopPct: 10,
      safeBottomPct: 12,
      targetDurationRange: [15, 60],
    },
  },
  editor: {
    zoom: 1,
    panX: 0,
    panY: 0,
    subtitleScale: 1,
    subtitleXPositionPct: 50,
    subtitleYOffsetPct: 78,
    showSubtitles: true,
    showSafeZones: true,
    subtitleStyle: {},
  },
  createdAt: 100,
  updatedAt: 120,
  status: "draft",
  origin: "manual",
};

const aiRecordA: CreatorShortProjectRecord = {
  ...manualRecord,
  id: "ai_1",
  clipId: "clip_ai_1",
  planId: "plan_ai_1",
  name: "AI Suggestion A",
  clip: {
    ...manualRecord.clip,
    id: "clip_ai_1",
    startSeconds: 10,
    endSeconds: 32,
    durationSeconds: 22,
    score: 91,
  },
  plan: {
    ...manualRecord.plan,
    id: "plan_ai_1",
    clipId: "clip_ai_1",
    title: "AI plan A",
  },
  createdAt: 200,
  updatedAt: 250,
  origin: "ai_suggestion",
  suggestionGenerationId: "gen_1",
  suggestionGeneratedAt: 240,
  suggestionSourceSignature: "sig_1",
  suggestionInputSummary: {
    niche: "Productivity",
    audience: "Founders",
    tone: "Direct",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
  },
};

const aiRecordB: CreatorShortProjectRecord = {
  ...aiRecordA,
  id: "ai_2",
  clipId: "clip_ai_2",
  planId: "plan_ai_2",
  name: "AI Suggestion B",
  clip: {
    ...aiRecordA.clip,
    id: "clip_ai_2",
    startSeconds: 40,
    endSeconds: 59,
    durationSeconds: 19,
    score: 87,
  },
  plan: {
    ...aiRecordA.plan,
    id: "plan_ai_2",
    clipId: "clip_ai_2",
    title: "AI plan B",
  },
  createdAt: 205,
  updatedAt: 245,
};

const aiRecordC: CreatorShortProjectRecord = {
  ...aiRecordA,
  id: "ai_3",
  clipId: "clip_ai_3",
  planId: "plan_ai_3",
  name: "AI Suggestion C",
  clip: {
    ...aiRecordA.clip,
    id: "clip_ai_3",
    startSeconds: 65,
    endSeconds: 90,
    durationSeconds: 25,
    score: 95,
  },
  plan: {
    ...aiRecordA.plan,
    id: "plan_ai_3",
    clipId: "clip_ai_3",
    title: "AI plan C",
  },
  createdAt: 300,
  updatedAt: 320,
  suggestionGenerationId: "gen_2",
  suggestionGeneratedAt: 310,
  suggestionSourceSignature: "sig_2",
  suggestionInputSummary: {
    niche: "Productivity",
    audience: "Founders",
    tone: "Playful",
    transcriptId: "tx_1",
    subtitleId: "sub_1",
  },
};

test("creator shorts repo helpers separate manual and AI suggestion projects", () => {
  const records = [manualRecord, aiRecordA, aiRecordB, aiRecordC];

  assert.deepEqual(
    getManualCreatorShortProjects(records).map((record) => record.id),
    ["manual_1"]
  );
  assert.deepEqual(
    getAiSuggestionCreatorShortProjects(records).map((record) => record.id),
    ["ai_1", "ai_2", "ai_3"]
  );
});

test("groupCreatorShortProjectsBySuggestionGeneration groups and sorts AI batches", () => {
  const groups = groupCreatorShortProjectsBySuggestionGeneration([manualRecord, aiRecordA, aiRecordB, aiRecordC]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].generationId, "gen_2");
  assert.equal(groups[0].generatedAt, 310);
  assert.equal(groups[0].sourceSignature, "sig_2");
  assert.deepEqual(groups[0].projects.map((record) => record.id), ["ai_3"]);

  assert.equal(groups[1].generationId, "gen_1");
  assert.equal(groups[1].generatedAt, 240);
  assert.equal(groups[1].sourceSignature, "sig_1");
  assert.deepEqual(groups[1].projects.map((record) => record.id), ["ai_1", "ai_2"]);
});
