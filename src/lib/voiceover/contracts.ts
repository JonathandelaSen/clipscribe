import type { VoiceoverGenerateResponseMeta } from "./types";

export const VOICEOVER_ELEVENLABS_API_KEY_HEADER = "x-voiceover-elevenlabs-api-key";

export const VOICEOVER_RESPONSE_HEADERS = {
  provider: "x-clipscribe-provider",
  model: "x-clipscribe-model",
  voice: "x-clipscribe-voice",
  format: "x-clipscribe-format",
  apiKeySource: "x-clipscribe-api-key-source",
  maskedApiKey: "x-clipscribe-masked-api-key",
  usageSource: "x-clipscribe-usage-source",
  billedCharacters: "x-clipscribe-billed-characters",
  estimatedCreditsMin: "x-clipscribe-estimated-credits-min",
  estimatedCreditsMax: "x-clipscribe-estimated-credits-max",
  estimatedCostUsd: "x-clipscribe-estimated-cost-usd",
} as const;

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildVoiceoverResponseHeaders(meta: VoiceoverGenerateResponseMeta): Record<string, string> {
  return {
    "content-disposition": `attachment; filename="${sanitizeHeaderValue(meta.filename)}"`,
    [VOICEOVER_RESPONSE_HEADERS.provider]: meta.provider,
    [VOICEOVER_RESPONSE_HEADERS.model]: sanitizeHeaderValue(meta.model),
    [VOICEOVER_RESPONSE_HEADERS.voice]: sanitizeHeaderValue(meta.voiceId),
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
          [VOICEOVER_RESPONSE_HEADERS.billedCharacters]: String(meta.usage.billedCharacters),
          [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMin]: String(meta.usage.estimatedCreditsMin),
          [VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMax]: String(meta.usage.estimatedCreditsMax),
          ...(meta.usage.estimatedCostUsd != null
            ? {
                [VOICEOVER_RESPONSE_HEADERS.estimatedCostUsd]: String(meta.usage.estimatedCostUsd),
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
