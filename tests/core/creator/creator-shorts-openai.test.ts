import test from "node:test";
import assert from "node:assert/strict";

import { CREATOR_GEMINI_API_KEY_HEADER } from "../../../src/lib/creator/user-ai-settings";
import type { CreatorShortsGenerateRequest } from "../../../src/lib/creator/types";
import { resolveCreatorProviderApiKey } from "../../../src/lib/server/creator/shared/api-key";
import { CreatorAIError } from "../../../src/lib/server/creator/shared/errors";
import { normalizeShortsGenerateRequest } from "../../../src/lib/server/creator/shared/request-normalizers";
import { mapShortsLlmResponse } from "../../../src/lib/server/creator/shorts/mapper";
import { generateCreatorShorts } from "../../../src/lib/server/creator/shorts/service";
import { buildShortsPrompt, CREATOR_SHORTS_PROMPT_VERSION } from "../../../src/lib/server/creator/shorts/prompt";

const baseRequest: CreatorShortsGenerateRequest = {
  transcriptText:
    "This is the opening hook. Here is the interesting lesson. The punchline lands at the end of the section.",
  transcriptChunks: [
    { text: "This is the opening hook.", timestamp: [0, 6] },
    { text: "Here is the interesting lesson.", timestamp: [6, 18] },
    { text: "The punchline lands at the end of the section.", timestamp: [18, 32] },
  ],
  subtitleChunks: [
    { text: "This is the opening hook.", timestamp: [0, 6] },
    { text: "Here is the interesting lesson.", timestamp: [6, 18] },
    { text: "The punchline lands at the end of the section.", timestamp: [18, 32] },
  ],
  niche: "creator tools / workflow",
  audience: "content creators",
  tone: "sharp, practical, growth-oriented",
  generationConfig: {
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
};

const shortsModelResponse = {
  shorts: [
    {
      id: "short_1",
      startSeconds: 0,
      endSeconds: 24,
      score: 94,
      title: "YouTube cut",
      reason: "It opens with a strong promise and resolves with a clear takeaway.",
      caption: "Opening hook to payoff. #shorts",
      openingText: "Opening hook",
      endCardText: "Follow for more",
    },
    {
      id: "short_2",
      startSeconds: 0,
      endSeconds: 24,
      score: 90,
      title: "TikTok cut",
      reason: "Same clip window, alternate packaging for a more suspenseful opener.",
      caption: "One tight idea, one clean payoff.",
      openingText: "Wait for the payoff",
      endCardText: "Part 2 next",
    },
  ],
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

test("normalizeShortsGenerateRequest strips video info-only fields", () => {
  const normalized = normalizeShortsGenerateRequest({
    ...baseRequest,
    videoInfoBlocks: ["titleIdeas"],
  } as CreatorShortsGenerateRequest & { videoInfoBlocks: string[] });

  assert.equal("videoInfoBlocks" in normalized, false);
});

test("buildShortsPrompt contains clip instructions and excludes video info packaging fields", () => {
  const prompt = buildShortsPrompt(baseRequest);

  assert.match(prompt, /"shorts"/i);
  assert.match(prompt, /must be JSON numbers measured in absolute seconds/i);
  assert.match(prompt, /Never use mm:ss/i);
  assert.match(prompt, /startSeconds: 364 and endSeconds: 391/i);
  assert.doesNotMatch(prompt, /viralClips/i);
  assert.doesNotMatch(prompt, /shortsPlans/i);
  assert.doesNotMatch(prompt, /youtube\.titleIdeas/i);
  assert.doesNotMatch(prompt, /copy-ready packaging/i);
  assert.doesNotMatch(prompt, /Allowed platforms/i);
  assert.doesNotMatch(prompt, /subtitleStyle/i);
  assert.doesNotMatch(prompt, /insights/i);
});

test("mapShortsLlmResponse returns ranked clips and plans from model JSON", () => {
  const result = mapShortsLlmResponse(baseRequest, shortsModelResponse, "gemini", "test-model");

  assert.equal(result.providerMode, "gemini");
  assert.equal(result.model, "test-model");
  assert.equal(result.shorts?.length, 2);
  assert.equal(result.viralClips[0]?.sourceChunkIndexes.join(","), "0,1,2");
  assert.equal(result.shortsPlans.length, 2);
  assert.equal(result.shortsPlans[0]?.clipId, "short_1");
});

test("mapShortsLlmResponse rejects clips outside source bounds", () => {
  assert.throws(
    () =>
      mapShortsLlmResponse(
        baseRequest,
        {
          ...shortsModelResponse,
          shorts: [
            {
              ...shortsModelResponse.shorts[0],
              endSeconds: 90,
            },
          ],
        },
        "gemini",
        "test-model"
      ),
    /outside the source bounds/i
  );
});

test("resolveCreatorProviderApiKey rejects requests without the Gemini key header", () => {
  assert.throws(
    () =>
      resolveCreatorProviderApiKey(
        new Headers({
          "Content-Type": "application/json",
        }),
        "gemini"
      ),
    /Gemini API key missing/i
  );
});

test("resolveCreatorProviderApiKey returns the Gemini user key header", () => {
  assert.deepEqual(
    resolveCreatorProviderApiKey(
      new Headers({
        [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
      }),
      "gemini"
    ),
    {
      apiKey: "AIza-demo",
      apiKeySource: "header",
    }
  );
});

test("generateCreatorShorts surfaces Gemini authentication errors", async () => {
  const originalProvider = process.env.CREATOR_SHORTS_PROVIDER;
  const originalModel = process.env.CREATOR_SHORTS_MODEL;
  process.env.CREATOR_SHORTS_PROVIDER = "gemini";
  process.env.CREATOR_SHORTS_MODEL = "gemini-2.5-flash";
  try {
    await withMockFetch(
      async () => new Response("bad api key", { status: 401 }),
      async () => {
        await assert.rejects(
          generateCreatorShorts(baseRequest, {
            headers: new Headers({
              [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-invalid",
            }),
          }),
          (error) => {
            assert.ok(error instanceof CreatorAIError);
            assert.equal(error.status, 401);
            assert.match(error.message, /authentication failed/i);
            return true;
          }
        );
      }
    );
  } finally {
    process.env.CREATOR_SHORTS_PROVIDER = originalProvider;
    process.env.CREATOR_SHORTS_MODEL = originalModel;
  }
});

test("generateCreatorShorts returns clip lab results and uses the shorts-only prompt", async () => {
  const originalProvider = process.env.CREATOR_SHORTS_PROVIDER;
  const originalModel = process.env.CREATOR_SHORTS_MODEL;
  process.env.CREATOR_SHORTS_PROVIDER = "gemini";
  process.env.CREATOR_SHORTS_MODEL = "gemini-2.5-flash";
  try {
    await withMockFetch(
      async (_, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          model?: string;
          messages?: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
        assert.equal(body.model, "gemini-2.5-flash");
        assert.match(userMessage, /"shorts"/i);
        assert.doesNotMatch(userMessage, /viralClips/i);
        assert.doesNotMatch(userMessage, /youtube\.titleIdeas/i);

        return new Response(
          JSON.stringify({
            usage: {
              prompt_tokens: 120,
              completion_tokens: 80,
              total_tokens: 200,
            },
            choices: [
              {
                message: {
                  content: JSON.stringify(shortsModelResponse),
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
        );
      },
      async () => {
        const payload = await generateCreatorShorts(baseRequest, {
          headers: new Headers({
            [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
          }),
        });

        assert.equal(payload.response.providerMode, "gemini");
        assert.equal(payload.response.model, "gemini-2.5-flash");
        assert.equal(payload.response.shorts?.length, 2);
        assert.deepEqual(payload.response.viralClips[0]?.sourceChunkIndexes, [0, 1, 2]);
        assert.equal(payload.response.shortsPlans[0]?.clipId, "short_1");
        assert.equal(payload.llmRun?.status, "success");
        assert.equal(payload.llmRun?.feature, "shorts");
        assert.equal(payload.llmRun?.provider, "gemini");
        assert.equal(payload.llmRun?.model, "gemini-2.5-flash");
        assert.equal(payload.llmRun?.promptVersion, CREATOR_SHORTS_PROMPT_VERSION);
        assert.equal(payload.llmRun?.inputSummary.niche, baseRequest.niche);
        assert.equal(payload.llmRun?.apiKeySource, "header");
        assert.equal(payload.llmRun?.estimatedCostSource, "estimated");
      }
    );
  } finally {
    process.env.CREATOR_SHORTS_PROVIDER = originalProvider;
    process.env.CREATOR_SHORTS_MODEL = originalModel;
  }
});
