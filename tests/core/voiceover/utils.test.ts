import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDefaultProjectVoiceoverConfig,
  buildProjectVoiceoverFilename,
  ELEVENLABS_MODEL_OPTIONS,
  createDefaultProjectVoiceoverDraft,
  extractVoiceoverTextFromFileContents,
  maskVoiceoverSecret,
  normalizeProjectVoiceoverDraft,
  resolveVoiceoverModelSelection,
  resolveVoiceoverOutputFileInfo,
} from "../../../src/lib/voiceover/utils";

test("normalizeProjectVoiceoverDraft applies the v1 defaults", () => {
  const draft = normalizeProjectVoiceoverDraft(undefined);

  assert.equal(draft.provider, "elevenlabs");
  assert.equal(draft.model, ELEVENLABS_MODEL_OPTIONS[0]?.value);
  assert.equal(draft.outputFormat, "mp3");
  assert.equal(draft.voiceId, "");
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

test("resolveVoiceoverModelSelection accepts env-backed values and falls back to the first model", () => {
  assert.equal(resolveVoiceoverModelSelection("eleven_flash_v2_5"), "eleven_flash_v2_5");
  assert.equal(resolveVoiceoverModelSelection("not-a-real-model"), ELEVENLABS_MODEL_OPTIONS[0]?.value);
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
});

test("maskVoiceoverSecret keeps only the edges visible", () => {
  assert.equal(maskVoiceoverSecret("K1cfwjOyYgqN6iO4FPUh"), "K1cf...FPUh");
  assert.equal(maskVoiceoverSecret("xi-key"), "xi...ey");
});
