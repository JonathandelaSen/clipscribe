import test from "node:test";
import assert from "node:assert/strict";

import { geminiVoiceoverAdapter } from "../../../src/lib/server/voiceover/gemini";
import { VoiceoverError } from "../../../src/lib/server/voiceover/errors";

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

function geminiAudioResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("geminiVoiceoverAdapter sends single-speaker TTS payload and wraps PCM as WAV", async () => {
  let capturedUrl = "";
  let capturedApiKey = "";
  let capturedBody: unknown = null;
  const pcm = Buffer.from([1, 0, 2, 0]);

  global.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedApiKey = init?.headers && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
      ? String(init.headers["x-goog-api-key"] ?? "")
      : "";
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return geminiAudioResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: pcm.toString("base64"),
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 50,
        totalTokenCount: 60,
      },
    });
  }) as typeof fetch;

  const result = await geminiVoiceoverAdapter.generate({
    projectId: "project_1",
    scriptText: "Hola [whispers] mundo",
    provider: "gemini",
    model: "gemini-3.1-flash-tts-preview",
    voiceId: "Kore",
    voiceName: "Kore",
    languageCode: "es-ES",
    speakerMode: "single",
    stylePrompt: "Warm, close mic, energetic pace.",
    outputFormat: "wav",
    apiKey: "AIza-test",
    apiKeySource: "voiceover_settings",
  });

  assert.match(capturedUrl, /gemini-3\.1-flash-tts-preview:generateContent$/);
  assert.equal(capturedApiKey, "AIza-test");
  assert.deepEqual(capturedBody, {
    contents: [
      {
        parts: [
          {
            text: [
              "Synthesize speech from the transcript below. Follow the director's notes, but only speak the transcript.",
              "",
              "### DIRECTOR'S NOTES",
              "Warm, close mic, energetic pace.",
              "",
              "### TRANSCRIPT",
              "Hola [whispers] mundo",
            ].join("\n"),
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: "es-ES",
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Kore",
          },
        },
      },
    },
    model: "gemini-3.1-flash-tts-preview",
  });
  assert.equal(result.provider, "gemini");
  assert.equal(result.voiceName, "Kore");
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(Buffer.from(result.bytes.slice(0, 4)).toString("ascii"), "RIFF");
  assert.deepEqual(result.usage, {
    billedCharacters: 21,
    source: "provider",
    estimatedCostUsd: 0.00101,
    estimatedCostSource: "estimated",
    estimatedCreditsMin: 0,
    estimatedCreditsMax: 0,
    promptTokens: 10,
    completionTokens: 50,
    totalTokens: 60,
  });
});

test("geminiVoiceoverAdapter sends two-speaker voice config and advanced generation controls", async () => {
  let capturedBody: unknown = null;

  global.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return geminiAudioResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from([1, 0]).toString("base64"),
                },
              },
            ],
          },
        },
      ],
    });
  }) as typeof fetch;

  await geminiVoiceoverAdapter.generate({
    projectId: "project_1",
    scriptText: "Alex: Hey\nSam: Hi",
    provider: "gemini",
    model: "gemini-3.1-flash-tts-preview",
    voiceId: "Kore",
    voiceName: "Kore",
    speakerMode: "multi",
    speakers: [
      { speaker: "Alex", voiceName: "Kore" },
      { speaker: "Sam", voiceName: "Puck" },
    ],
    generationConfig: {
      temperature: 0.8,
      topP: 0.9,
      topK: 20,
      seed: 42,
      candidateCount: 1,
      maxOutputTokens: 2048,
      stopSequences: ["END"],
    },
    outputFormat: "wav",
    apiKey: "AIza-test",
    apiKeySource: "env",
  });

  assert.deepEqual((capturedBody as { generationConfig: unknown }).generationConfig, {
    responseModalities: ["AUDIO"],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: "Alex",
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore",
              },
            },
          },
          {
            speaker: "Sam",
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        ],
      },
    },
    temperature: 0.8,
    topP: 0.9,
    topK: 20,
    seed: 42,
    candidateCount: 1,
    maxOutputTokens: 2048,
    stopSequences: ["END"],
  });
});

test("geminiVoiceoverAdapter maps provider failures and missing audio", async () => {
  global.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "quota exhausted" } }), {
      status: 429,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

  await assert.rejects(
    geminiVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola",
      provider: "gemini",
      model: "gemini-3.1-flash-tts-preview",
      voiceId: "Kore",
      voiceName: "Kore",
      outputFormat: "wav",
      apiKey: "bad-key",
      apiKeySource: "env",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "gemini_rate_limited");
      return true;
    }
  );

  global.fetch = (async () =>
    geminiAudioResponse({
      candidates: [
        {
          content: {
            parts: [{ text: "not audio" }],
          },
        },
      ],
    })) as typeof fetch;

  await assert.rejects(
    geminiVoiceoverAdapter.generate({
      projectId: "project_1",
      scriptText: "Hola",
      provider: "gemini",
      model: "gemini-3.1-flash-tts-preview",
      voiceId: "Kore",
      voiceName: "Kore",
      outputFormat: "wav",
      apiKey: "AIza-test",
      apiKeySource: "env",
    }),
    (error: unknown) => {
      assert.ok(error instanceof VoiceoverError);
      assert.equal(error.status, 502);
      assert.equal(error.code, "gemini_audio_missing");
      return true;
    }
  );
});
