import { buildDefaultProjectVoiceoverConfig, maskVoiceoverSecret, resolveVoiceoverModelSelection } from "@/lib/voiceover/utils";

const ELEVENLABS_API_KEY_ENV_KEYS = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVEN_LABS_APY_KEY"] as const;
const ELEVENLABS_VOICE_ID_ENV_KEYS = ["ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID"] as const;
const ELEVENLABS_MODEL_ENV_KEYS = ["ELEVENLABS_MODEL", "ELEVEN_LABS_MODEL", "EVELEN_LABS_MODEL"] as const;
const GEMINI_API_KEY_ENV_KEYS = ["CREATOR_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
const GEMINI_TTS_MODEL_ENV_KEYS = ["VOICEOVER_GEMINI_MODEL", "GEMINI_TTS_MODEL", "CREATOR_VOICEOVER_GEMINI_MODEL"] as const;

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
  return resolveVoiceoverModelSelection(readFirstEnvValue(ELEVENLABS_MODEL_ENV_KEYS), "elevenlabs");
}

export function readElevenLabsDefaultVoiceIdFromEnv(): string {
  return readFirstEnvValue(ELEVENLABS_VOICE_ID_ENV_KEYS);
}

export function readGeminiApiKeyFromEnv(): string {
  return readFirstEnvValue(GEMINI_API_KEY_ENV_KEYS);
}

export function readGeminiDefaultModelFromEnv(): string {
  return resolveVoiceoverModelSelection(readFirstEnvValue(GEMINI_TTS_MODEL_ENV_KEYS), "gemini");
}

export function readProjectVoiceoverConfigFromEnv() {
  const apiKey = readElevenLabsApiKeyFromEnv();
  const voiceId = readElevenLabsDefaultVoiceIdFromEnv();
  const geminiApiKey = readGeminiApiKeyFromEnv();
  return buildDefaultProjectVoiceoverConfig({
    defaultModel: readElevenLabsDefaultModelFromEnv(),
    defaultVoiceId: "",
    hasApiKey: Boolean(apiKey),
    maskedApiKey: maskVoiceoverSecret(apiKey),
    hasDefaultVoiceId: Boolean(voiceId),
    maskedDefaultVoiceId: maskVoiceoverSecret(voiceId),
    geminiDefaultModel: readGeminiDefaultModelFromEnv(),
    geminiHasApiKey: Boolean(geminiApiKey),
    geminiMaskedApiKey: maskVoiceoverSecret(geminiApiKey),
  });
}
