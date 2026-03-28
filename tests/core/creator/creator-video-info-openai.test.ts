import test from "node:test";
import assert from "node:assert/strict";

import { createVideoInfoPromptCustomizationSnapshot } from "../../../src/lib/creator/prompt-customization";
import type { CreatorVideoInfoGenerateRequest } from "../../../src/lib/creator/types";
import { CreatorAIError } from "../../../src/lib/server/creator/shared/errors";
import { normalizeVideoInfoGenerateRequest } from "../../../src/lib/server/creator/shared/request-normalizers";
import { mapVideoInfoOpenAIResponse } from "../../../src/lib/server/creator/video-info/mapper";
import { generateVideoInfoWithOpenAI } from "../../../src/lib/server/creator/video-info/openai";
import {
  buildVideoInfoPrompt,
  CREATOR_VIDEO_INFO_PROMPT_VERSION,
} from "../../../src/lib/server/creator/video-info/prompt";

const baseRequest: CreatorVideoInfoGenerateRequest = {
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
  videoInfoBlocks: ["titleIdeas", "description", "chapters", "contentPack", "insights"],
};

const videoInfoModelResponse = {
  youtube: {
    titleIdeas: ["The creator workflow that actually scales"],
    description: "A copy-ready description.",
    pinnedComment: "What would you repurpose first?",
    hashtags: ["#creator", "#workflow"],
    thumbnailHooks: ["Stop wasting time"],
    chapterText: "0:00 Intro\n0:18 Key lesson",
  },
  content: {
    videoSummary: "A concise summary.",
    keyMoments: ["0:00 Hook", "0:18 Lesson"],
    hookIdeas: ["The one workflow change I would make first."],
    ctaIdeas: ["Comment your bottleneck."],
    repurposeIdeas: ["Turn the lesson into a short thread."],
  },
  chapters: [
    {
      timeSeconds: 0,
      label: "Intro",
      reason: "Opening setup",
    },
  ],
  insights: {
    transcriptWordCount: 20,
    estimatedSpeakingRateWpm: 38,
    repeatedTerms: ["workflow"],
    detectedTheme: "Creator systems",
    recommendedPrimaryPlatform: "youtube_shorts",
  },
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

test("normalizeVideoInfoGenerateRequest strips shorts-only fields", () => {
  const normalized = normalizeVideoInfoGenerateRequest({
    ...baseRequest,
    tool: "clip_lab",
    viralClips: [{ id: "clip_1" }],
    shortsPlans: [{ clipId: "clip_1" }],
  } as CreatorVideoInfoGenerateRequest & {
    tool: string;
    viralClips: Array<{ id: string }>;
    shortsPlans: Array<{ clipId: string }>;
  });

  assert.equal("tool" in normalized, false);
  assert.equal("viralClips" in normalized, false);
  assert.equal("shortsPlans" in normalized, false);
});

test("normalizeVideoInfoGenerateRequest sanitizes prompt customization snapshots", () => {
  const normalized = normalizeVideoInfoGenerateRequest({
    ...baseRequest,
    promptCustomization: {
      mode: "run_override",
      effectiveProfile: {
        slotOverrides: {
          persona: { mode: "replace", value: "  Custom persona.  " },
        },
        fieldInstructions: {
          titleIdeas: "  Use emojis sometimes.  ",
        },
      },
      hash: "ignored",
      editedSections: ["ignored"],
    },
  });

  assert.equal(normalized.promptCustomization?.mode, "run_override");
  assert.equal(
    normalized.promptCustomization?.effectiveProfile.slotOverrides?.persona?.value,
    "Custom persona."
  );
  assert.deepEqual(normalized.promptCustomization?.editedSections, ["base:persona", "field:titleIdeas"]);
});

test("buildVideoInfoPrompt contains packaging fields and excludes shorts instructions", () => {
  const prompt = buildVideoInfoPrompt(baseRequest);

  assert.match(prompt, /youtube\.titleIdeas/i);
  assert.match(prompt, /copy-ready packaging/i);
  assert.doesNotMatch(prompt, /shortsPlans/i);
  assert.doesNotMatch(prompt, /viralClips/i);
});

test("buildVideoInfoPrompt only requires the selected fields", () => {
  const prompt = buildVideoInfoPrompt({
    ...baseRequest,
    videoInfoBlocks: ["titleIdeas", "description"],
  });

  assert.match(prompt, /youtube\.titleIdeas/i);
  assert.match(prompt, /youtube\.description/i);
  assert.match(prompt, /Only include the requested keys/i);
  assert.doesNotMatch(prompt, /"pinnedComment"/i);
  assert.doesNotMatch(prompt, /"hashtags"/i);
  assert.doesNotMatch(prompt, /"thumbnailHooks"/i);
  assert.doesNotMatch(prompt, /"chapters"/i);
  assert.doesNotMatch(prompt, /"insights"/i);
  assert.doesNotMatch(prompt, /"content"/i);
});

test("buildVideoInfoPrompt applies prompt customization layers and field instructions", () => {
  const prompt = buildVideoInfoPrompt({
    ...baseRequest,
    videoInfoBlocks: ["titleIdeas", "description", "chapters"],
    promptCustomization: createVideoInfoPromptCustomizationSnapshot({
      globalProfile: {
        globalInstructions: "Always keep the wording creator-native.",
      },
      runProfile: {
        slotOverrides: {
          persona: { mode: "replace", value: "You are a bold YouTube growth strategist." },
        },
        fieldInstructions: {
          titleIdeas: "Use emojis only when they sharpen the hook.",
        },
      },
    }),
  });

  assert.match(prompt, /bold YouTube growth strategist/i);
  assert.match(prompt, /Always keep the wording creator-native/i);
  assert.match(prompt, /titleIdeas: Use emojis only when they sharpen the hook/i);
  assert.match(prompt, /chapters: Use concrete timestamps for chapters/i);
});

test("mapVideoInfoOpenAIResponse returns the expected video info payload", () => {
  const result = mapVideoInfoOpenAIResponse(baseRequest, videoInfoModelResponse, "test-model");

  assert.equal(result.providerMode, "openai");
  assert.equal(result.youtube.titleIdeas[0], "The creator workflow that actually scales");
  assert.equal(result.content.videoSummary, "A concise summary.");
  assert.equal(result.chapters[0]?.label, "Intro");
});

test("mapVideoInfoOpenAIResponse rejects a non-object payload", () => {
  assert.throws(
    () => mapVideoInfoOpenAIResponse(baseRequest, "bad", "test-model"),
    /non-object JSON payload/i
  );
});

test("generateVideoInfoWithOpenAI surfaces provider authentication errors", async () => {
  const originalModel = process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL;
  process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL = "test-model";
  try {
    await withMockFetch(
      async () => new Response("bad api key", { status: 401 }),
      async () => {
        await assert.rejects(
          generateVideoInfoWithOpenAI({
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
    process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL = originalModel;
  }
});

test("generateVideoInfoWithOpenAI returns packaging results and uses the video info-only prompt", async () => {
  const originalModel = process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL;
  process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL = "test-model";
  try {
    await withMockFetch(
      async (_, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
        assert.match(userMessage, /youtube\.titleIdeas/i);
        assert.match(userMessage, /Only include the requested keys/i);
        assert.doesNotMatch(userMessage, /shortsPlans/i);

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(videoInfoModelResponse),
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
        const payload = await generateVideoInfoWithOpenAI({
          request: baseRequest,
          apiKey: "sk-proj-demo",
        });

        assert.equal(payload.response.providerMode, "openai");
        assert.match(payload.response.model, /user key/i);
        assert.equal(payload.response.youtube.titleIdeas[0], "The creator workflow that actually scales");
        assert.equal(payload.response.chapters[0]?.label, "Intro");
        assert.equal(payload.llmRun?.status, "success");
        assert.equal(payload.llmRun?.feature, "video_info");
        assert.equal(payload.llmRun?.promptVersion, CREATOR_VIDEO_INFO_PROMPT_VERSION);
        assert.deepEqual(payload.llmRun?.inputSummary.videoInfoBlocks, baseRequest.videoInfoBlocks);
        assert.equal(payload.llmRun?.inputSummary.promptCustomizationMode, "default");
      }
    );
  } finally {
    process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL = originalModel;
  }
});

test("generateVideoInfoWithOpenAI traces prompt customization metadata", async () => {
  const originalModel = process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL;
  process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL = "test-model";
  try {
    await withMockFetch(
      async (_, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
        assert.match(userMessage, /Use emojis sometimes/i);

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(videoInfoModelResponse),
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
        const promptCustomization = createVideoInfoPromptCustomizationSnapshot({
          globalProfile: {
            fieldInstructions: {
              titleIdeas: "Use emojis sometimes.",
            },
          },
        });
        const payload = await generateVideoInfoWithOpenAI({
          request: {
            ...baseRequest,
            promptCustomization,
          },
          apiKey: "sk-proj-demo",
        });

        assert.equal(payload.llmRun?.inputSummary.promptCustomizationMode, "global_customized");
        assert.equal(payload.llmRun?.inputSummary.promptCustomizationHash, promptCustomization?.hash);
        assert.deepEqual(payload.llmRun?.inputSummary.promptEditedSections, ["field:titleIdeas"]);
      }
    );
  } finally {
    process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL = originalModel;
  }
});
