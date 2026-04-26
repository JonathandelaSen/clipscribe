import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreatorTextProviderHeaders,
  clearCreatorAISettings,
  maskElevenLabsApiKey,
  maskGeminiApiKey,
  maskOpenAIApiKey,
  readCreatorAISettings,
  writeCreatorAISettings,
} from "../../../src/lib/creator/user-ai-settings";

function createStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("writeCreatorAISettings persists trimmed provider keys and feature settings", () => {
  const storage = createStorage();

  const saved = writeCreatorAISettings(storage, {
    openAIApiKey: "  sk-proj-1234567890  ",
    geminiApiKey: "  AIza-demo-1234567890  ",
    featureSettings: {
      shorts: {
        provider: "gemini",
        model: "gemini-2.5-flash",
      },
    },
  });
  const loaded = readCreatorAISettings(storage);

  assert.equal(saved.credentials.openAIApiKey, "sk-proj-1234567890");
  assert.equal(saved.credentials.geminiApiKey, "AIza-demo-1234567890");
  assert.equal(saved.featureSettings?.shorts?.provider, "gemini");
  assert.equal(saved.featureSettings?.shorts?.model, "gemini-2.5-flash");
  assert.ok(typeof saved.updatedAt === "number");
  assert.equal(loaded?.credentials.openAIApiKey, "sk-proj-1234567890");
  assert.equal(loaded?.credentials.geminiApiKey, "AIza-demo-1234567890");
});

test("writeCreatorAISettings persists a trimmed ElevenLabs key", () => {
  const storage = createStorage();

  const saved = writeCreatorAISettings(storage, { elevenLabsApiKey: "  xi-1234567890  " });
  const loaded = readCreatorAISettings(storage);

  assert.equal(saved.credentials.elevenLabsApiKey, "xi-1234567890");
  assert.equal(loaded?.credentials.elevenLabsApiKey, "xi-1234567890");
});

test("readCreatorAISettings keeps prompt profiles even without an API key", () => {
  const storage = createStorage();

  writeCreatorAISettings(storage, {
    promptProfiles: {
      video_info: {
        globalInstructions: "Add a short CTA.",
        fieldInstructions: {
          description: "Mention the blog post.",
        },
      },
    },
  });

  const loaded = readCreatorAISettings(storage);
  assert.equal(loaded?.credentials.openAIApiKey, "");
  assert.equal(loaded?.promptProfiles?.video_info?.globalInstructions, "Add a short CTA.");
  assert.equal(
    loaded?.promptProfiles?.video_info?.fieldInstructions?.description,
    "Mention the blog post."
  );
});

test("readCreatorAISettings persists image feature settings and prompt profile", () => {
  const storage = createStorage();

  writeCreatorAISettings(storage, {
    featureSettings: {
      images: {
        provider: "openai",
        model: "gpt-image-2",
      },
    },
    promptProfiles: {
      images: {
        globalInstructions: "Use product photography lighting.",
        slotOverrides: {
          style: {
            mode: "replace",
            value: "Minimal studio background.",
          },
        },
      },
    },
  });

  const loaded = readCreatorAISettings(storage);
  assert.equal(loaded?.featureSettings?.images?.provider, "openai");
  assert.equal(loaded?.featureSettings?.images?.model, "gpt-image-2");
  assert.equal(loaded?.promptProfiles?.images?.globalInstructions, "Use product photography lighting.");
  assert.equal(loaded?.promptProfiles?.images?.slotOverrides?.style?.mode, "replace");
});

test("readCreatorAISettings accepts legacy payloads without prompt profiles", () => {
  const storage = createStorage();

  storage.setItem(
    "clipscribe.creator-ai-settings.v1",
    JSON.stringify({
      openAIApiKey: "sk-proj-legacy",
      updatedAt: 123,
    })
  );

  const loaded = readCreatorAISettings(storage);
  assert.equal(loaded?.credentials.openAIApiKey, "sk-proj-legacy");
  assert.equal(loaded?.promptProfiles, undefined);
});

test("clearCreatorAISettings removes persisted settings", () => {
  const storage = createStorage();

  writeCreatorAISettings(storage, { openAIApiKey: "sk-proj-1234567890" });
  clearCreatorAISettings(storage);

  assert.equal(readCreatorAISettings(storage), null);
});

test("buildCreatorTextProviderHeaders includes only provided keys", () => {
  const headers = buildCreatorTextProviderHeaders({
    openAIApiKey: "sk-demo",
    geminiApiKey: "",
  }) as Record<string, string>;

  assert.deepEqual(headers, {
    "x-creator-openai-api-key": "sk-demo",
  });
});

test("maskOpenAIApiKey keeps only a short prefix and suffix", () => {
  assert.equal(maskOpenAIApiKey("sk-proj-1234567890"), "sk-proj...7890");
});

test("maskGeminiApiKey keeps only a short prefix and suffix", () => {
  assert.equal(maskGeminiApiKey("AIza-demo-1234567890"), "AIza-de...7890");
});

test("maskElevenLabsApiKey keeps only a short prefix and suffix", () => {
  assert.equal(maskElevenLabsApiKey("xi-1234567890"), "xi-1234...7890");
});
