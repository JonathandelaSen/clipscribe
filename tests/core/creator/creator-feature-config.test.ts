import test from "node:test";
import assert from "node:assert/strict";

import { CREATOR_GEMINI_API_KEY_HEADER } from "../../../src/lib/creator/user-ai-settings";
import { loadCreatorTextFeatureConfig } from "../../../src/lib/server/creator/shared/feature-route-config";
import { readCreatorFeatureEnvConfig } from "../../../src/lib/server/creator/shared/feature-config";

function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> | T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

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

test("readCreatorFeatureEnvConfig defaults shorts to Gemini", () => {
  withEnv(
    {
      CREATOR_SHORTS_PROVIDER: undefined,
      CREATOR_SHORTS_MODEL: undefined,
      OPENAI_CREATOR_SHORTS_MODEL: undefined,
    },
    () => {
      const config = readCreatorFeatureEnvConfig("shorts");
      assert.equal(config.provider, "gemini");
      assert.equal(config.defaultModel, "gemini-2.5-flash");
    }
  );
});

test("readCreatorFeatureEnvConfig keeps shorts on Gemini when only legacy OpenAI model env vars exist", () => {
  withEnv(
    {
      CREATOR_SHORTS_PROVIDER: undefined,
      CREATOR_SHORTS_MODEL: undefined,
      OPENAI_CREATOR_SHORTS_MODEL: "gpt-4.1-mini",
    },
    () => {
      const config = readCreatorFeatureEnvConfig("shorts");
      assert.equal(config.provider, "gemini");
      assert.equal(config.defaultModel, "gemini-2.5-flash");
    }
  );
});

test("loadCreatorTextFeatureConfig merges provider model listing with curated fallback", async () => {
  await withEnv(
    {
      CREATOR_SHORTS_PROVIDER: "gemini",
      CREATOR_SHORTS_MODEL: "gemini-2.5-flash",
    },
    async () => {
      await withMockFetch(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ id: "gemini-2.5-flash" }, { id: "gemini-2.5-pro" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          ),
        async () => {
          const config = await loadCreatorTextFeatureConfig(
            "shorts",
            new Headers({
              [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
            })
          );

          assert.equal(config.provider, "gemini");
          assert.equal(config.defaultModel, "gemini-2.5-flash");
          assert.equal(config.modelSource, "mixed");
          assert.equal(config.hasApiKey, true);
          assert.equal(config.apiKeySource, "header");
          assert.ok(config.models.some((model) => model.value === "gemini-2.5-pro" && model.source === "provider"));
          assert.ok(config.models.some((model) => model.value === "gemini-2.5-flash-lite"));
        }
      );
    }
  );
});

test("loadCreatorTextFeatureConfig falls back to curated catalog when provider listing fails", async () => {
  await withEnv(
    {
      CREATOR_SHORTS_PROVIDER: "gemini",
      CREATOR_SHORTS_MODEL: "gemini-2.5-flash",
    },
    async () => {
      await withMockFetch(
        async () => new Response("quota", { status: 429 }),
        async () => {
          const config = await loadCreatorTextFeatureConfig(
            "shorts",
            new Headers({
              [CREATOR_GEMINI_API_KEY_HEADER]: "AIza-demo",
            })
          );

          assert.equal(config.modelSource, "catalog");
          assert.equal(config.hasApiKey, true);
          assert.equal(config.apiKeySource, "header");
          assert.ok(config.models.some((model) => model.value === "gemini-2.5-flash"));
        }
      );
    }
  );
});

test("loadCreatorTextFeatureConfig reports env-backed Gemini availability without browser headers", async () => {
  await withEnv(
    {
      CREATOR_SHORTS_PROVIDER: "gemini",
      CREATOR_SHORTS_MODEL: "gemini-2.5-flash",
      GEMINI_API_KEY: "AIza-env-demo",
    },
    async () => {
      await withMockFetch(
        async () => new Response("quota", { status: 429 }),
        async () => {
          const config = await loadCreatorTextFeatureConfig("shorts", new Headers());

          assert.equal(config.provider, "gemini");
          assert.equal(config.hasApiKey, true);
          assert.equal(config.apiKeySource, "env");
        }
      );
    }
  );
});
