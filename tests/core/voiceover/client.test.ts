import test from "node:test";
import assert from "node:assert/strict";

import { requestProjectVoiceoverAudio } from "../../../src/lib/voiceover/client";
import { VOICEOVER_GEMINI_API_KEY_HEADER, VOICEOVER_RESPONSE_HEADERS } from "../../../src/lib/voiceover/contracts";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("requestProjectVoiceoverAudio returns a File and parsed metadata", async () => {
  let capturedHeaders: HeadersInit | undefined;

  global.fetch = (async (_input, init) => {
    capturedHeaders = init?.headers;
    return new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: {
        "content-type": "audio/wav",
        "content-disposition": 'attachment; filename="voiceover.wav"',
        [VOICEOVER_RESPONSE_HEADERS.provider]: "elevenlabs",
        [VOICEOVER_RESPONSE_HEADERS.model]: "eleven_multilingual_v2",
        [VOICEOVER_RESPONSE_HEADERS.voice]: "voice_abc",
        [VOICEOVER_RESPONSE_HEADERS.format]: "wav",
        [VOICEOVER_RESPONSE_HEADERS.apiKeySource]: "voiceover_settings",
        [VOICEOVER_RESPONSE_HEADERS.maskedApiKey]: "xi-t...test",
        [VOICEOVER_RESPONSE_HEADERS.usageSource]: "provider",
        [VOICEOVER_RESPONSE_HEADERS.billedCharacters]: "321",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMin]: "321",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMax]: "321",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCostUsd]: "0.03852",
      },
    });
  }) as typeof fetch;

  const result = await requestProjectVoiceoverAudio(
    {
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "voice_abc",
      outputFormat: "wav",
    },
    { elevenLabsApiKey: "xi-test" }
  );

  assert.ok(capturedHeaders && typeof capturedHeaders === "object");
  assert.equal(result.file.name, "voiceover.wav");
  assert.equal(result.file.type, "audio/wav");
  assert.equal(result.meta.voiceId, "voice_abc");
  assert.equal(result.meta.outputFormat, "wav");
  assert.equal(result.meta.apiKeySource, "voiceover_settings");
  assert.equal(result.meta.maskedApiKey, "xi-t...test");
  assert.deepEqual(result.meta.usage, {
    source: "provider",
    billedCharacters: 321,
    estimatedCreditsMin: 321,
    estimatedCreditsMax: 321,
    estimatedCostUsd: 0.03852,
  });
  assert.deepEqual([...new Uint8Array(await result.file.arrayBuffer())], [9, 8, 7]);
});

test("requestProjectVoiceoverAudio surfaces JSON error bodies", async () => {
  global.fetch = (async () =>
    new Response(JSON.stringify({ error: "provider down" }), {
      status: 502,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

  await assert.rejects(
    requestProjectVoiceoverAudio(
      {
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_abc",
        outputFormat: "mp3",
      },
      { elevenLabsApiKey: "xi-test" }
    ),
    /provider down/
  );
});

test("requestProjectVoiceoverAudio sends Gemini keys and parses token metadata", async () => {
  let capturedHeaders: HeadersInit | undefined;

  global.fetch = (async (_input, init) => {
    capturedHeaders = init?.headers;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "audio/wav",
        [VOICEOVER_RESPONSE_HEADERS.provider]: "gemini",
        [VOICEOVER_RESPONSE_HEADERS.model]: "gemini-3.1-flash-tts-preview",
        [VOICEOVER_RESPONSE_HEADERS.voice]: "Kore",
        [VOICEOVER_RESPONSE_HEADERS.language]: "es-ES",
        [VOICEOVER_RESPONSE_HEADERS.speakerMode]: "single",
        [VOICEOVER_RESPONSE_HEADERS.format]: "wav",
        [VOICEOVER_RESPONSE_HEADERS.apiKeySource]: "voiceover_settings",
        [VOICEOVER_RESPONSE_HEADERS.usageSource]: "provider",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCostSource]: "estimated",
        [VOICEOVER_RESPONSE_HEADERS.billedCharacters]: "10",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMin]: "0",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMax]: "0",
        [VOICEOVER_RESPONSE_HEADERS.estimatedCostUsd]: "0.00101",
        [VOICEOVER_RESPONSE_HEADERS.promptTokens]: "10",
        [VOICEOVER_RESPONSE_HEADERS.completionTokens]: "50",
        [VOICEOVER_RESPONSE_HEADERS.totalTokens]: "60",
      },
    });
  }) as typeof fetch;

  const result = await requestProjectVoiceoverAudio(
    {
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "gemini",
      model: "gemini-3.1-flash-tts-preview",
      voiceId: "Kore",
      voiceName: "Kore",
      languageCode: "es-ES",
      speakerMode: "single",
      outputFormat: "wav",
    },
    { geminiApiKey: "AIza-test" }
  );

  assert.equal((capturedHeaders as Record<string, string>)[VOICEOVER_GEMINI_API_KEY_HEADER], "AIza-test");
  assert.equal(result.meta.provider, "gemini");
  assert.equal(result.meta.voiceName, "Kore");
  assert.equal(result.meta.languageCode, "es-ES");
  assert.deepEqual(result.meta.usage, {
    source: "provider",
    billedCharacters: 10,
    estimatedCreditsMin: 0,
    estimatedCreditsMax: 0,
    estimatedCostUsd: 0.00101,
    estimatedCostSource: "estimated",
    promptTokens: 10,
    completionTokens: 50,
    totalTokens: 60,
  });
});
