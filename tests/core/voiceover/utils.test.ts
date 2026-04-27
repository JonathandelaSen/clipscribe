import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultProjectVoiceoverConfig,
  buildProjectVoiceoverDraftFromRecord,
  buildProjectVoiceoverFilename,
  buildProjectVoiceoverRecord,
  estimateVoiceoverCredits,
  estimateVoiceoverCostUsd,
  estimateVoiceoverUsage,
  ELEVENLABS_MODEL_OPTIONS,
  GEMINI_TTS_MODEL_OPTIONS,
  DEFAULT_GEMINI_TTS_VOICE,
  DEFAULT_OPENAI_TTS_SPEED,
  DEFAULT_OPENAI_TTS_VOICE,
  OPENAI_TTS_MODEL_OPTIONS,
  getProjectVoiceoverReplayStatus,
  createDefaultProjectVoiceoverDraft,
  estimateGeminiTtsCostUsd,
  extractVoiceoverTextFromFileContents,
  maskVoiceoverSecret,
  normalizeProjectVoiceoverDraft,
  normalizeOpenAITtsSpeed,
  resolveVoiceoverModelUsdPer1kChars,
  resolveVoiceoverModelSelection,
  resolveVoiceoverOutputFileInfo,
} from "../../../src/lib/voiceover/utils";

test("normalizeProjectVoiceoverDraft applies the v1 defaults", () => {
  const draft = normalizeProjectVoiceoverDraft(undefined);

  assert.equal(draft.provider, "elevenlabs");
  assert.equal(draft.model, ELEVENLABS_MODEL_OPTIONS[0]?.value);
  assert.equal(draft.outputFormat, "mp3");
  assert.equal(draft.voiceId, "");
  assert.equal(draft.voiceName, DEFAULT_GEMINI_TTS_VOICE);
  assert.equal(draft.speakerMode, "single");
  assert.equal(draft.text, "");
});

test("createDefaultProjectVoiceoverDraft keeps a stable timestamp", () => {
  const draft = createDefaultProjectVoiceoverDraft(123);
  assert.equal(draft.updatedAt, 123);
});

test("extractVoiceoverTextFromFileContents strips SRT and VTT timing metadata", () => {
  const srtText = extractVoiceoverTextFromFileContents(
    "script.srt",
    `1
00:00:00,000 --> 00:00:01,000
Hola mundo

2
00:00:01,200 --> 00:00:02,000
Seguimos aqui`
  );
  const vttText = extractVoiceoverTextFromFileContents(
    "script.vtt",
    `WEBVTT

NOTE intro
ignore this

00:00:00.000 --> 00:00:01.000
Hello there

00:00:01.500 --> 00:00:02.000
General Kenobi`
  );

  assert.equal(srtText, "Hola mundo\n\nSeguimos aqui");
  assert.equal(vttText, "Hello there\n\nGeneral Kenobi");
});

test("resolveVoiceoverOutputFileInfo and buildProjectVoiceoverFilename use the requested format", () => {
  assert.deepEqual(resolveVoiceoverOutputFileInfo("mp3"), {
    extension: "mp3",
    mimeType: "audio/mpeg",
  });
  assert.deepEqual(resolveVoiceoverOutputFileInfo("wav"), {
    extension: "wav",
    mimeType: "audio/wav",
  });

  const filename = buildProjectVoiceoverFilename({
    projectName: "My Project",
    provider: "elevenlabs",
    outputFormat: "wav",
    createdAt: Date.parse("2026-04-02T10:00:00.000Z"),
  });

  assert.match(filename, /^my-project-voiceover-elevenlabs-20260402T100000Z\.wav$/);
});

test("buildProjectVoiceoverRecord persists replay metadata and draft rehydration uses the run payload", () => {
  const record = buildProjectVoiceoverRecord({
    projectId: "project_1",
    assetId: "asset_1",
    request: {
      projectId: "project_1",
      scriptText: "Hola mundo",
      provider: "elevenlabs",
      model: "eleven_flash_v2_5",
      voiceId: "voice_123",
      outputFormat: "wav",
    },
    scriptText: "Hola mundo",
    sourceFilename: "script.md",
    apiKeySource: "voiceover_settings",
    maskedApiKey: "xi-t...test",
    createdAt: 200,
  });

  assert.equal(record.apiKeySource, "voiceover_settings");
  assert.equal(record.maskedApiKey, "xi-t...test");

  assert.deepEqual(buildProjectVoiceoverDraftFromRecord(record, 500), {
    text: "Hola mundo",
    updatedAt: 500,
    sourceFilename: "script.md",
    provider: "elevenlabs",
    model: "eleven_flash_v2_5",
    voiceId: "voice_123",
    voiceName: DEFAULT_GEMINI_TTS_VOICE,
    languageCode: undefined,
    speakerMode: "single",
    speakers: [
      { speaker: "Speaker1", voiceName: DEFAULT_GEMINI_TTS_VOICE },
      { speaker: "Speaker2", voiceName: "Puck" },
    ],
    stylePrompt: undefined,
    generationConfig: undefined,
    useDefaultVoiceId: false,
    outputFormat: "wav",
  });
});

test("resolveVoiceoverModelSelection accepts env-backed values and falls back to the first model", () => {
  assert.equal(resolveVoiceoverModelSelection("eleven_flash_v2_5"), "eleven_flash_v2_5");
  assert.equal(resolveVoiceoverModelSelection("not-a-real-model"), ELEVENLABS_MODEL_OPTIONS[0]?.value);
  assert.equal(resolveVoiceoverModelSelection("gemini-3.1-flash-tts-preview", "gemini"), "gemini-3.1-flash-tts-preview");
  assert.equal(resolveVoiceoverModelSelection("not-a-real-model", "gemini"), GEMINI_TTS_MODEL_OPTIONS[0]?.value);
  assert.equal(resolveVoiceoverModelSelection("gpt-4o-mini-tts", "openai"), "gpt-4o-mini-tts");
  assert.equal(resolveVoiceoverModelSelection("not-a-real-model", "openai"), OPENAI_TTS_MODEL_OPTIONS[0]?.value);
});

test("buildDefaultProjectVoiceoverConfig uses the requested default model when valid", () => {
  const config = buildDefaultProjectVoiceoverConfig({
    defaultModel: "eleven_turbo_v2_5",
    defaultVoiceId: "voice_env_1",
  });

  assert.equal(config.defaultModel, "eleven_turbo_v2_5");
  assert.equal(config.defaultVoiceId, "voice_env_1");
  assert.deepEqual(
    config.models.map((model) => model.value),
    ELEVENLABS_MODEL_OPTIONS.map((model) => model.value)
  );
  assert.deepEqual(
    config.providers.gemini?.models.map((model) => model.value),
    GEMINI_TTS_MODEL_OPTIONS.map((model) => model.value)
  );
  assert.deepEqual(
    config.providers.openai?.models.map((model) => model.value),
    OPENAI_TTS_MODEL_OPTIONS.map((model) => model.value)
  );
});

test("maskVoiceoverSecret keeps only the edges visible", () => {
  assert.equal(maskVoiceoverSecret("K1cfwjOyYgqN6iO4FPUh"), "K1cf...FPUh");
  assert.equal(maskVoiceoverSecret("xi-key"), "xi...ey");
});

test("getProjectVoiceoverReplayStatus flags settings-backed runs that no longer have a local key", () => {
  assert.deepEqual(
    getProjectVoiceoverReplayStatus(
      {
        apiKeySource: "voiceover_settings",
        maskedApiKey: "xi-a...999",
      },
      {
        hasLocalApiKey: false,
      }
    ),
    {
      sourceLabel: "Voiceover settings",
      maskedApiKey: "xi-a...999",
      needsLocalApiKey: true,
      readyToReplay: false,
      message: "This run used a saved local API key. Paste a key again to reproduce it.",
    }
  );

  assert.deepEqual(
    getProjectVoiceoverReplayStatus(
      {
        apiKeySource: "env",
        maskedApiKey: "xi-e...123",
      },
      {
        hasLocalApiKey: false,
      }
    ),
    {
      sourceLabel: ".env",
      maskedApiKey: "xi-e...123",
      needsLocalApiKey: false,
      readyToReplay: true,
      message: "This run used the server-side .env key.",
    }
  );
});

test("voiceover usage estimation maps model pricing and credits", () => {
  assert.equal(resolveVoiceoverModelUsdPer1kChars("eleven_flash_v2_5"), 0.06);
  assert.equal(resolveVoiceoverModelUsdPer1kChars("eleven_multilingual_v2"), 0.12);
  assert.equal(resolveVoiceoverModelUsdPer1kChars("unknown-model"), null);
  assert.equal(estimateVoiceoverCostUsd("eleven_turbo_v2_5", 1500), 0.09);
  assert.deepEqual(estimateVoiceoverCredits("eleven_flash_v2_5", 10), { min: 5, max: 10 });
  assert.deepEqual(estimateVoiceoverCredits("eleven_multilingual_v2", 10), { min: 10, max: 10 });

  assert.deepEqual(
    estimateVoiceoverUsage({
      model: "eleven_v3",
      scriptText: "hola",
    }),
    {
      billedCharacters: 4,
      source: "estimated",
      estimatedCostUsd: 0.00048,
      estimatedCreditsMin: 4,
      estimatedCreditsMax: 4,
    }
  );
  assert.equal(estimateGeminiTtsCostUsd({ promptTokens: 10, completionTokens: 50 }), 0.00101);
  assert.equal(estimateGeminiTtsCostUsd({}), null);
});

test("Gemini voiceover draft normalization preserves TTS options", () => {
  const draft = normalizeProjectVoiceoverDraft({
    provider: "gemini",
    model: "gemini-3.1-flash-tts-preview",
    text: "Alex: Hola\nSam: Que tal",
    voiceName: "Puck",
    languageCode: "es-ES",
    speakerMode: "multi",
    speakers: [
      { speaker: "Alex", voiceName: "Kore" },
      { speaker: "Sam", voiceName: "Puck" },
    ],
    stylePrompt: "Fast and bright",
    speed: 0.85,
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
  });

  assert.equal(draft.provider, "gemini");
  assert.equal(draft.model, "gemini-3.1-flash-tts-preview");
  assert.equal(draft.voiceName, "Puck");
  assert.equal(draft.languageCode, "es-ES");
  assert.equal(draft.speakerMode, "multi");
  assert.deepEqual(draft.speakers, [
    { speaker: "Alex", voiceName: "Kore" },
    { speaker: "Sam", voiceName: "Puck" },
  ]);
  assert.equal(draft.stylePrompt, "Fast and bright");
  assert.equal(draft.speed, 0.85);
  assert.deepEqual(draft.generationConfig, {
    temperature: 0.8,
    topP: 0.9,
    topK: 20,
    seed: 42,
    candidateCount: 1,
    maxOutputTokens: 2048,
    stopSequences: ["END"],
  });
});

test("OpenAI voiceover draft normalization preserves speed", () => {
  assert.equal(normalizeOpenAITtsSpeed(0.1), 0.25);
  assert.equal(normalizeOpenAITtsSpeed(9), 4);
  assert.equal(normalizeOpenAITtsSpeed("1.25"), 1.25);

  const draft = normalizeProjectVoiceoverDraft({
    provider: "openai",
    model: "gpt-4o-mini-tts",
    voiceName: "coral",
    speed: 1.25,
    outputFormat: "mp3",
  });

  assert.equal(draft.provider, "openai");
  assert.equal(draft.model, "gpt-4o-mini-tts");
  assert.equal(draft.voiceName, "coral");
  assert.equal(draft.speed, 1.25);

  const defaulted = normalizeProjectVoiceoverDraft({
    provider: "openai",
    model: "gpt-4o-mini-tts",
  });
  assert.equal(defaulted.voiceName, DEFAULT_OPENAI_TTS_VOICE);
  assert.equal(defaulted.speed, DEFAULT_OPENAI_TTS_SPEED);
});
