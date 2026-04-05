import type {
  CreatorShortsGenerateRequest,
  CreatorShortsGenerateResponse,
  CreatorTracedResult,
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
import { normalizeShortsGenerateRequest } from "../shared/request-normalizers";
import { getRuntimeSeconds } from "../shared/transcript-format";
import { mapShortsLlmResponse } from "./mapper";
import { buildShortsPrompt, CREATOR_SHORTS_PROMPT_VERSION } from "./prompt";

export async function generateCreatorShorts(
  input: CreatorShortsGenerateRequest,
  options: { headers: Pick<Headers, "get">; signal?: AbortSignal }
): Promise<CreatorTracedResult<CreatorShortsGenerateResponse>> {
  const request = normalizeShortsGenerateRequest(input);
  const runtimeSeconds = getRuntimeSeconds(request);
  if (!request.transcriptChunks.length || runtimeSeconds <= 0) {
    throw new CreatorAIError("A timed transcript is required before running Creator AI.", {
      status: 422,
      code: "missing_timed_transcript",
    });
  }

  const resolvedConfig = resolveCreatorFeatureGenerationConfig("shorts", request.generationConfig);
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
        content: buildShortsPrompt(request),
      },
    ],
    feature: "shorts",
    operation: "generate_shorts",
    promptVersion: CREATOR_SHORTS_PROMPT_VERSION,
    inputSummary: {
      ...buildBaseInputSummary(request),
      niche: request.niche,
      audience: request.audience,
      tone: request.tone,
    },
    requestFingerprint: createCreatorLLMRequestFingerprint({
      feature: "shorts",
      provider: resolvedConfig.provider,
      operation: "generate_shorts",
      request,
    }),
    projectId: request.projectId,
    sourceAssetId: request.sourceAssetId,
    sourceSignature: request.sourceSignature,
    signal: options.signal,
  });

  try {
    return {
      response: mapShortsLlmResponse(request, parsed, resolvedConfig.provider, resolvedConfig.model),
      llmRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The provider returned invalid creator shorts JSON.";
    throw new CreatorAIError(message, {
      status: 502,
      code: "invalid_provider_response",
      trace: withValidationErrorTrace(llmRun, message),
    });
  }
}
