import { VOICEOVER_ELEVENLABS_API_KEY_HEADER, buildVoiceoverResponseHeaders } from "@/lib/voiceover/contracts";
import type { VoiceoverApiKeySource, VoiceoverGenerateRequest } from "@/lib/voiceover/types";
import { generateProjectVoiceover } from "@/lib/server/voiceover/service";
import {
  readElevenLabsApiKeyFromEnv,
  readElevenLabsDefaultModelFromEnv,
} from "@/lib/server/voiceover/config";
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
} {
  const headerApiKey = headers.get(VOICEOVER_ELEVENLABS_API_KEY_HEADER)?.trim() ?? "";
  if (headerApiKey) {
    return {
      apiKey: headerApiKey,
      apiKeySource: "voiceover_settings",
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
  };
}

function getProviderApiKey(
  headers: Pick<Headers, "get">,
  provider: VoiceoverGenerateRequest["provider"]
): { apiKey: string; apiKeySource: VoiceoverApiKeySource } {
  if (provider === "elevenlabs") {
    return getRequiredElevenLabsApiKey(headers);
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
  const resolvedModel = model || readElevenLabsDefaultModelFromEnv();
  const resolvedVoiceId = voiceId;

  if (!resolvedModel) {
    throw new VoiceoverError("model is required.", { status: 400, code: "missing_model" });
  }
  if (!resolvedVoiceId) {
    throw new VoiceoverError("ElevenLabs always requires a voice ID. Paste a voice ID you can use with your plan.", {
      status: 400,
      code: "missing_voice_id",
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
    const { apiKey, apiKeySource } = getProviderApiKey(request.headers, payload.provider);
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
        ...buildVoiceoverResponseHeaders(result),
      },
    });
  } catch (error) {
    if (error instanceof VoiceoverError) {
      return errorJson(error.message, error.status, error.code);
    }
    return errorJson(error instanceof Error ? error.message : "Voiceover generation failed.", 500, "voiceover_failed");
  }
}
