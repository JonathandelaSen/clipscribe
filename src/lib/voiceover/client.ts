import {
  parseAttachmentFilename,
  VOICEOVER_ELEVENLABS_API_KEY_HEADER,
  VOICEOVER_GEMINI_API_KEY_HEADER,
  VOICEOVER_OPENAI_API_KEY_HEADER,
  VOICEOVER_RESPONSE_HEADERS,
} from "@/lib/voiceover/contracts";
import type { VoiceoverGenerateRequest, VoiceoverGenerateResponseMeta, VoiceoverUsageSummary, VoiceoverJobStatus } from "@/lib/voiceover/types";
import { buildProjectVoiceoverFilename } from "@/lib/voiceover/utils";

interface ErrorResponseBody {
  error?: string;
}

export interface VoiceoverClientResult {
  file: File;
  meta: VoiceoverGenerateResponseMeta;
}

function parseNumberHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

async function readVoiceoverError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json().catch(() => null)) as ErrorResponseBody | null;
    if (data?.error) {
      return data.error;
    }
  }

  const text = await response.text().catch(() => "");
  return text.trim() || `Voiceover request failed (${response.status}).`;
}


function parseVoiceoverResponse(
  response: Response,
  payload: VoiceoverGenerateRequest,
  contentType: string,
  buffer: ArrayBuffer
): VoiceoverClientResult {
  const providerHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.provider);
  const modelHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.model);
  const voiceHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.voice);
  const languageHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.language);
  const speakerModeHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.speakerMode);
  const speedHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.speed));
  const formatHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.format);
  const apiKeySourceHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.apiKeySource);
  const maskedApiKeyHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.maskedApiKey);
  const usageSourceHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.usageSource);
  const estimatedCostSourceHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCostSource);
  const billedCharactersHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.billedCharacters));
  const estimatedCreditsMinHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMin));
  const estimatedCreditsMaxHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCreditsMax));
  const estimatedCostUsdHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.estimatedCostUsd));
  const promptTokensHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.promptTokens));
  const completionTokensHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.completionTokens));
  const totalTokensHeader = parseNumberHeader(response.headers.get(VOICEOVER_RESPONSE_HEADERS.totalTokens));
  const usage: VoiceoverUsageSummary | undefined =
    usageSourceHeader &&
    billedCharactersHeader != null &&
    estimatedCreditsMinHeader != null &&
    estimatedCreditsMaxHeader != null
      ? {
          source: usageSourceHeader === "provider" ? "provider" : "estimated",
          billedCharacters: Math.max(0, Math.round(billedCharactersHeader)),
          estimatedCreditsMin: Math.max(0, Math.round(estimatedCreditsMinHeader)),
          estimatedCreditsMax: Math.max(0, Math.round(estimatedCreditsMaxHeader)),
          estimatedCostUsd: estimatedCostUsdHeader,
          ...(estimatedCostSourceHeader === "provider" || estimatedCostSourceHeader === "estimated" || estimatedCostSourceHeader === "unavailable"
            ? {
                estimatedCostSource: estimatedCostSourceHeader,
              }
            : undefined),
          ...(promptTokensHeader == null
            ? undefined
            : {
                promptTokens: Math.max(0, Math.round(promptTokensHeader)),
              }),
          ...(completionTokensHeader == null
            ? undefined
            : {
                completionTokens: Math.max(0, Math.round(completionTokensHeader)),
              }),
          ...(totalTokensHeader == null
            ? undefined
            : {
                totalTokens: Math.max(0, Math.round(totalTokensHeader)),
              }),
        }
      : undefined;

  const meta: VoiceoverGenerateResponseMeta = {
    provider: providerHeader === "openai" || providerHeader === "gemini" ? providerHeader : "elevenlabs",
    model: modelHeader?.trim() || payload.model,
    voiceId: voiceHeader?.trim() || payload.voiceId,
    voiceName: providerHeader === "gemini" || providerHeader === "openai" ? voiceHeader?.trim() || payload.voiceName : payload.voiceName,
    speed: speedHeader == null ? payload.speed : speedHeader,
    languageCode: languageHeader?.trim() || payload.languageCode,
    speakerMode: speakerModeHeader === "multi" ? "multi" : speakerModeHeader === "single" ? "single" : payload.speakerMode,
    speakers: payload.speakers,
    outputFormat: formatHeader === "wav" ? "wav" : payload.outputFormat,
    apiKeySource: apiKeySourceHeader === "voiceover_settings" || apiKeySourceHeader === "env" ? apiKeySourceHeader : undefined,
    maskedApiKey: maskedApiKeyHeader?.trim() || undefined,
    mimeType: contentType,
    extension: formatHeader === "wav" ? "wav" : "mp3",
    filename:
      parseAttachmentFilename(response.headers.get("content-disposition")) ||
      buildProjectVoiceoverFilename({
        projectName: payload.projectId,
        provider: payload.provider,
        outputFormat: payload.outputFormat,
      }),
    usage,
  };

  const file = new File([buffer], meta.filename, {
    type: contentType,
  });

  return {
    file,
    meta,
  };
}

export async function requestProjectVoiceoverAudio(
  payload: VoiceoverGenerateRequest,
  options: { elevenLabsApiKey?: string; geminiApiKey?: string; openAIApiKey?: string }
): Promise<VoiceoverClientResult> {
  const response = await fetch("/api/projects/voiceover/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.elevenLabsApiKey
        ? {
            [VOICEOVER_ELEVENLABS_API_KEY_HEADER]: options.elevenLabsApiKey,
          }
        : undefined),
      ...(options.geminiApiKey
        ? {
            [VOICEOVER_GEMINI_API_KEY_HEADER]: options.geminiApiKey,
          }
        : undefined),
      ...(options.openAIApiKey
        ? {
            [VOICEOVER_OPENAI_API_KEY_HEADER]: options.openAIApiKey,
          }
        : undefined),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readVoiceoverError(response));
  }

  const contentType = response.headers.get("content-type")?.trim() || "audio/mpeg";
  return parseVoiceoverResponse(response, payload, contentType, await response.arrayBuffer());
}

export async function submitVoiceoverJob(
  payload: VoiceoverGenerateRequest,
  options: { elevenLabsApiKey?: string; geminiApiKey?: string; openAIApiKey?: string }
): Promise<string> {
  const response = await fetch("/api/projects/voiceover/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.elevenLabsApiKey
        ? {
            [VOICEOVER_ELEVENLABS_API_KEY_HEADER]: options.elevenLabsApiKey,
          }
        : undefined),
      ...(options.geminiApiKey
        ? {
            [VOICEOVER_GEMINI_API_KEY_HEADER]: options.geminiApiKey,
          }
        : undefined),
      ...(options.openAIApiKey
        ? {
            [VOICEOVER_OPENAI_API_KEY_HEADER]: options.openAIApiKey,
          }
        : undefined),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readVoiceoverError(response));
  }

  const data = await response.json();
  if (!data.jobId) {
    throw new Error("No jobId returned from generation endpoint.");
  }

  return data.jobId;
}



export interface VoiceoverJobStatusResponse {
  id: string;
  status: VoiceoverJobStatus;
  error?: string;
  createdAt: number;
}

export async function pollVoiceoverJobStatus(jobId: string): Promise<VoiceoverJobStatusResponse> {
  const response = await fetch(`/api/projects/voiceover/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(await readVoiceoverError(response));
  }
  return response.json();
}

export async function fetchVoiceoverJobResult(jobId: string, payload: VoiceoverGenerateRequest): Promise<VoiceoverClientResult> {
  const response = await fetch(`/api/projects/voiceover/jobs/${jobId}/result`);
  if (!response.ok) {
    throw new Error(await readVoiceoverError(response));
  }
  const contentType = response.headers.get("content-type")?.trim() || "audio/mpeg";
  return parseVoiceoverResponse(response, payload, contentType, await response.arrayBuffer());
}
