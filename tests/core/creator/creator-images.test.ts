import test from "node:test";
import assert from "node:assert/strict";

import { CREATOR_GEMINI_API_KEY_HEADER, CREATOR_OPENAI_API_KEY_HEADER } from "../../../src/lib/creator/user-ai-settings";
import { generateCreatorImages } from "../../../src/lib/server/creator/images/service";
import { CREATOR_IMAGES_PROMPT_VERSION } from "../../../src/lib/server/creator/images/prompt";
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

test("generateCreatorImages normalizes OpenAI image responses and traces the run", async () => {
  await withMockFetch(
    async (input, init) => {
      assert.match(String(input), /api\.openai\.com\/v1\/images\/generations/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-image-2");
      assert.match(body.prompt, /Frame instruction: Compose for a 1:1 square frame\./);
      assert.match(body.prompt, /A glossy product photo/);
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("fake-png").toString("base64"), revised_prompt: "Revised" }],
          usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    async () => {
      const result = await generateCreatorImages(
        {
          projectId: "project_1",
          prompt: "A glossy product photo",
          aspectRatio: "1:1",
          quality: "low",
          outputFormat: "png",
          count: 1,
          generationConfig: {
            provider: "openai",
            model: "gpt-image-2",
          },
        },
        {
          headers: new Headers({
            [CREATOR_OPENAI_API_KEY_HEADER]: "sk-demo",
          }),
        }
      );

      assert.equal(result.response.providerMode, "openai");
      assert.match(result.response.promptPreview, /Frame instruction: Compose for a 1:1 square frame\./);
      assert.equal(result.response.images.length, 1);
      assert.equal(result.response.images[0]?.mimeType, "image/png");
      assert.equal(result.llmRun?.feature, "images");
      assert.equal(result.llmRun?.operation, "generate_image");
      assert.equal(result.llmRun?.promptVersion, CREATOR_IMAGES_PROMPT_VERSION);
      assert.equal(result.llmRun?.status, "success");
      assert.equal(result.llmRun?.usage?.totalTokens, 50);
      assert.equal(result.llmRun?.estimatedCostSource, "estimated");
      assert.doesNotMatch(JSON.stringify(result.llmRun?.responsePayloadRaw), /fake-png/);
    }
  );
});

test("generateCreatorImages sends OpenAI frame requests through the prompt and fixed size", async () => {
  await withMockFetch(
    async (input, init) => {
      assert.match(String(input), /api\.openai\.com\/v1\/images\/generations/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-image-2");
      assert.equal(body.size, "1536x1024");
      assert.equal(body.aspectRatio, undefined);
      assert.match(body.prompt, /Frame instruction: Compose for a 16:9 wide landscape frame\./);
      assert.match(body.prompt, /A cinematic product banner/);
      return new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("wide").toString("base64") }],
          size: "1536x1024",
          quality: "medium",
          output_format: "png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    async () => {
      const result = await generateCreatorImages(
        {
          prompt: "A cinematic product banner",
          aspectRatio: "16:9",
          quality: "medium",
          outputFormat: "png",
          generationConfig: {
            provider: "openai",
            model: "gpt-image-2",
          },
        },
        {
          headers: new Headers({
            [CREATOR_OPENAI_API_KEY_HEADER]: "sk-demo",
          }),
        }
      );

      assert.equal(result.response.size, "1536x1024");
      assert.equal(result.response.aspectRatio, "16:9");
      assert.match(result.response.promptPreview, /Frame instruction: Compose for a 16:9 wide landscape frame\./);
      const requestPayloadRaw = result.llmRun?.requestPayloadRaw;
      assert.ok(requestPayloadRaw && typeof requestPayloadRaw === "object" && !Array.isArray(requestPayloadRaw));
      assert.equal((requestPayloadRaw as { aspectRatio?: unknown }).aspectRatio, "16:9");
    }
  );
});

test("generateCreatorImages normalizes Imagen predict responses", async () => {
  await withMockFetch(
    async (input, init) => {
      assert.match(String(input), /imagen-4\.0-fast-generate-001:predict/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.parameters.sampleCount, 2);
      assert.equal(body.parameters.aspectRatio, "16:9");
      return new Response(
        JSON.stringify({
          predictions: [
            { bytesBase64Encoded: Buffer.from("one").toString("base64"), mimeType: "image/png" },
            { bytesBase64Encoded: Buffer.from("two").toString("base64"), mimeType: "image/png" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    async () => {
      const result = await generateCreatorImages(
        {
          prompt: "Wide cinematic set",
          aspectRatio: "16:9",
          count: 2,
          generationConfig: {
            provider: "gemini",
            model: "imagen-4.0-fast-generate-001",
          },
        },
        {
          headers: new Headers({
            [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
          }),
        }
      );

      assert.equal(result.response.providerMode, "gemini");
      assert.equal(result.response.images.length, 2);
      assert.equal(result.llmRun?.provider, "gemini");
      assert.equal(result.llmRun?.estimatedCostUsd, 0.04);
    }
  );
});

test("generateCreatorImages normalizes Gemini native inline image parts", async () => {
  await withMockFetch(
    async (input) => {
      assert.match(String(input), /gemini-3\.1-flash-image-preview:generateContent/);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Here is an image." },
                  {
                    inlineData: {
                      data: Buffer.from("gemini-image").toString("base64"),
                      mimeType: "image/webp",
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    async () => {
      const result = await generateCreatorImages(
        {
          prompt: "Native Gemini image",
          outputFormat: "webp",
          generationConfig: {
            provider: "gemini",
            model: "gemini-3.1-flash-image-preview",
          },
        },
        {
          headers: new Headers({
            [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
          }),
        }
      );

      assert.equal(result.response.images.length, 1);
      assert.equal(result.response.images[0]?.mimeType, "image/webp");
      assert.equal(result.llmRun?.estimatedCostSource, "unavailable");
    }
  );
});

test("generateCreatorImages records provider errors", async () => {
  await withMockFetch(
    async () => new Response("quota", { status: 429 }),
    async () => {
      await assert.rejects(
        generateCreatorImages(
          {
            prompt: "A failed image",
            generationConfig: {
              provider: "openai",
              model: "gpt-image-2",
            },
          },
          {
            headers: new Headers({
              [CREATOR_OPENAI_API_KEY_HEADER]: "sk-demo",
            }),
          }
        ),
        (error) => {
          assert.ok(error instanceof CreatorAIError);
          assert.equal(error.trace?.feature, "images");
          assert.equal(error.trace?.status, "provider_error");
          assert.equal(error.trace?.errorCode, "openai_rate_limited");
          assert.deepEqual(error.details, {
            provider: "openai",
            providerStatus: 429,
            providerErrorMessage: "quota",
          });
          return true;
        }
      );
    }
  );
});

test("generateCreatorImages preserves OpenAI API error details for authentication failures", async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Incorrect API key provided: sk-demo.",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    async () => {
      await assert.rejects(
        generateCreatorImages(
          {
            prompt: "A failed image",
            generationConfig: {
              provider: "openai",
              model: "gpt-image-2",
            },
          },
          {
            headers: new Headers({
              [CREATOR_OPENAI_API_KEY_HEADER]: "sk-demo",
            }),
          }
        ),
        (error) => {
          assert.ok(error instanceof CreatorAIError);
          assert.equal(error.message, "OpenAI authentication failed. Check the API key saved in this browser.");
          assert.deepEqual(error.details, {
            provider: "openai",
            providerStatus: 401,
            providerErrorMessage: "Incorrect API key provided: sk-demo.",
            providerErrorType: "invalid_request_error",
            providerErrorCode: "invalid_api_key",
          });
          return true;
        }
      );
    }
  );
});
