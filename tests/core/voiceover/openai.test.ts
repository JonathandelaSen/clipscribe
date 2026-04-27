import test from "node:test";
import assert from "node:assert/strict";

import { openAIVoiceoverAdapter } from "../../../src/lib/server/voiceover/openai";
import { VoiceoverError } from "../../../src/lib/server/voiceover/errors";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("openAIVoiceoverAdapter sends speed to the speech endpoint", async () => {
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedBody: unknown = null;

  global.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedAuth = init?.headers && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
      ? String(init.headers.Authorization ?? "")
      : "";
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
    });
  }) as typeof fetch;

  const result = await openAIVoiceoverAdapter.generate({
    projectId: "project_1",
    scriptText: "Hola mundo",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voiceId: "coral",
    voiceName: "coral",
    speed: 1.25,
    outputFormat: "mp3",
    apiKey: "sk-test",
    apiKeySource: "voiceover_settings",
  });

  assert.equal(capturedUrl, "https://api.openai.com/v1/audio/speech");
  assert.equal(capturedAuth, "Bearer sk-test");
  assert.deepEqual(capturedBody, {
    model: "gpt-4o-mini-tts",
    input: "Hola mundo",
    voice: "coral",
    response_format: "mp3",
    speed: 1.25,
  });
  assert.equal(result.provider, "openai");
  assert.equal(result.voiceName, "coral");
  assert.equal(result.speed, 1.25);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.deepEqual(result.usage, {
    billedCharacters: 10,
    source: "estimated",
    estimatedCostUsd: null,
    estimatedCostSource: "unavailable",
    estimatedCreditsMin: 0,
    estimatedCreditsMax: 0,
  });
});

test("openAIVoiceoverAdapter clamps speed and maps provider failures", async () => {
  let capturedBody: unknown = null;

  global.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "audio/wav",
      },
    });
  }) as typeof fetch;

  await openAIVoiceoverAdapter.generate({
    projectId: "project_1",
    scriptText: "Hola",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voiceId: "",
    voiceName: "coral",
    speed: 9,
    outputFormat: "wav",
    apiKey: "sk-test",
    apiKeySource: "env",
  });

  assert.equal((capturedBody as { speed: number }).speed, 4);

  global.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "bad key" } }), {
      status: 401,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

  await assert.rejects(
    openAIVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "coral",
      voiceName: "coral",
      outputFormat: "mp3",
      apiKey: "bad-key",
      apiKeySource: "env",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "openai_auth_error");
      return true;
    }
  );
});
