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

  const saved = writeCreatorAISettings(storage, "  sk-proj-1234567890  ");
  const loaded = readCreatorAISettings(storage);

  assert.equal(saved.openAIApiKey, "sk-proj-1234567890");
  assert.ok(typeof saved.updatedAt === "number");
  assert.equal(loaded?.openAIApiKey, "sk-proj-1234567890");
});

test("clearCreatorAISettings removes persisted settings", () => {
  const storage = createStorage();

  writeCreatorAISettings(storage, "sk-proj-1234567890");
  clearCreatorAISettings(storage);

  assert.equal(readCreatorAISettings(storage), null);
});

test("maskOpenAIApiKey keeps only a short prefix and suffix", () => {
  assert.equal(maskOpenAIApiKey("sk-proj-1234567890"), "sk-proj...7890");
});
