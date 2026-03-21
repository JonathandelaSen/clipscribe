import test from "node:test";
import assert from "node:assert/strict";

import type { CreatorLLMRunRecord } from "../../../src/lib/creator/types";
import { sortCreatorLLMRuns } from "../../../src/lib/repositories/creator-llm-runs-repo";

const baseRun: CreatorLLMRunRecord = {
  id: "run_1",
  feature: "shorts",
  provider: "openai",
  operation: "generate_shorts",
  model: "gpt-test",
  startedAt: 100,
  completedAt: 150,
  durationMs: 50,
  status: "success",
  temperature: 0.4,
  requestFingerprint: "fp_1",
  promptVersion: "creator-shorts-v1",
  inputSummary: {
    transcriptCharCount: 10,
    transcriptChunkCount: 1,
    subtitleChunkCount: 1,
  },
  requestPayloadRaw: { messages: [] },
  responsePayloadRaw: { choices: [] },
  parsedOutputSnapshot: { ok: true },
  redactionState: "raw",
  exportable: true,
  containsRawPayload: true,
};

test("sortCreatorLLMRuns orders runs by most recent startedAt first", () => {
  const sorted = sortCreatorLLMRuns([
    { ...baseRun, id: "older", startedAt: 100 },
    { ...baseRun, id: "newer", startedAt: 200 },
    { ...baseRun, id: "middle", startedAt: 150 },
  ]);

  assert.deepEqual(
    sorted.map((record) => record.id),
    ["newer", "middle", "older"]
  );
});
