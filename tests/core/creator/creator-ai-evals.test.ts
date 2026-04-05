import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBaseInputSummary,
  createCreatorLLMRequestFingerprint,
  runTrackedCreatorJson,
} from "../../../src/lib/server/creator/shared/llm-runtime";

const baseInput = {
  projectId: "proj_eval",
  sourceAssetId: "asset_eval",
  transcriptId: "tx_eval",
  subtitleId: "sub_eval",
  sourceSignature: "sig_eval",
  transcriptText: "Hello world transcript",
  transcriptChunks: [{ text: "Hello world", timestamp: [0, 2] as [number, number] }],
  subtitleChunks: [{ text: "Hello world", timestamp: [0, 2] as [number, number] }],
  transcriptVersionLabel: "T1",
  subtitleVersionLabel: "S1",
};

async function withMockFetch(
  implementation: typeof globalThis.fetch,
  run: () => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("AI eval traces record provider, model, prompt version, token usage, and cost for OpenAI", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
          },
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
    async () => {
      const result = await runTrackedCreatorJson({
        apiKey: "sk-proj-demo",
        apiKeySource: "env",
        provider: "openai",
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [{ role: "user", content: "hello" }],
        feature: "video_info",
        operation: "generate_video_info",
        promptVersion: "creator-video-info-v4",
        inputSummary: buildBaseInputSummary(baseInput),
        requestFingerprint: createCreatorLLMRequestFingerprint(baseInput),
      });

      assert.equal(result.llmRun.provider, "openai");
      assert.equal(result.llmRun.model, "gpt-4.1-mini");
      assert.equal(result.llmRun.promptVersion, "creator-video-info-v4");
      assert.equal(result.llmRun.usage?.totalTokens, 1500);
      assert.equal(result.llmRun.estimatedCostSource, "estimated");
      assert.ok((result.llmRun.estimatedCostUsd ?? 0) > 0);
    }
  );
});

test("AI eval traces record provider, model, prompt version, token usage, and cost for Gemini", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          usage: {
            prompt_tokens: 2000,
            completion_tokens: 1000,
            total_tokens: 3000,
          },
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ),
    async () => {
      const result = await runTrackedCreatorJson({
        apiKey: "AIza-demo",
        apiKeySource: "header",
        provider: "gemini",
        model: "gemini-2.5-flash",
        temperature: 0.4,
        messages: [{ role: "user", content: "hello" }],
        feature: "shorts",
        operation: "generate_shorts",
        promptVersion: "creator-shorts-v3",
        inputSummary: buildBaseInputSummary(baseInput),
        requestFingerprint: createCreatorLLMRequestFingerprint(baseInput),
      });

      assert.equal(result.llmRun.provider, "gemini");
      assert.equal(result.llmRun.model, "gemini-2.5-flash");
      assert.equal(result.llmRun.promptVersion, "creator-shorts-v3");
      assert.equal(result.llmRun.usage?.totalTokens, 3000);
      assert.equal(result.llmRun.estimatedCostSource, "estimated");
      assert.ok((result.llmRun.estimatedCostUsd ?? 0) > 0);
    }
  );
});
