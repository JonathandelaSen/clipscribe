import test from "node:test";
import assert from "node:assert/strict";

import { elevenLabsVoiceoverAdapter } from "../../../src/lib/server/voiceover/elevenlabs";
import { VoiceoverError } from "../../../src/lib/server/voiceover/errors";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("elevenLabsVoiceoverAdapter sends the expected request and normalizes audio metadata", async () => {
  let capturedUrl = "";
  let capturedBody = "";

  global.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? "");
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "character-cost": "456",
      },
    });
  }) as typeof fetch;

  const result = await elevenLabsVoiceoverAdapter.generate({
    projectId: "project_1",
    scriptText: "Hola mundo",
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    voiceId: "voice_123",
    outputFormat: "mp3",
    apiKey: "xi-test",
    apiKeySource: "env",
  });

  assert.match(capturedUrl, /voice_123/);
  assert.match(capturedUrl, /output_format=mp3_44100_128/);
  assert.deepEqual(JSON.parse(capturedBody), {
    text: "Hola mundo",
    model_id: "eleven_multilingual_v2",
  });
  assert.equal(result.provider, "elevenlabs");
  assert.equal(result.outputFormat, "mp3");
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.extension, "mp3");
  assert.deepEqual(result.usage, {
    billedCharacters: 456,
    source: "provider",
    estimatedCostUsd: 0.05472,
    estimatedCreditsMin: 456,
    estimatedCreditsMax: 456,
  });
  assert.deepEqual([...result.bytes], [1, 2, 3]);
});

test("elevenLabsVoiceoverAdapter falls back to an estimated usage summary when headers are missing", async () => {
  global.fetch = (async () =>
    new Response(new Uint8Array([7, 8, 9]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
    })) as typeof fetch;

  const result = await elevenLabsVoiceoverAdapter.generate({
    projectId: "project_1",
    scriptText: "Hola mundo",
    provider: "elevenlabs",
    model: "eleven_flash_v2_5",
    voiceId: "voice_123",
    outputFormat: "mp3",
    apiKey: "xi-test",
    apiKeySource: "env",
  });

  assert.deepEqual(result.usage, {
    billedCharacters: 10,
    source: "estimated",
    estimatedCostUsd: 0.0006,
    estimatedCreditsMin: 5,
    estimatedCreditsMax: 10,
  });
});

test("elevenLabsVoiceoverAdapter surfaces provider auth failures", async () => {
  global.fetch = (async () =>
    new Response(JSON.stringify({ detail: { message: "bad key" } }), {
      status: 401,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

  await assert.rejects(
    elevenLabsVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "voice_123",
      outputFormat: "wav",
      apiKey: "bad-key",
      apiKeySource: "voiceover_settings",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "elevenlabs_auth_error");
      assert.equal(
        error.message,
        "ElevenLabs rejected the API key saved in Voiceover settings. Clear it or replace it to fall back to .env."
      );
      return true;
    }
  );
});

test("elevenLabsVoiceoverAdapter surfaces quota exceeded messages", async () => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        detail: {
          status: "quota_exceeded",
          message:
            "This request exceeds your API key quota. You have 10 credits remaining, while 29 credits are required for this request.",
        },
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      }
    )) as typeof fetch;

  await assert.rejects(
    elevenLabsVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "voice_123",
      outputFormat: "wav",
      apiKey: "valid-key",
      apiKeySource: "env",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "elevenlabs_quota_exceeded");
      assert.equal(
        error.message,
        "This request exceeds your API key quota. You have 10 credits remaining, while 29 credits are required for this request."
      );
      return true;
    }
  );
});

test("elevenLabsVoiceoverAdapter surfaces payment required messages", async () => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        detail: {
          message: "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.",
        },
      }),
      {
        status: 402,
        headers: {
          "content-type": "application/json",
        },
      }
    )) as typeof fetch;

  await assert.rejects(
    elevenLabsVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "voice_123",
      outputFormat: "wav",
      apiKey: "valid-key",
      apiKeySource: "env",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 402);
      assert.equal(error.code, "elevenlabs_payment_required");
      assert.equal(
        error.message,
        "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice."
      );
      return true;
    }
  );
});

test("elevenLabsVoiceoverAdapter surfaces provider access denial messages", async () => {
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        detail: {
          message: "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.",
        },
      }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      }
    )) as typeof fetch;

  await assert.rejects(
    elevenLabsVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "voice_123",
      outputFormat: "wav",
      apiKey: "valid-key",
      apiKeySource: "env",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "elevenlabs_access_denied");
      assert.equal(
        error.message,
        "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice."
      );
      return true;
    }
  );
});
