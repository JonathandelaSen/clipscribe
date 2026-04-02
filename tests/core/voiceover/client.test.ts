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
