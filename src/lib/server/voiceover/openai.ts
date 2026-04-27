import {
  buildProjectVoiceoverFilename,
  DEFAULT_OPENAI_TTS_SPEED,
  DEFAULT_OPENAI_TTS_VOICE,
  normalizeOpenAITtsSpeed,
  resolveVoiceoverOutputFileInfo,
} from "@/lib/voiceover/utils";
import type { VoiceoverApiKeySource, VoiceoverProviderAdapter, VoiceoverUsageSummary } from "@/lib/voiceover/types";

import { VoiceoverError } from "./errors";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function extractProviderError(rawBody: unknown): string {
  if (typeof rawBody === "string") {
    try {
      return extractProviderError(JSON.parse(rawBody) as unknown);
    } catch {
      return rawBody.trim();
    }
  }
  if (!isRecord(rawBody)) return "";
  const error = isRecord(rawBody.error) ? rawBody.error : null;
  if (typeof error?.message === "string") return error.message.trim();
  if (typeof rawBody.message === "string") return rawBody.message.trim();
  return "";
}

function buildAuthErrorMessage(apiKeySource: VoiceoverApiKeySource): string {
  if (apiKeySource === "voiceover_settings") {
    return "OpenAI rejected the API key saved in Creator settings. Clear it or replace it to fall back to .env.";
  }

  return "OpenAI rejected the API key loaded from .env. Update OPENAI_API_KEY and try again.";
}

function toOpenAIError(status: number, rawBody: unknown, apiKeySource: VoiceoverApiKeySource): VoiceoverError {
  const providerMessage = extractProviderError(rawBody);
  if (status === 401 || status === 403) {
    return new VoiceoverError(providerMessage || buildAuthErrorMessage(apiKeySource), {
      status,
      code: "openai_auth_error",
    });
  }
  if (status === 429) {
    return new VoiceoverError(providerMessage || "OpenAI rejected the request because of quota or rate limits.", {
      status: 429,
      code: "openai_rate_limited",
    });
  }
  if (status >= 500) {
    return new VoiceoverError("OpenAI TTS is temporarily unavailable. Please retry in a moment.", {
      status: 502,
      code: "openai_unavailable",
    });
  }

  return new VoiceoverError(providerMessage || `OpenAI TTS request failed (${status}).`, {
    status: status >= 400 && status < 500 ? status : 502,
    code: "openai_request_failed",
  });
}

function buildOpenAIUsageSummary(scriptText: string): VoiceoverUsageSummary {
  return {
    billedCharacters: scriptText.length,
    source: "estimated",
    estimatedCostUsd: null,
    estimatedCostSource: "unavailable",
    estimatedCreditsMin: 0,
    estimatedCreditsMax: 0,
  };
}

export const openAIVoiceoverAdapter: VoiceoverProviderAdapter = {
  id: "openai",

  async generate(input) {
    const voiceName = input.voiceName?.trim() || input.voiceId.trim() || DEFAULT_OPENAI_TTS_VOICE;
    const speed = normalizeOpenAITtsSpeed(input.speed) ?? DEFAULT_OPENAI_TTS_SPEED;
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        input: input.scriptText,
        voice: voiceName,
        response_format: input.outputFormat,
        speed,
      }),
      cache: "no-store",
      signal: input.signal,
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const errorBody = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");
      throw toOpenAIError(response.status, errorBody, input.apiKeySource);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new VoiceoverError("OpenAI TTS returned empty audio.", {
        status: 502,
        code: "openai_audio_empty",
      });
    }
    const { extension, mimeType: fallbackMimeType } = resolveVoiceoverOutputFileInfo(input.outputFormat);
    const mimeType = response.headers.get("content-type")?.trim() || fallbackMimeType;

    return {
      bytes,
      provider: "openai",
      model: input.model,
      voiceId: voiceName,
      voiceName,
      speed,
      outputFormat: input.outputFormat,
      mimeType,
      extension,
      usage: buildOpenAIUsageSummary(input.scriptText),
      filename: buildProjectVoiceoverFilename({
        projectName: input.projectId,
        provider: "openai",
        outputFormat: input.outputFormat,
      }),
    };
  },
};
