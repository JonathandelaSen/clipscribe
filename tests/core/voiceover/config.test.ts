import test from "node:test";
import assert from "node:assert/strict";

import { GET } from "../../../src/app/api/projects/voiceover/config/route";

const originalElevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const originalElevenLabsApiKeyAlias = process.env.ELEVEN_LABS_API_KEY;
const originalElevenLabsApiKeyTypo = process.env.ELEVEN_LABS_APY_KEY;
const originalElevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
const originalElevenLabsVoiceIdAlias = process.env.ELEVEN_LABS_VOICE_ID;
const originalElevenLabsModel = process.env.ELEVENLABS_MODEL;
const originalElevenLabsModelAlias = process.env.ELEVEN_LABS_MODEL;
const originalElevenLabsModelTypo = process.env.EVELEN_LABS_MODEL;

test.afterEach(() => {
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
});

test("voiceover config reads aliased env vars and returns masked values", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
  delete process.env.ELEVENLABS_MODEL;
  process.env.ELEVEN_LABS_APY_KEY = "xi-very-secret-key";
  process.env.ELEVEN_LABS_VOICE_ID = "K1cfwjOyYgqN6iO4FPUh";
  process.env.EVELEN_LABS_MODEL = "eleven_flash_v2_5";

  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.defaultModel, "eleven_flash_v2_5");
  assert.equal(body.defaultVoiceId, "");
  assert.equal(body.hasApiKey, true);
  assert.equal(body.hasDefaultVoiceId, true);
  assert.equal(body.maskedApiKey, "xi-v...-key");
  assert.equal(body.maskedDefaultVoiceId, "K1cf...FPUh");
});
