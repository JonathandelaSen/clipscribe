import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBaseInputSummary,
  createCreatorLLMRequestFingerprint,
  runTrackedCreatorJson,
} from "../../../src/lib/server/creator/shared/llm-runtime";
import { CreatorAIError } from "../../../src/lib/server/creator/shared/errors";

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

const baseInput = {
  projectId: "proj_1",
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

test("createCreatorLLMRequestFingerprint is stable for the same normalized input", () => {
  const left = createCreatorLLMRequestFingerprint({
    request: {
      b: 2,
      a: 1,
    },
  });
  const right = createCreatorLLMRequestFingerprint({
    request: {
      a: 1,
      b: 2,
    },
  });

  assert.equal(left, right);
});

test("runTrackedCreatorJson returns parsed JSON and a trace without the api key", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
          },
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true, clips: ["a"] }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      ),
    async () => {
      const result = await runTrackedCreatorJson({
        apiKey: "AIza-secret",
        apiKeySource: "header",
        provider: "gemini",
        model: "gemini-2.5-flash",
        temperature: 0.4,
        messages: [
          { role: "system", content: "Return JSON only" },
          { role: "user", content: "Say hello" },
        ],
        feature: "shorts",
        operation: "generate_shorts",
        promptVersion: "creator-shorts-v1",
        inputSummary: buildBaseInputSummary(baseInput),
        requestFingerprint: createCreatorLLMRequestFingerprint(baseInput),
        projectId: baseInput.projectId,
        sourceAssetId: baseInput.sourceAssetId,
        sourceSignature: baseInput.sourceSignature,
      });

      assert.deepEqual(result.parsed, { ok: true, clips: ["a"] });
      assert.equal(result.llmRun.status, "success");
      assert.equal(result.llmRun.model, "gemini-2.5-flash");
      assert.equal(result.llmRun.provider, "gemini");
      assert.equal(result.llmRun.requestPayloadRaw && typeof result.llmRun.requestPayloadRaw, "object");
      assert.doesNotMatch(JSON.stringify(result.llmRun.requestPayloadRaw), /AIza-secret/);
      assert.equal(result.llmRun.usage?.totalTokens, 120);
      assert.equal(result.llmRun.inputSummary.transcriptChunkCount, 1);
      assert.equal(result.llmRun.projectId, "proj_1");
      assert.equal(result.llmRun.apiKeySource, "header");
      assert.equal(result.llmRun.estimatedCostSource, "estimated");
    }
  );
});

test("runTrackedCreatorJson records provider errors", async () => {
  await withMockFetch(
    async () => new Response("bad api key", { status: 401 }),
    async () => {
      await assert.rejects(
        runTrackedCreatorJson({
          apiKey: "sk-proj-invalid",
          apiKeySource: "header",
          provider: "openai",
          model: "gpt-4.1-mini",
          temperature: 0.4,
          messages: [{ role: "user", content: "Say hello" }],
          feature: "video_info",
          operation: "generate_video_info",
          promptVersion: "creator-video-info-v1",
          inputSummary: buildBaseInputSummary(baseInput),
          requestFingerprint: createCreatorLLMRequestFingerprint(baseInput),
        }),
        (error) => {
          assert.ok(error instanceof CreatorAIError);
          assert.equal(error.trace?.status, "provider_error");
          assert.equal(error.trace?.errorCode, "openai_auth_error");
          return true;
        }
      );
    }
  );
});

test("runTrackedCreatorJson records malformed JSON as parse errors", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "{bad json",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      ),
    async () => {
      await assert.rejects(
        runTrackedCreatorJson({
          apiKey: "sk-proj-demo",
          apiKeySource: "env",
          provider: "openai",
          model: "gpt-4.1-mini",
          temperature: 0.4,
          messages: [{ role: "user", content: "Say hello" }],
          feature: "shorts",
          operation: "generate_shorts",
          promptVersion: "creator-shorts-v1",
          inputSummary: buildBaseInputSummary(baseInput),
          requestFingerprint: createCreatorLLMRequestFingerprint(baseInput),
        }),
        (error) => {
          assert.ok(error instanceof CreatorAIError);
          assert.equal(error.trace?.status, "parse_error");
          assert.equal(error.trace?.errorCode, "invalid_openai_response");
          assert.match(String(error.trace?.errorMessage ?? ""), /Preview:/);
          return true;
        }
      );
    }
  );
});

test("runTrackedCreatorJson explains when the provider emits mm:ss timestamps inside JSON", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"shorts":[{"id":"short_1","startSeconds":6:04,"endSeconds":6:31}]}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      ),
    async () => {
      await assert.rejects(
        runTrackedCreatorJson({
          apiKey: "AIza-demo",
          apiKeySource: "env",
          provider: "gemini",
          model: "gemini-2.5-flash",
          temperature: 0.4,
          messages: [{ role: "user", content: "Say hello" }],
          feature: "shorts",
          operation: "generate_shorts",
          promptVersion: "creator-shorts-v3",
          inputSummary: buildBaseInputSummary(baseInput),
          requestFingerprint: createCreatorLLMRequestFingerprint(baseInput),
        }),
        (error) => {
          assert.ok(error instanceof CreatorAIError);
          assert.equal(error.trace?.status, "parse_error");
          assert.match(error.message, /used a timestamp like "6:04"/i);
          assert.match(String(error.trace?.errorMessage ?? ""), /numeric seconds value/i);
          return true;
        }
      );
    }
  );
});
