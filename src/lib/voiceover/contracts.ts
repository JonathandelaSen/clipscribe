import type { VoiceoverGenerateResponseMeta } from "./types";

export const VOICEOVER_ELEVENLABS_API_KEY_HEADER = "x-voiceover-elevenlabs-api-key";

export const VOICEOVER_RESPONSE_HEADERS = {
  provider: "x-clipscribe-provider",
  model: "x-clipscribe-model",
  voice: "x-clipscribe-voice",
  format: "x-clipscribe-format",
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
