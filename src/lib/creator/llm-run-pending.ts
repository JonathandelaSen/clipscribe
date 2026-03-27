import type {
  CreatorGenerationSourceInput,
  CreatorLLMFeature,
  CreatorLLMOperation,
  CreatorLLMRunInputSummary,
  CreatorLLMRunRecord,
} from "@/lib/creator/types";

function makeRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildCreatorLlmRunInputSummary(
  input: CreatorGenerationSourceInput
): CreatorLLMRunInputSummary {
  return {
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    sourceSignature: input.sourceSignature,
    transcriptVersionLabel: input.transcriptVersionLabel,
    subtitleVersionLabel: input.subtitleVersionLabel,
    transcriptCharCount: input.transcriptText.length,
    transcriptChunkCount: input.transcriptChunks.length,
    subtitleChunkCount: input.subtitleChunks?.length ?? 0,
  };
}

export function buildPendingCreatorLlmRun(input: {
  feature: CreatorLLMFeature;
  operation: CreatorLLMOperation;
  promptVersion: string;
  request: CreatorGenerationSourceInput;
  inputSummary?: Partial<CreatorLLMRunInputSummary>;
}): CreatorLLMRunRecord {
  const now = Date.now();
  return {
    id: makeRunId(),
    feature: input.feature,
    provider: "openai",
    operation: input.operation,
    model: "OpenAI pending",
    projectId: input.request.projectId,
    sourceAssetId: input.request.sourceAssetId,
    sourceSignature: input.request.sourceSignature,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    status: "queued",
    temperature: 0,
    requestFingerprint: `pending:${input.feature}:${now}`,
    promptVersion: input.promptVersion,
    inputSummary: {
      ...buildCreatorLlmRunInputSummary(input.request),
      ...input.inputSummary,
    },
    estimatedCostUsd: null,
    requestPayloadRaw: null,
    responsePayloadRaw: null,
    parsedOutputSnapshot: null,
    redactionState: "raw",
    exportable: false,
    containsRawPayload: false,
  };
}

export function markCreatorLlmRunProcessing(run: CreatorLLMRunRecord): CreatorLLMRunRecord {
  const completedAt = Date.now();
  return {
    ...run,
    status: "processing",
    completedAt,
    durationMs: Math.max(0, completedAt - run.startedAt),
  };
}

export function markCreatorLlmRunRequestFailed(
  run: CreatorLLMRunRecord,
  message: string
): CreatorLLMRunRecord {
  const completedAt = Date.now();
  return {
    ...run,
    status: "provider_error",
    completedAt,
    durationMs: Math.max(0, completedAt - run.startedAt),
    errorCode: "request_failed_before_response",
    errorMessage: message,
  };
}
