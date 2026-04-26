import { randomUUID } from "node:crypto";

import { getCreatorImageModelOption } from "../../../creator/ai";
import type {
  CreatorGeneratedImage,
  CreatorImageFormat,
  CreatorImageGenerateRequest,
  CreatorImageModelFamily,
  CreatorImageQuality,
  CreatorLLMCostSource,
  CreatorLLMProvider,
  CreatorLLMUsage,
} from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";

type LooseRecord = Record<string, unknown>;

type ProviderImageResult = {
  images: CreatorGeneratedImage[];
  payload: unknown;
  usage?: CreatorLLMUsage;
  fetchDurationMs: number;
};

const OPENAI_IMAGE_COSTS: Partial<Record<string, Partial<Record<CreatorImageQuality, Partial<Record<string, number>>>>>> = {
  "gpt-image-1": {
    low: { "1024x1024": 0.011, "1024x1536": 0.016, "1536x1024": 0.016 },
    medium: { "1024x1024": 0.042, "1024x1536": 0.063, "1536x1024": 0.063 },
    high: { "1024x1024": 0.167, "1024x1536": 0.25, "1536x1024": 0.25 },
  },
  "gpt-image-1.5": {
    low: { "1024x1024": 0.009, "1024x1536": 0.013, "1536x1024": 0.013 },
    medium: { "1024x1024": 0.034, "1024x1536": 0.05, "1536x1024": 0.05 },
    high: { "1024x1024": 0.133, "1024x1536": 0.2, "1536x1024": 0.2 },
  },
  "gpt-image-2": {
    low: { "1024x1024": 0.006, "1024x1536": 0.005, "1536x1024": 0.005 },
    medium: { "1024x1024": 0.053, "1024x1536": 0.041, "1536x1024": 0.041 },
    high: { "1024x1024": 0.211, "1024x1536": 0.165, "1536x1024": 0.165 },
  },
};

const GEMINI_IMAGE_COSTS: Partial<Record<string, number>> = {
  "imagen-4.0-fast-generate-001": 0.02,
  "imagen-4.0-generate-001": 0.04,
  "imagen-4.0-ultra-generate-001": 0.06,
  "imagen-3.0-generate-002": 0.03,
  "gemini-2.5-flash-image": 0.039,
};

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getProviderLabel(provider: CreatorLLMProvider): string {
  return provider === "gemini" ? "Gemini" : "OpenAI";
}

function toProviderErrorCode(provider: CreatorLLMProvider, status: number): string {
  if (status === 401 || status === 403) return `${provider}_auth_error`;
  if (status === 429) return `${provider}_rate_limited`;
  return `${provider}_image_request_failed`;
}

function toProviderErrorMessage(provider: CreatorLLMProvider, status: number, providerMessage: string): string {
  const label = getProviderLabel(provider);
  if (status === 401 || status === 403) return `${label} authentication failed. Check the API key saved in this browser.`;
  if (status === 429) return `${label} rejected the image request because of quota or rate limits.`;
  if (status >= 500) return `${label} image generation is temporarily unavailable. Please retry in a moment.`;
  return providerMessage || `${label} image generation failed (${status}).`;
}

function readStringField(record: LooseRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractProviderErrorDetails(payload: unknown): {
  providerErrorMessage: string;
  providerErrorType?: string;
  providerErrorCode?: string;
  providerErrorParam?: string;
} {
  if (typeof payload === "string") {
    return { providerErrorMessage: payload.slice(0, 400) };
  }

  const root = isRecord(payload) ? payload : undefined;
  const error = isRecord(root?.error) ? root.error : root;
  const providerErrorMessage =
    readStringField(error, "message") ??
    readStringField(error, "error_description") ??
    readStringField(error, "status") ??
    (payload == null ? "" : JSON.stringify(payload).slice(0, 400));

  return {
    providerErrorMessage,
    providerErrorType: readStringField(error, "type"),
    providerErrorCode: readStringField(error, "code"),
    providerErrorParam: readStringField(error, "param"),
  };
}

function mimeFromFormat(format: CreatorImageFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function makeImageId() {
  return randomUUID();
}

function normalizeUsage(payload: unknown): CreatorLLMUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  const usage = payload.usage;
  const promptTokens =
    typeof usage.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : undefined;
  const completionTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : undefined;
  const totalTokens =
    typeof usage.total_tokens === "number"
      ? usage.total_tokens
      : promptTokens != null || completionTokens != null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined;

  if (promptTokens == null && completionTokens == null && totalTokens == null) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function collectOpenAIImages(payload: unknown, outputFormat: CreatorImageFormat): CreatorGeneratedImage[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const mimeType = mimeFromFormat(outputFormat);
  return payload.data.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const b64 = typeof entry.b64_json === "string" ? entry.b64_json : "";
    if (!b64) return [];
    const id = makeImageId();
    return [
      {
        id,
        base64: b64,
        mimeType,
        filename: `ai-image-openai-${index + 1}-${id.slice(0, 8)}.${extensionFromMime(mimeType)}`,
        revisedPrompt: typeof entry.revised_prompt === "string" ? entry.revised_prompt : undefined,
      },
    ];
  });
}

function collectImagenImages(payload: unknown, outputFormat: CreatorImageFormat): CreatorGeneratedImage[] {
  const predictions = isRecord(payload) && Array.isArray(payload.predictions) ? payload.predictions : [];
  const generatedImages = isRecord(payload) && Array.isArray(payload.generatedImages) ? payload.generatedImages : [];
  const candidates = predictions.length > 0 ? predictions : generatedImages;
  return candidates.flatMap((entry, index) => {
    const record = isRecord(entry) ? entry : {};
    const imageRecord = isRecord(record.image) ? record.image : record;
    const b64 =
      typeof imageRecord.bytesBase64Encoded === "string"
        ? imageRecord.bytesBase64Encoded
        : typeof imageRecord.imageBytes === "string"
          ? imageRecord.imageBytes
          : typeof imageRecord.data === "string"
            ? imageRecord.data
            : "";
    if (!b64) return [];
    const mimeType =
      typeof imageRecord.mimeType === "string" ? imageRecord.mimeType : mimeFromFormat(outputFormat);
    const id = makeImageId();
    return [
      {
        id,
        base64: b64,
        mimeType,
        filename: `ai-image-google-${index + 1}-${id.slice(0, 8)}.${extensionFromMime(mimeType)}`,
        revisedPrompt: typeof record.raiFilteredReason === "string" ? record.raiFilteredReason : undefined,
      },
    ];
  });
}

function collectGeminiNativeImages(payload: unknown, outputFormat: CreatorImageFormat): CreatorGeneratedImage[] {
  const candidates = isRecord(payload) && Array.isArray(payload.candidates) ? payload.candidates : [];
  const images: CreatorGeneratedImage[] = [];
  for (const candidate of candidates) {
    const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : undefined;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      const inlineData = isRecord(part) && isRecord(part.inlineData) ? part.inlineData : undefined;
      const b64 = typeof inlineData?.data === "string" ? inlineData.data : "";
      if (!b64) continue;
      const mimeType = typeof inlineData?.mimeType === "string" ? inlineData.mimeType : mimeFromFormat(outputFormat);
      const id = makeImageId();
      images.push({
        id,
        base64: b64,
        mimeType,
        filename: `ai-image-gemini-${images.length + 1}-${id.slice(0, 8)}.${extensionFromMime(mimeType)}`,
      });
    }
  }
  return images;
}

export function resolveCreatorImageModelFamily(
  provider: CreatorLLMProvider,
  model: string
): CreatorImageModelFamily {
  return getCreatorImageModelOption(provider, model)?.family ?? (provider === "openai" ? "openai_image" : "google_imagen");
}

export function estimateCreatorImageCost(input: {
  provider: CreatorLLMProvider;
  model: string;
  size: string;
  quality: CreatorImageQuality;
  count: number;
}): { estimatedCostUsd: number | null; estimatedCostSource: CreatorLLMCostSource } {
  const quality = input.quality === "auto" ? "medium" : input.quality;
  if (input.provider === "openai") {
    const perImage = OPENAI_IMAGE_COSTS[input.model]?.[quality]?.[input.size];
    return perImage == null
      ? { estimatedCostUsd: null, estimatedCostSource: "unavailable" }
      : { estimatedCostUsd: Number((perImage * input.count).toFixed(6)), estimatedCostSource: "estimated" };
  }

  const perImage = GEMINI_IMAGE_COSTS[input.model];
  return perImage == null
    ? { estimatedCostUsd: null, estimatedCostSource: "unavailable" }
    : { estimatedCostUsd: Number((perImage * input.count).toFixed(6)), estimatedCostSource: "estimated" };
}

export async function requestCreatorImageProvider(input: {
  provider: CreatorLLMProvider;
  apiKey: string;
  model: string;
  prompt: string;
  request: CreatorImageGenerateRequest & {
    size: string;
    quality: CreatorImageQuality;
    outputFormat: CreatorImageFormat;
    count: number;
  };
  signal?: AbortSignal;
}): Promise<ProviderImageResult> {
  const startedAt = Date.now();
  const family = resolveCreatorImageModelFamily(input.provider, input.model);
  let response: Response;

  if (family === "openai_image") {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        n: input.request.count,
        size: input.request.size,
        quality: input.request.quality,
        output_format: input.request.outputFormat,
      }),
      cache: "no-store",
      signal: input.signal,
    });
  } else if (family === "google_gemini_image") {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input.prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
      cache: "no-store",
      signal: input.signal,
    });
  } else {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${input.model}:predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt: input.prompt }],
        parameters: {
          sampleCount: input.request.count,
          aspectRatio: input.request.aspectRatio,
        },
      }),
      cache: "no-store",
      signal: input.signal,
    });
  }

  const responseText = await response.text();
  const payload = safeJsonParse(responseText);
  const fetchDurationMs = Math.max(0, Date.now() - startedAt);

  if (!response.ok) {
    const providerDetails = extractProviderErrorDetails(payload);
    throw new CreatorAIError(toProviderErrorMessage(input.provider, response.status, providerDetails.providerErrorMessage), {
      status: response.status >= 500 ? 502 : response.status,
      code: toProviderErrorCode(input.provider, response.status),
      details: {
        provider: input.provider,
        providerStatus: response.status,
        ...providerDetails,
      },
    });
  }

  const images =
    family === "openai_image"
      ? collectOpenAIImages(payload, input.request.outputFormat)
      : family === "google_gemini_image"
        ? collectGeminiNativeImages(payload, input.request.outputFormat)
        : collectImagenImages(payload, input.request.outputFormat);

  if (images.length === 0) {
    throw new CreatorAIError(`${getProviderLabel(input.provider)} did not return an image payload.`, {
      status: 502,
      code: `invalid_${input.provider}_image_response`,
    });
  }

  return {
    images,
    payload,
    usage: normalizeUsage(payload),
    fetchDurationMs,
  };
}

export function imageRunPayload(input: {
  provider: CreatorLLMProvider;
  model: string;
  request: CreatorImageGenerateRequest & {
    size: string;
    quality: CreatorImageQuality;
    outputFormat: CreatorImageFormat;
    count: number;
  };
  prompt: string;
}): unknown {
  return {
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    count: input.request.count,
    size: input.request.size,
    quality: input.request.quality,
    outputFormat: input.request.outputFormat,
    aspectRatio: input.request.aspectRatio,
  };
}
