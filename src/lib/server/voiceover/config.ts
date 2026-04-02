import { buildDefaultProjectVoiceoverConfig, maskVoiceoverSecret, resolveVoiceoverModelSelection } from "@/lib/voiceover/utils";

const ELEVENLABS_API_KEY_ENV_KEYS = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVEN_LABS_APY_KEY"] as const;
const ELEVENLABS_VOICE_ID_ENV_KEYS = ["ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID"] as const;
const ELEVENLABS_MODEL_ENV_KEYS = ["ELEVENLABS_MODEL", "ELEVEN_LABS_MODEL", "EVELEN_LABS_MODEL"] as const;

function readFirstEnvValue(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

export function readElevenLabsApiKeyFromEnv(): string {
  return readFirstEnvValue(ELEVENLABS_API_KEY_ENV_KEYS);
}

export function readElevenLabsDefaultModelFromEnv(): string {
  return resolveVoiceoverModelSelection(readFirstEnvValue(ELEVENLABS_MODEL_ENV_KEYS));
}

export function readElevenLabsDefaultVoiceIdFromEnv(): string {
  return readFirstEnvValue(ELEVENLABS_VOICE_ID_ENV_KEYS);
}

export function readProjectVoiceoverConfigFromEnv() {
  const apiKey = readElevenLabsApiKeyFromEnv();
  const voiceId = readElevenLabsDefaultVoiceIdFromEnv();
  return buildDefaultProjectVoiceoverConfig({
    defaultModel: readElevenLabsDefaultModelFromEnv(),
    defaultVoiceId: "",
    hasApiKey: Boolean(apiKey),
    maskedApiKey: maskVoiceoverSecret(apiKey),
    hasDefaultVoiceId: Boolean(voiceId),
    maskedDefaultVoiceId: maskVoiceoverSecret(voiceId),
  });
}
