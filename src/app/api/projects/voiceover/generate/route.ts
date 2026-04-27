import { VOICEOVER_ELEVENLABS_API_KEY_HEADER, VOICEOVER_GEMINI_API_KEY_HEADER, VOICEOVER_OPENAI_API_KEY_HEADER, buildVoiceoverResponseHeaders } from "@/lib/voiceover/contracts";
import type { VoiceoverApiKeySource, VoiceoverGenerateRequest, VoiceoverSpeakerConfig } from "@/lib/voiceover/types";
import { generateProjectVoiceover } from "@/lib/server/voiceover/service";
import {
  readElevenLabsApiKeyFromEnv,
  readGeminiApiKeyFromEnv,
  readGeminiDefaultModelFromEnv,
  readOpenAIApiKeyFromEnv,
  readOpenAIDefaultModelFromEnv,
  readProjectVoiceoverConfigFromEnv,
  readElevenLabsDefaultModelFromEnv,
} from "@/lib/server/voiceover/config";
import {
  DEFAULT_GEMINI_TTS_VOICE,
  DEFAULT_OPENAI_TTS_SPEED,
  DEFAULT_OPENAI_TTS_VOICE,
  GEMINI_TTS_LANGUAGE_OPTIONS,
  GEMINI_TTS_VOICE_OPTIONS,
  OPENAI_TTS_VOICE_OPTIONS,
  maskVoiceoverSecret,
  normalizeGeminiGenerationConfig,
  normalizeOpenAITtsSpeed,
} from "@/lib/voiceover/utils";
import { VoiceoverError } from "@/lib/server/voiceover/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function errorJson(message: string, status: number, code?: string) {
  return Response.json({ ok: false, error: message, code }, { status });
}

function getRequiredElevenLabsApiKey(headers: Pick<Headers, "get">): {
  apiKey: string;
  apiKeySource: VoiceoverApiKeySource;
  maskedApiKey: string;
} {
  const headerApiKey = headers.get(VOICEOVER_ELEVENLABS_API_KEY_HEADER)?.trim() ?? "";
  if (headerApiKey) {
    return {
      apiKey: headerApiKey,
      apiKeySource: "voiceover_settings",
      maskedApiKey: maskVoiceoverSecret(headerApiKey),
    };
  }

  const envApiKey = readElevenLabsApiKeyFromEnv();
  if (!envApiKey) {
    throw new VoiceoverError("ElevenLabs API key missing. Set it in .env or override it from Voiceover settings.", {
      status: 401,
      code: "missing_elevenlabs_api_key",
    });
  }

  return {
    apiKey: envApiKey,
    apiKeySource: "env",
    maskedApiKey: readProjectVoiceoverConfigFromEnv().maskedApiKey || maskVoiceoverSecret(envApiKey),
  };
}

function getRequiredGeminiApiKey(headers: Pick<Headers, "get">): {
  apiKey: string;
  apiKeySource: VoiceoverApiKeySource;
  maskedApiKey: string;
} {
  const headerApiKey = headers.get(VOICEOVER_GEMINI_API_KEY_HEADER)?.trim() ?? "";
  if (headerApiKey) {
    return {
      apiKey: headerApiKey,
      apiKeySource: "voiceover_settings",
      maskedApiKey: maskVoiceoverSecret(headerApiKey),
    };
  }

  const envApiKey = readGeminiApiKeyFromEnv();
  if (!envApiKey) {
    throw new VoiceoverError("Gemini API key missing. Save it in Creator settings or set GEMINI_API_KEY.", {
      status: 401,
      code: "missing_gemini_api_key",
    });
  }

  return {
    apiKey: envApiKey,
    apiKeySource: "env",
    maskedApiKey: readProjectVoiceoverConfigFromEnv().providers.gemini?.maskedApiKey || maskVoiceoverSecret(envApiKey),
  };
}

function getRequiredOpenAIApiKey(headers: Pick<Headers, "get">): {
  apiKey: string;
  apiKeySource: VoiceoverApiKeySource;
  maskedApiKey: string;
} {
  const headerApiKey = headers.get(VOICEOVER_OPENAI_API_KEY_HEADER)?.trim() ?? "";
  if (headerApiKey) {
    return {
      apiKey: headerApiKey,
      apiKeySource: "voiceover_settings",
      maskedApiKey: maskVoiceoverSecret(headerApiKey),
    };
  }

  const envApiKey = readOpenAIApiKeyFromEnv();
  if (!envApiKey) {
    throw new VoiceoverError("OpenAI API key missing. Save it in Creator settings or set OPENAI_API_KEY.", {
      status: 401,
      code: "missing_openai_api_key",
    });
  }

  return {
    apiKey: envApiKey,
    apiKeySource: "env",
    maskedApiKey: readProjectVoiceoverConfigFromEnv().providers.openai?.maskedApiKey || maskVoiceoverSecret(envApiKey),
  };
}

function getProviderApiKey(
  headers: Pick<Headers, "get">,
  provider: VoiceoverGenerateRequest["provider"]
): { apiKey: string; apiKeySource: VoiceoverApiKeySource; maskedApiKey: string } {
  if (provider === "elevenlabs") {
    return getRequiredElevenLabsApiKey(headers);
  }
  if (provider === "gemini") {
    return getRequiredGeminiApiKey(headers);
  }
  if (provider === "openai") {
    return getRequiredOpenAIApiKey(headers);
  }

  throw new VoiceoverError(`${provider} voiceover generation is not implemented yet.`, {
    status: 501,
    code: "provider_not_implemented",
  });
}

function isSupportedProvider(value: unknown): value is VoiceoverGenerateRequest["provider"] {
  return value === "elevenlabs" || value === "openai" || value === "gemini";
}

function isSupportedFormat(value: unknown): value is VoiceoverGenerateRequest["outputFormat"] {
  return value === "mp3" || value === "wav";
}

function parseVoiceName(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return GEMINI_TTS_VOICE_OPTIONS.some((option) => option.value === trimmed) ? trimmed : DEFAULT_GEMINI_TTS_VOICE;
}

function parseOpenAIVoiceName(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return OPENAI_TTS_VOICE_OPTIONS.some((option) => option.value === trimmed) ? trimmed : DEFAULT_OPENAI_TTS_VOICE;
}

function parseLanguageCode(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return GEMINI_TTS_LANGUAGE_OPTIONS.some((option) => option.value === trimmed) ? trimmed : undefined;
}

function parseGeminiSpeakers(value: unknown, fallbackVoiceName: string): VoiceoverSpeakerConfig[] {
  const defaults: VoiceoverSpeakerConfig[] = [
    { speaker: "Speaker1", voiceName: fallbackVoiceName },
    { speaker: "Speaker2", voiceName: "Puck" },
  ];
  if (!Array.isArray(value)) return defaults;

  const speakers = value.slice(0, 2).map((entry, index) => {
    const record = isRecord(entry) ? entry : {};
    const speaker = typeof record.speaker === "string" && record.speaker.trim() ? record.speaker.trim() : defaults[index]!.speaker;
    const voiceName = parseVoiceName(record.voiceName ?? defaults[index]!.voiceName);
    return { speaker, voiceName };
  });

  return speakers.length === 2 ? speakers : defaults;
}

function parseRequest(body: unknown): VoiceoverGenerateRequest {
  if (!isRecord(body)) {
    throw new VoiceoverError("Request body must be an object.", {
      status: 400,
      code: "invalid_body",
    });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const scriptText = typeof body.scriptText === "string" ? body.scriptText : "";
  const provider = body.provider;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const openAIVoiceName = parseOpenAIVoiceName(body.voiceName ?? voiceId);
  const voiceName = provider === "openai" ? openAIVoiceName : parseVoiceName(body.voiceName);
  const languageCode = parseLanguageCode(body.languageCode);
  const speakerMode = body.speakerMode === "multi" ? "multi" : "single";
  const speakers = parseGeminiSpeakers(body.speakers, voiceName);
  const stylePrompt = typeof body.stylePrompt === "string" && body.stylePrompt.trim() ? body.stylePrompt.trim() : undefined;
  const generationConfig = normalizeGeminiGenerationConfig(
    isRecord(body.generationConfig) ? body.generationConfig : undefined
  );
  const speed = provider === "openai" || provider === "gemini" ? normalizeOpenAITtsSpeed(body.speed) ?? DEFAULT_OPENAI_TTS_SPEED : undefined;
  const outputFormat = body.outputFormat;

  if (!projectId) {
    throw new VoiceoverError("projectId is required.", { status: 400, code: "missing_project_id" });
  }
  if (!scriptText.trim()) {
    throw new VoiceoverError("scriptText is required.", { status: 400, code: "missing_script_text" });
  }
  if (!isSupportedProvider(provider)) {
    throw new VoiceoverError("provider must be one of elevenlabs, openai, or gemini.", {
      status: 400,
      code: "invalid_provider",
    });
  }
  const resolvedModel = model || (provider === "gemini" ? readGeminiDefaultModelFromEnv() : provider === "openai" ? readOpenAIDefaultModelFromEnv() : readElevenLabsDefaultModelFromEnv());
  const resolvedVoiceId = provider === "openai" ? openAIVoiceName : voiceId;

  if (!resolvedModel) {
    throw new VoiceoverError("model is required.", { status: 400, code: "missing_model" });
  }
  if (provider === "elevenlabs" && !resolvedVoiceId) {
    throw new VoiceoverError("ElevenLabs always requires a voice ID. Paste a voice ID you can use with your plan.", {
      status: 400,
      code: "missing_voice_id",
    });
  }
  if (provider === "gemini" && speakerMode === "multi" && speakers.length !== 2) {
    throw new VoiceoverError("Gemini multi-speaker TTS requires exactly two speakers.", {
      status: 400,
      code: "invalid_gemini_speakers",
    });
  }
  if (!isSupportedFormat(outputFormat)) {
    throw new VoiceoverError("outputFormat must be mp3 or wav.", {
      status: 400,
      code: "invalid_output_format",
    });
  }

  return {
    projectId,
    scriptText,
    provider,
    model: resolvedModel,
    voiceId: resolvedVoiceId,
    voiceName,
    languageCode,
    speakerMode,
    speakers,
    stylePrompt,
    generationConfig,
    speed,
    outputFormat,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body.", 400, "invalid_json");
  }

  try {
    const payload = parseRequest(body);
    const { apiKey, apiKeySource, maskedApiKey } = getProviderApiKey(request.headers, payload.provider);
    const result = await generateProjectVoiceover(payload, {
      apiKey,
      apiKeySource,
      signal: request.signal,
    });
    const responseBytes = Uint8Array.from(result.bytes);
    const binaryBody = new Blob([responseBytes], {
      type: result.mimeType,
    });

    return new Response(binaryBody, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        ...buildVoiceoverResponseHeaders({
          ...result,
          apiKeySource,
          maskedApiKey,
        }),
      },
    });
  } catch (error) {
    if (error instanceof VoiceoverError) {
      return errorJson(error.message, error.status, error.code);
    }
    return errorJson(error instanceof Error ? error.message : "Voiceover generation failed.", 500, "voiceover_failed");
  }
}
