import test from "node:test";
import assert from "node:assert/strict";

import { CREATOR_OPENAI_API_KEY_HEADER } from "../../../src/lib/creator/user-ai-settings";
import type { CreatorShortsGenerateRequest } from "../../../src/lib/creator/types";
import { getRequiredCreatorOpenAIApiKey } from "../../../src/lib/server/creator/shared/api-key";
import { CreatorAIError } from "../../../src/lib/server/creator/shared/errors";
import { normalizeShortsGenerateRequest } from "../../../src/lib/server/creator/shared/request-normalizers";
import { mapShortsOpenAIResponse } from "../../../src/lib/server/creator/shorts/mapper";
import { generateShortsWithOpenAI } from "../../../src/lib/server/creator/shorts/openai";
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
  assert.doesNotMatch(prompt, /viralClips/i);
  assert.doesNotMatch(prompt, /shortsPlans/i);
  assert.doesNotMatch(prompt, /youtube\.titleIdeas/i);
  assert.doesNotMatch(prompt, /copy-ready packaging/i);
  assert.doesNotMatch(prompt, /Allowed platforms/i);
  assert.doesNotMatch(prompt, /subtitleStyle/i);
  assert.doesNotMatch(prompt, /insights/i);
});

test("mapShortsOpenAIResponse returns ranked clips and plans from model JSON", () => {
  const result = mapShortsOpenAIResponse(baseRequest, shortsModelResponse, "test-model");

  assert.equal(result.providerMode, "openai");
  assert.equal(result.model, "test-model");
  assert.equal(result.shorts?.length, 2);
  assert.equal(result.viralClips[0]?.sourceChunkIndexes.join(","), "0,1,2");
  assert.equal(result.shortsPlans.length, 2);
  assert.equal(result.shortsPlans[0]?.clipId, "short_1");
});

test("mapShortsOpenAIResponse rejects clips outside source bounds", () => {
  assert.throws(
    () =>
      mapShortsOpenAIResponse(
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
        "test-model"
      ),
    /outside the source bounds/i
  );
});

test("getRequiredCreatorOpenAIApiKey rejects requests without the user key header", () => {
  assert.throws(
    () =>
      getRequiredCreatorOpenAIApiKey(
        new Headers({
          "Content-Type": "application/json",
        })
      ),
    /OpenAI API key missing/i
  );
});

test("getRequiredCreatorOpenAIApiKey returns the user key header", () => {
  assert.equal(
    getRequiredCreatorOpenAIApiKey(
      new Headers({
        [CREATOR_OPENAI_API_KEY_HEADER]: "sk-proj-demo",
      })
    ),
    "sk-proj-demo"
  );
});

test("generateShortsWithOpenAI surfaces provider authentication errors", async () => {
  const originalModel = process.env.OPENAI_CREATOR_SHORTS_MODEL;
  process.env.OPENAI_CREATOR_SHORTS_MODEL = "test-model";
  try {
    await withMockFetch(
      async () => new Response("bad api key", { status: 401 }),
      async () => {
        await assert.rejects(
          generateShortsWithOpenAI({
            request: baseRequest,
            apiKey: "sk-proj-invalid",
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
    process.env.OPENAI_CREATOR_SHORTS_MODEL = originalModel;
  }
});

test("generateShortsWithOpenAI returns clip lab results and uses the shorts-only prompt", async () => {
  const originalModel = process.env.OPENAI_CREATOR_SHORTS_MODEL;
  process.env.OPENAI_CREATOR_SHORTS_MODEL = "test-model";
  try {
    await withMockFetch(
      async (_, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
        assert.match(userMessage, /"shorts"/i);
        assert.doesNotMatch(userMessage, /viralClips/i);
        assert.doesNotMatch(userMessage, /youtube\.titleIdeas/i);

        return new Response(
          JSON.stringify({
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
        const payload = await generateShortsWithOpenAI({
          request: baseRequest,
          apiKey: "sk-proj-demo",
        });

        assert.equal(payload.response.providerMode, "openai");
        assert.match(payload.response.model, /user key/i);
        assert.equal(payload.response.shorts?.length, 2);
        assert.deepEqual(payload.response.viralClips[0]?.sourceChunkIndexes, [0, 1, 2]);
        assert.equal(payload.response.shortsPlans[0]?.clipId, "short_1");
        assert.equal(payload.llmRun?.status, "success");
        assert.equal(payload.llmRun?.feature, "shorts");
        assert.equal(payload.llmRun?.promptVersion, CREATOR_SHORTS_PROMPT_VERSION);
        assert.equal(payload.llmRun?.inputSummary.niche, baseRequest.niche);
      }
    );
  } finally {
    process.env.OPENAI_CREATOR_SHORTS_MODEL = originalModel;
  }
});
