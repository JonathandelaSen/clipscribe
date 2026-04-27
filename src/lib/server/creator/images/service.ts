import { randomUUID } from "node:crypto";

import { getCuratedCreatorImageModelOptions, getCreatorImageModelOption } from "../../../creator/ai";
import type {
  CreatorImageAspectRatio,
  CreatorImageFormat,
  CreatorImageGenerateRequest,
  CreatorImageGenerateResponse,
  CreatorImageQuality,
  CreatorLLMRunInputSummary,
  CreatorLLMRunRecord,
  CreatorLLMRunStatus,
  CreatorTracedResult,
} from "../../../creator/types";
import { resolveCreatorProviderApiKey } from "../shared/api-key";
import { CreatorAIError } from "../shared/errors";
import { resolveCreatorFeatureGenerationConfig } from "../shared/feature-config";
import { createCreatorLLMRequestFingerprint } from "../shared/llm-runtime";
import { normalizeImageGenerateRequest } from "../shared/request-normalizers";
import { buildCreatorImagePrompt, CREATOR_IMAGES_PROMPT_VERSION } from "./prompt";
import {
  estimateCreatorImageCost,
  imageRunPayload,
  requestCreatorImageProvider,
  resolveCreatorImageModelFamily,
} from "./provider-runtime";

function resolveImageSize(input: {
  provider: "openai" | "gemini";
  model: string;
  aspectRatio: CreatorImageAspectRatio;
  requestedSize?: string;
}): string {
  if (input.requestedSize) return input.requestedSize;
  if (input.provider === "openai") {
    if (input.aspectRatio === "16:9") return "1536x1024";
    if (input.aspectRatio === "9:16" || input.aspectRatio === "3:4" || input.aspectRatio === "4:5") return "1024x1536";
    return "1024x1024";
  }
  return input.aspectRatio;
}

function resolveImageModel(provider: "openai" | "gemini", model: string): string {
  const modelOption = getCreatorImageModelOption(provider, model);
  if (modelOption) return model;
  return getCuratedCreatorImageModelOptions(provider)[0]?.value ?? model;
}

function summarizeResponsePayload(images: CreatorImageGenerateResponse["images"], payload: unknown): unknown {
  return {
    imageCount: images.length,
    images: images.map((image) => ({
      id: image.id,
      mimeType: image.mimeType,
      filename: image.filename,
      width: image.width,
      height: image.height,
      hasBase64: Boolean(image.base64),
      revisedPrompt: image.revisedPrompt,
    })),
    providerPayloadType: payload && typeof payload === "object" ? "object" : typeof payload,
  };
}

function buildImageRunRecord(input: {
  provider: CreatorLLMRunRecord["provider"];
  operation: CreatorLLMRunRecord["operation"];
  model: string;
  projectId?: string;
  startedAt: number;
  completedAt: number;
  fetchDurationMs?: number;
  status: CreatorLLMRunStatus;
  requestFingerprint: string;
  inputSummary: CreatorLLMRunInputSummary;
  requestPayloadRaw: unknown | null;
  responsePayloadRaw: unknown | null;
  parsedOutputSnapshot: unknown | null;
  usage?: CreatorLLMRunRecord["usage"];
  apiKeySource?: CreatorLLMRunRecord["apiKeySource"];
  errorCode?: string;
  errorMessage?: string;
  estimatedCostUsd?: number | null;
  estimatedCostSource?: CreatorLLMRunRecord["estimatedCostSource"];
}): CreatorLLMRunRecord {
  return {
    id: randomUUID(),
    feature: "images",
    provider: input.provider,
    operation: input.operation,
    model: input.model,
    projectId: input.projectId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    fetchDurationMs: input.fetchDurationMs,
    status: input.status,
    temperature: 0,
    requestFingerprint: input.requestFingerprint,
    promptVersion: CREATOR_IMAGES_PROMPT_VERSION,
    inputSummary: input.inputSummary,
    usage: input.usage,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    estimatedCostSource: input.estimatedCostSource ?? "unavailable",
    apiKeySource: input.apiKeySource,
    requestPayloadRaw: input.requestPayloadRaw,
    responsePayloadRaw: input.responsePayloadRaw,
    parsedOutputSnapshot: input.parsedOutputSnapshot,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    redactionState: "raw",
    exportable: true,
    containsRawPayload: false,
  };
}

export async function generateCreatorImages(
  input: CreatorImageGenerateRequest,
  options: { headers: Pick<Headers, "get">; signal?: AbortSignal }
): Promise<CreatorTracedResult<CreatorImageGenerateResponse>> {
  const request = normalizeImageGenerateRequest(input);
  if (!request.prompt) {
    throw new CreatorAIError("Image prompt is required before generating images.", {
      status: 422,
      code: "missing_image_prompt",
    });
  }

  const resolvedConfig = resolveCreatorFeatureGenerationConfig("images", request.generationConfig);
  const provider = resolvedConfig.provider;
  const model = resolveImageModel(provider, resolvedConfig.model);
  const { apiKey, apiKeySource } = resolveCreatorProviderApiKey(options.headers, provider);
  const prompt = buildCreatorImagePrompt(request, { provider });
  const count = request.count ?? 1;
  const quality: CreatorImageQuality = request.quality ?? "auto";
  const outputFormat: CreatorImageFormat = request.outputFormat ?? "png";
  const size = resolveImageSize({
    provider,
    model,
    aspectRatio: request.aspectRatio ?? "1:1",
    requestedSize: request.size,
  });
  const requestWithResolvedOutput = {
    ...request,
    count,
    quality,
    outputFormat,
    size,
  };
  const requestPayloadRaw = imageRunPayload({
    provider,
    model,
    request: requestWithResolvedOutput,
    prompt,
  });
  const requestFingerprint = createCreatorLLMRequestFingerprint({
    feature: "images",
    provider,
    operation: "generate_image",
    request: requestWithResolvedOutput,
    prompt,
  });
  const estimatedCost = estimateCreatorImageCost({
    provider,
    model,
    size,
    quality,
    count,
  });
  const inputSummary: CreatorLLMRunInputSummary = {
    projectId: request.projectId,
    transcriptCharCount: 0,
    transcriptChunkCount: 0,
    subtitleChunkCount: 0,
    promptCustomizationMode: request.promptCustomization?.mode ?? "default",
    promptCustomizationHash: request.promptCustomization?.hash,
    promptEditedSections: request.promptCustomization?.editedSections?.slice() ?? [],
    imagePromptCharCount: request.prompt.length,
    imageAspectRatio: request.aspectRatio ?? "1:1",
    imageSize: size,
    imageQuality: quality,
    imageFormat: outputFormat,
    imageCount: count,
  };
  const startedAt = Date.now();

  try {
    const providerResult = await requestCreatorImageProvider({
      provider,
      apiKey,
      model,
      prompt,
      request: requestWithResolvedOutput,
      signal: options.signal,
    });
    const completedAt = Date.now();
    const response: CreatorImageGenerateResponse = {
      ok: true,
      providerMode: provider,
      model,
      generatedAt: completedAt,
      runtimeSeconds: Math.max(0, (completedAt - startedAt) / 1000),
      prompt: request.prompt,
      promptPreview: prompt,
      aspectRatio: request.aspectRatio ?? "1:1",
      size,
      quality,
      outputFormat,
      images: providerResult.images,
    };
    return {
      response,
      llmRun: buildImageRunRecord({
        provider,
        operation: "generate_image",
        model,
        projectId: request.projectId,
        startedAt,
        completedAt,
        fetchDurationMs: providerResult.fetchDurationMs,
        status: "success",
        requestFingerprint,
        inputSummary,
        requestPayloadRaw,
        responsePayloadRaw: summarizeResponsePayload(response.images, providerResult.payload),
        parsedOutputSnapshot: {
          imageCount: response.images.length,
          family: resolveCreatorImageModelFamily(provider, model),
        },
        usage: providerResult.usage,
        apiKeySource,
        estimatedCostUsd: estimatedCost.estimatedCostUsd,
        estimatedCostSource: estimatedCost.estimatedCostSource,
      }),
    };
  } catch (error) {
    if (error instanceof CreatorAIError) {
      const completedAt = Date.now();
      throw new CreatorAIError(error.message, {
        status: error.status,
        code: error.code,
        details: error.details,
        trace: buildImageRunRecord({
          provider,
          operation: "generate_image",
          model,
          projectId: request.projectId,
          startedAt,
          completedAt,
          status: "provider_error",
          requestFingerprint,
          inputSummary,
          requestPayloadRaw,
          responsePayloadRaw: null,
          parsedOutputSnapshot: null,
          apiKeySource,
          errorCode: error.code,
          errorMessage: error.message,
          estimatedCostUsd: null,
          estimatedCostSource: "unavailable",
        }),
      });
    }
    throw error;
  }
}
