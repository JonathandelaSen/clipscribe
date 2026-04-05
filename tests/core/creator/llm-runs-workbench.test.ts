import test from "node:test";
import assert from "node:assert/strict";

import type { CreatorLLMRunRecord } from "../../../src/lib/creator/types";
import {
  collectAiRunDiffItems,
  computeAiRunsWorkbenchMetrics,
  filterAiRunsWorkbenchRecords,
} from "../../../src/lib/creator/llm-runs-workbench";

function makeRun(overrides: Partial<CreatorLLMRunRecord> = {}): CreatorLLMRunRecord {
  return {
    id: overrides.id ?? "run_1",
    feature: overrides.feature ?? "shorts",
    provider: overrides.provider ?? "openai",
    operation: overrides.operation ?? "generate_shorts",
    model: overrides.model ?? "gpt-test",
    projectId: overrides.projectId ?? "project_1",
    sourceAssetId: overrides.sourceAssetId ?? "asset_1",
    sourceSignature: overrides.sourceSignature ?? "sig_1",
    startedAt: overrides.startedAt ?? 1_000,
    completedAt: overrides.completedAt ?? 2_000,
    durationMs: overrides.durationMs ?? 1_000,
    fetchDurationMs: overrides.fetchDurationMs ?? 900,
    parseDurationMs: overrides.parseDurationMs ?? 100,
    status: overrides.status ?? "success",
    temperature: overrides.temperature ?? 0.4,
    requestFingerprint: overrides.requestFingerprint ?? "fp_1",
    promptVersion: overrides.promptVersion ?? "prompt-v1",
    inputSummary: overrides.inputSummary ?? {
      projectId: "project_1",
      sourceAssetId: "asset_1",
      transcriptId: "tx_1",
      subtitleId: "sub_1",
      sourceSignature: "sig_1",
      transcriptVersionLabel: "T1",
      subtitleVersionLabel: "S1",
      transcriptCharCount: 120,
      transcriptChunkCount: 4,
      subtitleChunkCount: 4,
      niche: "fitness",
      audience: "creators",
      tone: "energetic",
    },
    usage: overrides.usage ?? {
      totalTokens: 100,
    },
    estimatedCostUsd: overrides.estimatedCostUsd ?? null,
    requestPayloadRaw: overrides.requestPayloadRaw ?? { model: "gpt-test" },
    responsePayloadRaw: overrides.responsePayloadRaw ?? { ok: true },
    parsedOutputSnapshot: overrides.parsedOutputSnapshot ?? { clips: [{ id: "clip_1", score: 9 }] },
    errorCode: overrides.errorCode,
    errorMessage: overrides.errorMessage,
    redactionState: overrides.redactionState ?? "raw",
    exportable: overrides.exportable ?? true,
    containsRawPayload: overrides.containsRawPayload ?? true,
  };
}

test("filterAiRunsWorkbenchRecords applies project, status, model, search, and sort", () => {
  const runs = [
    makeRun({ id: "run_old", startedAt: 100, model: "gpt-a", projectId: "project_a", provider: "openai" }),
    makeRun({
      id: "run_new",
      startedAt: 300,
      model: "gpt-b",
      projectId: "project_b",
      provider: "gemini",
      status: "provider_error",
      errorMessage: "quota exceeded",
    }),
    makeRun({ id: "run_mid", startedAt: 200, model: "gpt-a", projectId: "project_b", provider: "openai" }),
  ];

  const filtered = filterAiRunsWorkbenchRecords(runs, {
    projectId: "project_b",
    provider: "gemini",
    status: "provider_error",
    model: "gpt-b",
    q: "quota",
    sort: "oldest",
  });

  assert.deepEqual(
    filtered.map((run) => run.id),
    ["run_new"]
  );
});

test("computeAiRunsWorkbenchMetrics aggregates totals and error rate", () => {
  const metrics = computeAiRunsWorkbenchMetrics([
    makeRun({ id: "run_1", durationMs: 1000, usage: { totalTokens: 100 } }),
    makeRun({ id: "run_2", durationMs: 3000, usage: { totalTokens: 300 }, status: "parse_error" }),
    makeRun({ id: "run_3", durationMs: 250, usage: { totalTokens: 0 }, status: "processing" }),
  ]);

  assert.equal(metrics.totalRuns, 3);
  assert.equal(metrics.errorRuns, 1);
  assert.equal(metrics.successRuns, 1);
  assert.equal(metrics.uniqueModels, 1);
  assert.equal(metrics.totalTokens, 400);
  assert.equal(metrics.averageDurationMs, 1416.6666666666667);
  assert.equal(metrics.errorRate, 0.5);
});

test("collectAiRunDiffItems reports nested object and array changes", () => {
  const diff = collectAiRunDiffItems(
    {
      clips: [{ id: "clip_1", score: 8 }],
      summary: "before",
    },
    {
      clips: [{ id: "clip_1", score: 10 }, { id: "clip_2", score: 7 }],
      summary: "after",
      notes: true,
    }
  );

  assert.ok(diff.some((item) => item.path === "root.clips[0].score" && item.kind === "changed"));
  assert.ok(diff.some((item) => item.path === "root.clips.length" && item.kind === "changed"));
  assert.ok(diff.some((item) => item.path === "root.notes" && item.kind === "added"));
  assert.ok(diff.some((item) => item.path === "root.summary" && item.kind === "changed"));
});
