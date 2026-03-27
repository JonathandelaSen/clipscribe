import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPendingCreatorLlmRun,
  markCreatorLlmRunProcessing,
  markCreatorLlmRunRequestFailed,
} from "../../../src/lib/creator/llm-run-pending";

const baseRequest = {
  projectId: "project_1",
  sourceAssetId: "asset_1",
  transcriptId: "tx_1",
  subtitleId: "sub_1",
  sourceSignature: "sig_1",
  transcriptText: "Hello world transcript",
  transcriptChunks: [{ text: "Hello world", timestamp: [0, 2] as [number, number] }],
  subtitleChunks: [{ text: "Hello world", timestamp: [0, 2] as [number, number] }],
  transcriptVersionLabel: "T1",
  subtitleVersionLabel: "S1",
};

test("buildPendingCreatorLlmRun creates a queued local run with summarized input", () => {
  const run = buildPendingCreatorLlmRun({
    feature: "video_info",
    operation: "generate_video_info",
    promptVersion: "creator-video-info-v2",
    request: baseRequest,
    inputSummary: {
      videoInfoBlocks: ["titleIdeas", "description"],
    },
  });

  assert.equal(run.status, "queued");
  assert.equal(run.feature, "video_info");
  assert.equal(run.model, "OpenAI pending");
  assert.equal(run.inputSummary.transcriptChunkCount, 1);
  assert.deepEqual(run.inputSummary.videoInfoBlocks, ["titleIdeas", "description"]);
  assert.equal(run.containsRawPayload, false);
});

test("pending creator LLM runs can be marked processing and failed", () => {
  const queued = buildPendingCreatorLlmRun({
    feature: "shorts",
    operation: "generate_shorts",
    promptVersion: "creator-shorts-v2",
    request: baseRequest,
  });

  const processing = markCreatorLlmRunProcessing(queued);
  assert.equal(processing.status, "processing");
  assert.ok(processing.durationMs >= 0);

  const failed = markCreatorLlmRunRequestFailed(processing, "Network offline");
  assert.equal(failed.status, "provider_error");
  assert.equal(failed.errorCode, "request_failed_before_response");
  assert.equal(failed.errorMessage, "Network offline");
});
