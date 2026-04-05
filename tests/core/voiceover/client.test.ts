import test from "node:test";
import assert from "node:assert/strict";

import { requestProjectVoiceoverAudio } from "../../../src/lib/voiceover/client";
import { VOICEOVER_RESPONSE_HEADERS } from "../../../src/lib/voiceover/contracts";

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
