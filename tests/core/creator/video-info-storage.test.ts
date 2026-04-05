import test from "node:test";
import assert from "node:assert/strict";

import { createVideoInfoPromptCustomizationSnapshot } from "../../../src/lib/creator/prompt-customization";
import type { CreatorVideoInfoGenerateRequest, CreatorVideoInfoGenerateResponse } from "../../../src/lib/creator/types";
import { buildProjectVideoInfoRecord, resolveProjectVideoInfoAnalysis } from "../../../src/lib/creator/video-info-storage";

const request: CreatorVideoInfoGenerateRequest = {
  projectId: "project_1",
  sourceAssetId: "asset_1",
  transcriptId: "tx_1",
  sourceSignature: "sig_1",
  transcriptVersionLabel: "T1",
  transcriptText: "Hello world transcript",
  transcriptChunks: [{ text: "Hello world", timestamp: [0, 2] }],
  videoInfoBlocks: ["titleIdeas", "description"],
  promptCustomization: createVideoInfoPromptCustomizationSnapshot({
    globalProfile: {
      fieldInstructions: {
        titleIdeas: "Use emojis sometimes.",
      },
    },
  }),
};

const response: CreatorVideoInfoGenerateResponse = {
  ok: true,
  providerMode: "openai",
  model: "gpt-test",
  generatedAt: 123,
  runtimeSeconds: 2,
  youtube: {
    titleIdeas: ["Hello world"],
    description: "Description",
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
  insights: {
    transcriptWordCount: 2,
    estimatedSpeakingRateWpm: 60,
    repeatedTerms: [],
    detectedTheme: "Testing",
  },
};

test("buildProjectVideoInfoRecord keeps the request summary needed to restore publish metadata", () => {
  const record = buildProjectVideoInfoRecord({
    request,
    response,
  });

  assert.equal(record.sourceAssetId, "asset_1");
  assert.equal(record.sourceSignature, "sig_1");
  assert.equal(record.inputSummary.transcriptId, "tx_1");
  assert.deepEqual(record.inputSummary.videoInfoBlocks, ["titleIdeas", "description"]);
  assert.equal(record.inputSummary.provider, "openai");
  assert.equal(record.inputSummary.promptCustomizationMode, "global_customized");
  assert.equal(record.inputSummary.promptCustomizationHash, request.promptCustomization?.hash);
  assert.deepEqual(record.inputSummary.promptEditedSections, ["field:titleIdeas"]);
  assert.equal(record.analysis.youtube.titleIdeas[0], "Hello world");
});

test("resolveProjectVideoInfoAnalysis returns saved analysis only for matching source signatures", () => {
  const record = buildProjectVideoInfoRecord({
    request,
    response,
  });

  assert.equal(
    resolveProjectVideoInfoAnalysis({ youtubeVideoInfo: record }, "sig_1")?.youtube.description,
    "Description"
  );
  assert.equal(
    resolveProjectVideoInfoAnalysis({ youtubeVideoInfo: record }, "sig_other")?.youtube.description,
    "Description"
  );
  assert.equal(resolveProjectVideoInfoAnalysis({ youtubeVideoInfo: record }, undefined)?.model, "gpt-test");
});
