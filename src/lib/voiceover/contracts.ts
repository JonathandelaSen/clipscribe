import type { VoiceoverGenerateResponseMeta } from "./types";

export const VOICEOVER_ELEVENLABS_API_KEY_HEADER = "x-voiceover-elevenlabs-api-key";
export const VOICEOVER_GEMINI_API_KEY_HEADER = "x-creator-gemini-api-key";
export const VOICEOVER_OPENAI_API_KEY_HEADER = "x-creator-openai-api-key";

export const VOICEOVER_RESPONSE_HEADERS = {
  provider: "x-clipscribe-provider",
  model: "x-clipscribe-model",
  voice: "x-clipscribe-voice",
  language: "x-clipscribe-language",
  speakerMode: "x-clipscribe-speaker-mode",
  speed: "x-clipscribe-speed",
  format: "x-clipscribe-format",
  apiKeySource: "x-clipscribe-api-key-source",
  maskedApiKey: "x-clipscribe-masked-api-key",
  usageSource: "x-clipscribe-usage-source",
  estimatedCostSource: "x-clipscribe-estimated-cost-source",
  billedCharacters: "x-clipscribe-billed-characters",
  estimatedCreditsMin: "x-clipscribe-estimated-credits-min",
  estimatedCreditsMax: "x-clipscribe-estimated-credits-max",
  estimatedCostUsd: "x-clipscribe-estimated-cost-usd",
  promptTokens: "x-clipscribe-prompt-tokens",
  completionTokens: "x-clipscribe-completion-tokens",
  totalTokens: "x-clipscribe-total-tokens",
} as const;

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildVoiceoverResponseHeaders(meta: VoiceoverGenerateResponseMeta): Record<string, string> {
  return {
    "content-disposition": `attachment; filename="${sanitizeHeaderValue(meta.filename)}"`,
    [VOICEOVER_RESPONSE_HEADERS.provider]: meta.provider,
    [VOICEOVER_RESPONSE_HEADERS.model]: sanitizeHeaderValue(meta.model),
    [VOICEOVER_RESPONSE_HEADERS.voice]: sanitizeHeaderValue(meta.voiceName || meta.voiceId),
    ...(meta.languageCode
      ? {
          [VOICEOVER_RESPONSE_HEADERS.language]: sanitizeHeaderValue(meta.languageCode),
        }
      : undefined),
    ...(meta.speakerMode
      ? {
          [VOICEOVER_RESPONSE_HEADERS.speakerMode]: sanitizeHeaderValue(meta.speakerMode),
        }
      : undefined),
    ...(meta.speed != null
      ? {
          [VOICEOVER_RESPONSE_HEADERS.speed]: String(meta.speed),
        }
      : undefined),
    [VOICEOVER_RESPONSE_HEADERS.format]: meta.outputFormat,
    ...(meta.apiKeySource
      ? {
          [VOICEOVER_RESPONSE_HEADERS.apiKeySource]: meta.apiKeySource,
        }
      : undefined),
    ...(meta.maskedApiKey
      ? {
          [VOICEOVER_RESPONSE_HEADERS.maskedApiKey]: sanitizeHeaderValue(meta.maskedApiKey),
        }
      : undefined),
    ...(meta.usage
        ? {
          [VOICEOVER_RESPONSE_HEADERS.usageSource]: meta.usage.source,
          ...(meta.usage.estimatedCostSource
            ? {
                [VOICEOVER_RESPONSE_HEADERS.estimatedCostSource]: meta.usage.estimatedCostSource,
              }
            : undefined),
          [VOICEOVER_RESPONSE_HEADERS.billedCharacters]: String(meta.usage.billedCharacters),
          [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMin]: String(meta.usage.estimatedCreditsMin),
          [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMax]: String(meta.usage.estimatedCreditsMax),
          ...(meta.usage.estimatedCostUsd != null
            ? {
                [VOICEOVER_RESPONSE_HEADERS.estimatedCostUsd]: String(meta.usage.estimatedCostUsd),
              }
            : undefined),
          ...(meta.usage.promptTokens != null
            ? {
                [VOICEOVER_RESPONSE_HEADERS.promptTokens]: String(meta.usage.promptTokens),
              }
            : undefined),
          ...(meta.usage.completionTokens != null
            ? {
                [VOICEOVER_RESPONSE_HEADERS.completionTokens]: String(meta.usage.completionTokens),
              }
            : undefined),
          ...(meta.usage.totalTokens != null
            ? {
                [VOICEOVER_RESPONSE_HEADERS.totalTokens]: String(meta.usage.totalTokens),
              }
            : undefined),
        }
      : undefined),
  };
}

export function parseAttachmentFilename(value: string | null): string | null {
  if (!value) return null;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = value.match(/filename="([^"]+)"/i) ?? value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}
