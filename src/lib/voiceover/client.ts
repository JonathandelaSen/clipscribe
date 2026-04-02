import {
  parseAttachmentFilename,
  VOICEOVER_ELEVENLABS_API_KEY_HEADER,
  VOICEOVER_RESPONSE_HEADERS,
} from "@/lib/voiceover/contracts";
import type { VoiceoverGenerateRequest, VoiceoverGenerateResponseMeta } from "@/lib/voiceover/types";
import { buildProjectVoiceoverFilename } from "@/lib/voiceover/utils";

interface ErrorResponseBody {
  error?: string;
}

export interface VoiceoverClientResult {
  file: File;
  meta: VoiceoverGenerateResponseMeta;
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

export async function requestProjectVoiceoverAudio(
  payload: VoiceoverGenerateRequest,
  options: { elevenLabsApiKey?: string }
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
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readVoiceoverError(response));
  }

  const contentType = response.headers.get("content-type")?.trim() || "audio/mpeg";
  const providerHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.provider);
  const modelHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.model);
  const voiceHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.voice);
  const formatHeader = response.headers.get(VOICEOVER_RESPONSE_HEADERS.format);

  const meta: VoiceoverGenerateResponseMeta = {
    provider: providerHeader === "openai" || providerHeader === "gemini" ? providerHeader : "elevenlabs",
    model: modelHeader?.trim() || payload.model,
    voiceId: voiceHeader?.trim() || payload.voiceId,
    outputFormat: formatHeader === "wav" ? "wav" : payload.outputFormat,
    mimeType: contentType,
    extension: formatHeader === "wav" ? "wav" : "mp3",
    filename:
      parseAttachmentFilename(response.headers.get("content-disposition")) ||
      buildProjectVoiceoverFilename({
        projectName: payload.projectId,
        provider: payload.provider,
        outputFormat: payload.outputFormat,
      }),
  };

  const file = new File([await response.arrayBuffer()], meta.filename, {
    type: contentType,
  });

  return {
    file,
    meta,
  };
}
