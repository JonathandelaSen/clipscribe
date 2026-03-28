import test from "node:test";
import assert from "node:assert/strict";

import {
  clearCreatorAISettings,
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

test("writeCreatorAISettings persists a trimmed OpenAI key", () => {
  const storage = createStorage();

  const saved = writeCreatorAISettings(storage, { openAIApiKey: "  sk-proj-1234567890  " });
  const loaded = readCreatorAISettings(storage);

  assert.equal(saved.openAIApiKey, "sk-proj-1234567890");
  assert.ok(typeof saved.updatedAt === "number");
  assert.equal(loaded?.openAIApiKey, "sk-proj-1234567890");
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
  assert.equal(loaded?.openAIApiKey, "");
  assert.equal(loaded?.promptProfiles?.video_info?.globalInstructions, "Add a short CTA.");
  assert.equal(
    loaded?.promptProfiles?.video_info?.fieldInstructions?.description,
    "Mention the blog post."
  );
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
  assert.equal(loaded?.openAIApiKey, "sk-proj-legacy");
  assert.equal(loaded?.promptProfiles, undefined);
});

test("clearCreatorAISettings removes persisted settings", () => {
  const storage = createStorage();

  writeCreatorAISettings(storage, { openAIApiKey: "sk-proj-1234567890" });
  clearCreatorAISettings(storage);

  assert.equal(readCreatorAISettings(storage), null);
});

test("maskOpenAIApiKey keeps only a short prefix and suffix", () => {
  assert.equal(maskOpenAIApiKey("sk-proj-1234567890"), "sk-proj...7890");
});
