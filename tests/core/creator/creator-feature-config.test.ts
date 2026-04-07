import test from "node:test";
import assert from "node:assert/strict";

import {
  CREATOR_GEMINI_API_KEY_HEADER,
  CREATOR_OPENAI_API_KEY_HEADER,
} from "../../../src/lib/creator/user-ai-settings";
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

test("readCreatorFeatureEnvConfig defaults video_info to Gemini", () => {
  withEnv(
    {
      CREATOR_VIDEO_INFO_PROVIDER: undefined,
      CREATOR_VIDEO_INFO_MODEL: undefined,
      OPENAI_CREATOR_VIDEO_INFO_MODEL: undefined,
    },
    () => {
      const config = readCreatorFeatureEnvConfig("video_info");
      assert.equal(config.provider, "gemini");
      assert.equal(config.defaultProvider, "gemini");
      assert.deepEqual(config.allowedProviders, ["gemini", "openai"]);
      assert.equal(config.defaultModel, "gemini-2.5-flash");
    }
  );
});

test("readCreatorFeatureEnvConfig respects OpenAI override for video_info", () => {
  withEnv(
    {
      CREATOR_VIDEO_INFO_PROVIDER: "openai",
      CREATOR_VIDEO_INFO_MODEL: "gpt-4.1-mini",
    },
    () => {
      const config = readCreatorFeatureEnvConfig("video_info");
      assert.equal(config.provider, "openai");
      assert.equal(config.defaultProvider, "gemini");
      assert.deepEqual(config.allowedProviders, ["gemini", "openai"]);
      assert.equal(config.defaultModel, "gpt-4.1-mini");
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
          assert.deepEqual(config.allowedProviders, ["gemini", "openai"]);
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
          assert.deepEqual(config.allowedProviders, ["gemini", "openai"]);
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
          assert.deepEqual(config.allowedProviders, ["gemini", "openai"]);
        }
      );
    }
  );
});

test("loadCreatorTextFeatureConfig can load video_info for an explicitly requested provider", async () => {
  await withEnv(
    {
      CREATOR_VIDEO_INFO_PROVIDER: "gemini",
      CREATOR_VIDEO_INFO_MODEL: "gemini-2.5-flash",
    },
    async () => {
      await withMockFetch(
        async (_, init) => {
          const authHeader =
            init?.headers instanceof Headers
              ? init.headers.get("Authorization")
              : typeof init?.headers === "object" && init?.headers
                ? Reflect.get(init.headers, "Authorization")
                : "";
          assert.match(String(authHeader ?? ""), /Bearer sk-proj-demo/);
          return new Response(
            JSON.stringify({
              data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        },
        async () => {
          const config = await loadCreatorTextFeatureConfig(
            "video_info",
            new Headers({
              [CREATOR_OPENAI_API_KEY_HEADER]: "sk-proj-demo",
            }),
            undefined,
            "openai"
          );

          assert.equal(config.provider, "openai");
          assert.equal(config.defaultProvider, "gemini");
          assert.deepEqual(config.allowedProviders, ["gemini", "openai"]);
          assert.equal(config.defaultModel, "gpt-4.1-mini");
          assert.equal(config.apiKeySource, "header");
          assert.ok(config.models.some((model) => model.value === "gpt-4.1"));
        }
      );
    }
  );
});
