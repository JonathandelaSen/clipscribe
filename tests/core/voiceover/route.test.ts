import test from "node:test";
import assert from "node:assert/strict";

import { VOICEOVER_ELEVENLABS_API_KEY_HEADER, VOICEOVER_GEMINI_API_KEY_HEADER, VOICEOVER_RESPONSE_HEADERS } from "../../../src/lib/voiceover/contracts";
import { POST } from "../../../src/app/api/projects/voiceover/generate/route";

const originalFetch = global.fetch;
const originalElevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const originalElevenLabsApiKeyAlias = process.env.ELEVEN_LABS_API_KEY;
const originalElevenLabsApiKeyTypo = process.env.ELEVEN_LABS_APY_KEY;
const originalElevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
const originalElevenLabsVoiceIdAlias = process.env.ELEVEN_LABS_VOICE_ID;
const originalElevenLabsModel = process.env.ELEVENLABS_MODEL;
const originalElevenLabsModelAlias = process.env.ELEVEN_LABS_MODEL;
const originalElevenLabsModelTypo = process.env.EVELEN_LABS_MODEL;
const originalCreatorGeminiApiKey = process.env.CREATOR_GEMINI_API_KEY;
const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
const originalVoiceoverGeminiModel = process.env.VOICEOVER_GEMINI_MODEL;

function readHeaderValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return "";
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? "";
  }
  const normalizedName = name.toLowerCase();
  const entries = Object.entries(headers);
  const match = entries.find(([key]) => key.toLowerCase() === normalizedName);
  return typeof match?.[1] === "string" ? match[1] : "";
}

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalElevenLabsApiKey == null) {
    delete process.env.ELEVENLABS_API_KEY;
  } else {
    process.env.ELEVENLABS_API_KEY = originalElevenLabsApiKey;
  }
  if (originalElevenLabsApiKeyAlias == null) {
    delete process.env.ELEVEN_LABS_API_KEY;
  } else {
    process.env.ELEVEN_LABS_API_KEY = originalElevenLabsApiKeyAlias;
  }
  if (originalElevenLabsApiKeyTypo == null) {
    delete process.env.ELEVEN_LABS_APY_KEY;
  } else {
    process.env.ELEVEN_LABS_APY_KEY = originalElevenLabsApiKeyTypo;
  }
  if (originalElevenLabsVoiceId == null) {
    delete process.env.ELEVENLABS_VOICE_ID;
  } else {
    process.env.ELEVENLABS_VOICE_ID = originalElevenLabsVoiceId;
  }
  if (originalElevenLabsVoiceIdAlias == null) {
    delete process.env.ELEVEN_LABS_VOICE_ID;
  } else {
    process.env.ELEVEN_LABS_VOICE_ID = originalElevenLabsVoiceIdAlias;
  }
  if (originalElevenLabsModel == null) {
    delete process.env.ELEVENLABS_MODEL;
  } else {
    process.env.ELEVENLABS_MODEL = originalElevenLabsModel;
  }
  if (originalElevenLabsModelAlias == null) {
    delete process.env.ELEVEN_LABS_MODEL;
  } else {
    process.env.ELEVEN_LABS_MODEL = originalElevenLabsModelAlias;
  }
  if (originalElevenLabsModelTypo == null) {
    delete process.env.EVELEN_LABS_MODEL;
  } else {
    process.env.EVELEN_LABS_MODEL = originalElevenLabsModelTypo;
  }
  if (originalCreatorGeminiApiKey == null) {
    delete process.env.CREATOR_GEMINI_API_KEY;
  } else {
    process.env.CREATOR_GEMINI_API_KEY = originalCreatorGeminiApiKey;
  }
  if (originalGeminiApiKey == null) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalGeminiApiKey;
  }
  if (originalGoogleApiKey == null) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = originalGoogleApiKey;
  }
  if (originalVoiceoverGeminiModel == null) {
    delete process.env.VOICEOVER_GEMINI_MODEL;
  } else {
    process.env.VOICEOVER_GEMINI_MODEL = originalVoiceoverGeminiModel;
  }
});

test("voiceover route requires an ElevenLabs key when neither header nor env are set", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVEN_LABS_API_KEY;
  delete process.env.ELEVEN_LABS_APY_KEY;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "ElevenLabs API key missing. Set it in .env or override it from Voiceover settings.");
});

test("voiceover route uses ELEVENLABS_API_KEY from env when no header override is provided", async () => {
  let seenApiKey = "";
  process.env.ELEVENLABS_API_KEY = "xi-env-key";

  global.fetch = (async (_input, init) => {
    seenApiKey = readHeaderValue(init?.headers, "xi-api-key");
    return new Response(new Uint8Array([5, 6]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
    });
  }) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(seenApiKey, "xi-env-key");
});

test("voiceover route lets the request header override ELEVENLABS_API_KEY from env", async () => {
  let seenApiKey = "";
  process.env.ELEVENLABS_API_KEY = "xi-env-key";

  global.fetch = (async (_input, init) => {
    seenApiKey = readHeaderValue(init?.headers, "xi-api-key");
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
    });
  }) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [VOICEOVER_ELEVENLABS_API_KEY_HEADER]: "xi-header-key",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(seenApiKey, "xi-header-key");
});

test("voiceover route uses the Gemini header key and does not require an ElevenLabs voice ID", async () => {
  let seenApiKey = "";
  let capturedBody: unknown = null;

  global.fetch = (async (_input, init) => {
    seenApiKey = readHeaderValue(init?.headers, "x-goog-api-key");
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as unknown;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: Buffer.from([1, 0, 2, 0]).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 25,
          totalTokenCount: 29,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [VOICEOVER_GEMINI_API_KEY_HEADER]: "AIza-header-key",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "gemini",
        model: "gemini-3.1-flash-tts-preview",
        voiceName: "Kore",
        outputFormat: "wav",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(seenApiKey, "AIza-header-key");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.provider), "gemini");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.voice), "Kore");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.promptTokens), "4");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.completionTokens), "25");
  assert.deepEqual((capturedBody as { generationConfig: unknown }).generationConfig, {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Kore",
        },
      },
    },
  });
});

test("voiceover route falls back to GEMINI_API_KEY from env", async () => {
  let seenApiKey = "";
  process.env.GEMINI_API_KEY = "AIza-env-key";

  global.fetch = (async (_input, init) => {
    seenApiKey = readHeaderValue(init?.headers, "x-goog-api-key");
    return new Response(
      JSON.stringify({
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
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "gemini",
        model: "gemini-3.1-flash-tts-preview",
        voiceName: "Kore",
        outputFormat: "wav",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(seenApiKey, "AIza-env-key");
});

test("voiceover route explains when the saved Voiceover settings key is rejected", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-env-key";

  global.fetch = (async () =>
    new Response(JSON.stringify({ detail: { message: "bad key" } }), {
      status: 401,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [VOICEOVER_ELEVENLABS_API_KEY_HEADER]: "xi-header-key",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "elevenlabs_auth_error");
  assert.equal(
    body.error,
    "ElevenLabs rejected the API key saved in Voiceover settings. Clear it or replace it to fall back to .env."
  );
});

test("voiceover route explains when the .env key is rejected", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-env-key";

  global.fetch = (async () =>
    new Response(JSON.stringify({ detail: { message: "bad key" } }), {
      status: 401,
      headers: {
        "content-type": "application/json",
      },
    })) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "elevenlabs_auth_error");
  assert.equal(
    body.error,
    "ElevenLabs rejected the API key loaded from .env. Update ELEVENLABS_API_KEY and try again."
  );
});

test("voiceover route surfaces quota exceeded messages from ElevenLabs", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-env-key";

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

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.code, "elevenlabs_quota_exceeded");
  assert.equal(
    body.error,
    "This request exceeds your API key quota. You have 10 credits remaining, while 29 credits are required for this request."
  );
});

test("voiceover route surfaces payment required messages from ElevenLabs", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-env-key";

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

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 402);
  const body = await response.json();
  assert.equal(body.code, "elevenlabs_payment_required");
  assert.equal(
    body.error,
    "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice."
  );
});

test("voiceover route uses ELEVENLABS_MODEL from env when request model is omitted", async () => {
  let capturedBody = "";
  process.env.ELEVENLABS_API_KEY = "xi-env-key";
  process.env.ELEVENLABS_MODEL = "eleven_flash_v2_5";

  global.fetch = (async (_input, init) => {
    capturedBody = String(init?.body ?? "");
    return new Response(new Uint8Array([4, 3, 2, 1]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
    });
  }) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.model), "eleven_flash_v2_5");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.voice), "voice_123");
  assert.deepEqual(JSON.parse(capturedBody), {
    text: "Hola mundo",
    model_id: "eleven_flash_v2_5",
  });
});

test("voiceover route accepts legacy env aliases for api key and model", async () => {
  let capturedBody = "";
  let seenApiKey = "";
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_MODEL;
  process.env.ELEVEN_LABS_APY_KEY = "xi-legacy-key";
  process.env.EVELEN_LABS_MODEL = "eleven_v3";

  global.fetch = (async (_input, init) => {
    seenApiKey = readHeaderValue(init?.headers, "xi-api-key");
    capturedBody = String(init?.body ?? "");
    return new Response(new Uint8Array([8, 6, 7, 5]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
      },
    });
  }) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(seenApiKey, "xi-legacy-key");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.model), "eleven_v3");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.voice), "voice_123");
  assert.deepEqual(JSON.parse(capturedBody), {
    text: "Hola mundo",
    model_id: "eleven_v3",
  });
});

test("voiceover route requires an explicit voice id even if one exists in env", async () => {
  process.env.ELEVENLABS_API_KEY = "xi-env-key";
  process.env.ELEVENLABS_MODEL = "eleven_flash_v2_5";
  process.env.ELEVENLABS_VOICE_ID = "voice_from_env";

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_flash_v2_5",
        voiceId: "",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "missing_voice_id");
  assert.equal(
    body.error,
    "ElevenLabs always requires a voice ID. Paste a voice ID you can use with your plan."
  );
});

test("voiceover route returns binary audio with metadata headers", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_MODEL;
  delete process.env.ELEVENLABS_VOICE_ID;
  global.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "character-cost": "222",
      },
    })) as typeof fetch;

  const response = await POST(
    new Request("http://localhost/api/projects/voiceover/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [VOICEOVER_ELEVENLABS_API_KEY_HEADER]: "xi-test",
      },
      body: JSON.stringify({
        projectId: "project_1",
        scriptText: "Hola mundo",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice_123",
        outputFormat: "mp3",
      }),
    })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.provider), "elevenlabs");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.model), "eleven_multilingual_v2");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.voice), "voice_123");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.format), "mp3");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.apiKeySource), "voiceover_settings");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.maskedApiKey), "xi...st");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.usageSource), "provider");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.billedCharacters), "222");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMin), "222");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMax), "222");
  assert.equal(response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCostUsd), "0.02664");
  assert.match(response.headers.get("content-disposition") ?? "", /filename="/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
});
