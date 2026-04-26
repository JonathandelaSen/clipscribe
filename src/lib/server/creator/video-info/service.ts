import type {
  CreatorTracedResult,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
} from "../../../creator/types";
import { resolveCreatorProviderApiKey } from "../shared/api-key";
import { CreatorAIError } from "../shared/errors";
import { resolveCreatorFeatureGenerationConfig } from "../shared/feature-config";
import {
  buildBaseInputSummary,
  createCreatorLLMRequestFingerprint,
  runTrackedCreatorJson,
  withValidationErrorTrace,
} from "../shared/llm-runtime";
import { normalizeVideoInfoGenerateRequest } from "../shared/request-normalizers";
import { getRuntimeSeconds } from "../shared/transcript-format";
import { mapVideoInfoLlmResponse } from "./mapper";
import { buildVideoInfoPrompt, CREATOR_VIDEO_INFO_PROMPT_VERSION } from "./prompt";

export async function generateCreatorVideoInfo(
  input: CreatorVideoInfoGenerateRequest,
  options: { headers: Pick<Headers, "get">; signal?: AbortSignal }
): Promise<CreatorTracedResult<CreatorVideoInfoGenerateResponse>> {
  const request = normalizeVideoInfoGenerateRequest(input);
  const runtimeSeconds = getRuntimeSeconds(request);
  if (!request.transcriptChunks.length || runtimeSeconds <= 0) {
    throw new CreatorAIError("A timed transcript is required before running Creator AI.", {
      status: 422,
      code: "missing_timed_transcript",
    });
  }

  const resolvedConfig = resolveCreatorFeatureGenerationConfig("video_info", request.generationConfig);
  const { apiKey, apiKeySource } = resolveCreatorProviderApiKey(options.headers, resolvedConfig.provider);
  const { parsed, llmRun } = await runTrackedCreatorJson({
    apiKey,
    apiKeySource,
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    temperature: resolvedConfig.temperature,
    messages: [
      {
        role: "system",
        content: "You return strict JSON for creator tooling. Never include markdown.",
      },
      {
        role: "user",
        content: buildVideoInfoPrompt(request),
      },
    ],
    feature: "video_info",
    operation: "generate_video_info",
    promptVersion: CREATOR_VIDEO_INFO_PROMPT_VERSION,
    inputSummary: {
      ...buildBaseInputSummary(request),
      videoInfoBlocks: request.videoInfoBlocks?.slice(),
      metadataTarget: request.metadataTarget,
      focusedTranscriptChunkCount: request.focusedTranscriptChunks?.length,
      contextTranscriptChunkCount: request.contextTranscriptChunks?.length,
      contextTranscriptTruncated: request.contextTranscriptTruncated,
      promptCustomizationMode: request.promptCustomization?.mode ?? "default",
      promptCustomizationHash: request.promptCustomization?.hash,
      promptEditedSections: request.promptCustomization?.editedSections?.slice() ?? [],
    },
    requestFingerprint: createCreatorLLMRequestFingerprint({
      feature: "video_info",
      provider: resolvedConfig.provider,
      operation: "generate_video_info",
      request,
    }),
    projectId: request.projectId,
    sourceAssetId: request.sourceAssetId,
    sourceSignature: request.sourceSignature,
    signal: options.signal,
  });

  try {
    return {
      response: mapVideoInfoLlmResponse(request, parsed, resolvedConfig.provider, resolvedConfig.model),
      llmRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The provider returned invalid creator video info JSON.";
    throw new CreatorAIError(message, {
      status: 502,
      code: "invalid_provider_response",
      trace: withValidationErrorTrace(llmRun, message),
    });
  }
}
