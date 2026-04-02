import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";

import {
  buildProjectVoiceoverFilename,
  resolveVoiceoverOutputFileInfo,
} from "@/lib/voiceover/utils";
import type { VoiceoverApiKeySource, VoiceoverProviderAdapter } from "@/lib/voiceover/types";

import { VoiceoverError } from "./errors";

function mapElevenLabsOutputFormat(outputFormat: "mp3" | "wav"): "mp3_44100_128" | "pcm_44100" {
  return outputFormat === "wav" ? "pcm_44100" : "mp3_44100_128";
}

function extractProviderError(rawBody: unknown): {
  message: string;
  detailStatus?: string;
  detailCode?: string;
} {
  if (typeof rawBody === "string") {
    try {
      return extractProviderError(JSON.parse(rawBody));
    } catch {
      return { message: rawBody };
    }
  }

  if (rawBody && typeof rawBody === "object") {
    const parsed = rawBody as {
      detail?: { message?: string; status?: string; code?: string };
      message?: string;
      status?: string;
      code?: string;
    };

    return {
      message: parsed.detail?.message || parsed.message || "",
      detailStatus: parsed.detail?.status || parsed.status,
      detailCode: parsed.detail?.code || parsed.code,
    };
  }

  return { message: "" };
}

function buildAuthErrorMessage(apiKeySource: VoiceoverApiKeySource): string {
  if (apiKeySource === "voiceover_settings") {
    return "ElevenLabs rejected the API key saved in Voiceover settings. Clear it or replace it to fall back to .env.";
  }

  return "ElevenLabs rejected the API key loaded from .env. Update ELEVENLABS_API_KEY and try again.";
}

function toElevenLabsError(
  status: number,
  rawBody: unknown,
  apiKeySource: VoiceoverApiKeySource
): VoiceoverError {
  const { message, detailStatus, detailCode } = extractProviderError(rawBody);
  const providerMessage = message.trim();
  const isQuotaExceeded =
    detailStatus === "quota_exceeded" ||
    detailCode === "quota_exceeded" ||
    /quota|credits?/i.test(providerMessage);

  if (status === 401 && isQuotaExceeded) {
    return new VoiceoverError(
      providerMessage || "ElevenLabs rejected the request because your API quota or credits are exhausted.",
      {
        status: 429,
        code: "elevenlabs_quota_exceeded",
      }
    );
  }
  if (status === 401) {
    return new VoiceoverError(buildAuthErrorMessage(apiKeySource), {
      status: 401,
      code: "elevenlabs_auth_error",
    });
  }
  if (status === 402) {
    return new VoiceoverError(
      providerMessage || "ElevenLabs requires a paid plan or available credits for this voice or feature.",
      {
        status: 402,
        code: "elevenlabs_payment_required",
      }
    );
  }
  if (status === 403) {
    return new VoiceoverError(
      providerMessage || "ElevenLabs rejected this voice or feature for your current account or plan.",
      {
        status: 403,
        code: "elevenlabs_access_denied",
      }
    );
  }
  if (status === 429) {
    return new VoiceoverError("ElevenLabs rejected the request because of rate limits or quota.", {
      status: 429,
      code: "elevenlabs_rate_limited",
    });
  }
  if (status >= 500) {
    return new VoiceoverError("ElevenLabs is temporarily unavailable. Please retry in a moment.", {
      status: 502,
      code: "elevenlabs_unavailable",
    });
  }

  return new VoiceoverError(providerMessage || `ElevenLabs request failed (${status}).`, {
    status: status >= 400 && status < 500 ? status : 502,
    code: "elevenlabs_request_failed",
  });
}

export const elevenLabsVoiceoverAdapter: VoiceoverProviderAdapter = {
  id: "elevenlabs",

  async generate(input) {
    const voiceId = input.voiceId.trim();
    if (!voiceId) {
      throw new VoiceoverError("ElevenLabs always requires a voice ID. Paste a voice ID you can use with your plan.", {
        status: 400,
        code: "missing_voice_id",
      });
    }

    const client = new ElevenLabsClient({
      apiKey: input.apiKey,
    });

    try {
      const { data, rawResponse } = await client.textToSpeech
        .convert(
          voiceId,
          {
            text: input.scriptText,
            modelId: input.model,
            outputFormat: mapElevenLabsOutputFormat(input.outputFormat),
          },
          {
            abortSignal: input.signal,
          }
        )
        .withRawResponse();
      const bytes = new Uint8Array(await new Response(data).arrayBuffer());
      const { extension, mimeType: fallbackMimeType } = resolveVoiceoverOutputFileInfo(input.outputFormat);
      const mimeType = rawResponse.headers.get("content-type")?.trim() || fallbackMimeType;

      return {
        bytes,
        provider: "elevenlabs",
        model: input.model,
        voiceId,
        outputFormat: input.outputFormat,
        mimeType,
        extension,
        filename: buildProjectVoiceoverFilename({
          projectName: input.projectId,
          provider: "elevenlabs",
          outputFormat: input.outputFormat,
        }),
      };
    } catch (error) {
      if (error instanceof ElevenLabsError) {
        throw toElevenLabsError(error.statusCode ?? 502, error.body ?? error.message, input.apiKeySource);
      }
      throw error;
    }
  },
};
