import test from "node:test";
import assert from "node:assert/strict";

import { createVideoInfoPromptCustomizationSnapshot } from "../../../src/lib/creator/prompt-customization";
import {
  CREATOR_GEMINI_API_KEY_HEADER,
  CREATOR_OPENAI_API_KEY_HEADER,
} from "../../../src/lib/creator/user-ai-settings";
import type { CreatorVideoInfoGenerateRequest } from "../../../src/lib/creator/types";
import { CreatorAIError } from "../../../src/lib/server/creator/shared/errors";
import { normalizeVideoInfoGenerateRequest } from "../../../src/lib/server/creator/shared/request-normalizers";
import { mapVideoInfoLlmResponse } from "../../../src/lib/server/creator/video-info/mapper";
import { generateCreatorVideoInfo } from "../../../src/lib/server/creator/video-info/service";
import {
  buildCollapsedVideoInfoPromptPreview,
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
  generationConfig: {
    provider: "openai",
    model: "gpt-4.1-mini",
  },
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

test("buildVideoInfoPrompt tells short publish metadata to use short transcript as focus and full transcript as context", () => {
  const prompt = buildVideoInfoPrompt({
    ...baseRequest,
    metadataTarget: "youtube_short_publish",
    videoInfoBlocks: ["titleIdeas", "description", "hashtags"],
    transcriptText: "This exact short moment needs a title.",
    transcriptChunks: [{ text: "This exact short moment needs a title.", timestamp: [10, 15] }],
    focusedTranscriptText: "This exact short moment needs a title.",
    focusedTranscriptChunks: [{ text: "This exact short moment needs a title.", timestamp: [10, 15] }],
    contextTranscriptText: "The full video explains the speaker and setup before the short moment.",
    contextTranscriptChunks: [
      { text: "The full video explains the speaker and setup before the short moment.", timestamp: [0, 20] },
    ],
  });

  assert.match(prompt, /Short transcript:/);
  assert.match(prompt, /Full video context transcript:/);
  assert.match(prompt, /Describe the Short being published, not the full source video/i);
  assert.match(prompt, /Use the full video context only/i);
  assert.match(prompt, /This exact short moment needs a title/);
  assert.match(prompt, /full video explains the speaker/i);
});

test("buildCollapsedVideoInfoPromptPreview keeps the transcript in the accordion payload only", () => {
  const prompt = buildVideoInfoPrompt(baseRequest);
  const preview = buildCollapsedVideoInfoPromptPreview(prompt);

  assert.match(preview.displayText, /\n\.\.\.\nTranscript:\n\[see Transcript accordion below\]$/);
  assert.doesNotMatch(preview.displayText, /\[0:00-0:06\]/);
  assert.match(preview.transcriptText, /\[0:00-0:06\] This is the opening hook\./);
});

test("mapVideoInfoLlmResponse returns the expected video info payload", () => {
  const result = mapVideoInfoLlmResponse(baseRequest, videoInfoModelResponse, "openai", "test-model");

  assert.equal(result.providerMode, "openai");
  assert.equal(result.youtube.titleIdeas[0], "The creator workflow that actually scales");
  assert.equal(result.content.videoSummary, "A concise summary.");
  assert.equal(result.chapters[0]?.label, "Intro");
});

test("mapVideoInfoLlmResponse rejects a non-object payload", () => {
  assert.throws(
    () => mapVideoInfoLlmResponse(baseRequest, "bad", "openai", "test-model"),
    /non-object JSON payload/i
  );
});

test("generateCreatorVideoInfo surfaces provider authentication errors", async () => {
  const originalProvider = process.env.CREATOR_VIDEO_INFO_PROVIDER;
  const originalModel = process.env.CREATOR_VIDEO_INFO_MODEL;
  process.env.CREATOR_VIDEO_INFO_PROVIDER = "openai";
  process.env.CREATOR_VIDEO_INFO_MODEL = "gpt-4.1-mini";
  try {
    await withMockFetch(
      async () => new Response("bad api key", { status: 401 }),
      async () => {
        await assert.rejects(
          generateCreatorVideoInfo(baseRequest, {
            headers: new Headers({
              [CREATOR_OPENAI_API_KEY_HEADER]: "sk-proj-invalid",
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
    process.env.CREATOR_VIDEO_INFO_PROVIDER = originalProvider;
    process.env.CREATOR_VIDEO_INFO_MODEL = originalModel;
  }
});

test("generateCreatorVideoInfo returns packaging results and uses the video info-only prompt", async () => {
  const originalProvider = process.env.CREATOR_VIDEO_INFO_PROVIDER;
  const originalModel = process.env.CREATOR_VIDEO_INFO_MODEL;
  process.env.CREATOR_VIDEO_INFO_PROVIDER = "openai";
  process.env.CREATOR_VIDEO_INFO_MODEL = "gpt-4.1-mini";
  try {
    await withMockFetch(
      async (_, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          model?: string;
          messages?: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
        assert.equal(body.model, "gpt-4.1-mini");
        assert.match(userMessage, /youtube\.titleIdeas/i);
        assert.match(userMessage, /Only include the requested keys/i);
        assert.doesNotMatch(userMessage, /shortsPlans/i);

        return new Response(
          JSON.stringify({
            usage: {
              prompt_tokens: 150,
              completion_tokens: 60,
              total_tokens: 210,
            },
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
        const payload = await generateCreatorVideoInfo(baseRequest, {
          headers: new Headers({
            [CREATOR_OPENAI_API_KEY_HEADER]: "sk-proj-demo",
          }),
        });

        assert.equal(payload.response.providerMode, "openai");
        assert.equal(payload.response.model, "gpt-4.1-mini");
        assert.equal(payload.response.youtube.titleIdeas[0], "The creator workflow that actually scales");
        assert.equal(payload.llmRun?.status, "success");
        assert.equal(payload.llmRun?.feature, "video_info");
        assert.equal(payload.llmRun?.provider, "openai");
        assert.equal(payload.llmRun?.promptVersion, CREATOR_VIDEO_INFO_PROMPT_VERSION);
        assert.equal(payload.llmRun?.estimatedCostSource, "estimated");
      }
    );
  } finally {
    process.env.CREATOR_VIDEO_INFO_PROVIDER = originalProvider;
    process.env.CREATOR_VIDEO_INFO_MODEL = originalModel;
  }
});

test("generateCreatorVideoInfo supports Gemini and preserves provider traces", async () => {
  const originalProvider = process.env.CREATOR_VIDEO_INFO_PROVIDER;
  const originalModel = process.env.CREATOR_VIDEO_INFO_MODEL;
  process.env.CREATOR_VIDEO_INFO_PROVIDER = "gemini";
  process.env.CREATOR_VIDEO_INFO_MODEL = "gemini-2.5-flash";
  try {
    await withMockFetch(
      async (input, init) => {
        assert.match(String(input), /generativelanguage\.googleapis\.com/);
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          model?: string;
          messages?: Array<{ role: string; content: string }>;
        };
        const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
        assert.equal(body.model, "gemini-2.5-flash");
        assert.match(userMessage, /youtube\.titleIdeas/i);
        assert.doesNotMatch(userMessage, /shortsPlans/i);

        return new Response(
          JSON.stringify({
            usage: {
              prompt_tokens: 120,
              completion_tokens: 40,
              total_tokens: 160,
            },
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
        const payload = await generateCreatorVideoInfo(
          {
            ...baseRequest,
            generationConfig: {
              provider: "gemini",
              model: "gemini-2.5-flash",
            },
          },
          {
            headers: new Headers({
              [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
            }),
          }
        );

        assert.equal(payload.response.providerMode, "gemini");
        assert.equal(payload.response.model, "gemini-2.5-flash");
        assert.equal(payload.llmRun?.provider, "gemini");
        assert.equal(payload.llmRun?.model, "gemini-2.5-flash");
        assert.equal(payload.llmRun?.promptVersion, CREATOR_VIDEO_INFO_PROMPT_VERSION);
        assert.equal(payload.llmRun?.estimatedCostSource, "estimated");
      }
    );
  } finally {
    process.env.CREATOR_VIDEO_INFO_PROVIDER = originalProvider;
    process.env.CREATOR_VIDEO_INFO_MODEL = originalModel;
  }
});
