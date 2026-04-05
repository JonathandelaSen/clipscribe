import { createHash, randomUUID } from "node:crypto";

import type {
  CreatorGenerationSourceInput,
  CreatorLLMFeature,
  CreatorLLMOperation,
  CreatorLLMRunInputSummary,
  CreatorLLMRunRecord,
} from "../../../creator/types";
import { CreatorAIError } from "./errors";
import {
  estimateCreatorProviderCost,
  extractOpenAICompatAssistantText,
  normalizeOpenAICompatUsage,
  requestOpenAICompatJson,
  safeJsonParse,
  toCreatorProviderErrorCode,
  toCreatorProviderErrorMessage,
  type CreatorRuntimeMessage,
} from "./provider-registry";

export function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createCreatorLLMRequestFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

export function buildBaseInputSummary(input: CreatorGenerationSourceInput): CreatorLLMRunInputSummary {
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

function compactPreview(value: string, maxLength = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function buildInvalidJsonResponseMessage(provider: CreatorLLMRunRecord["provider"], assistantText: string): string {
  const providerLabel = provider === "gemini" ? "Gemini" : "OpenAI";
  const mmssMatch = assistantText.match(/:\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (mmssMatch?.[1]) {
    return `${providerLabel} returned invalid JSON. It appears to have used a timestamp like "${mmssMatch[1]}" instead of a numeric seconds value.`;
  }

  return `${providerLabel} returned malformed JSON. Preview: ${compactPreview(assistantText)}`;
}

function buildRunRecord(input: {
  feature: CreatorLLMFeature;
  provider: CreatorLLMRunRecord["provider"];
  operation: CreatorLLMOperation;
  model: string;
  projectId?: string;
  sourceAssetId?: string;
  sourceSignature?: string;
  startedAt: number;
  completedAt: number;
  fetchDurationMs?: number;
  parseDurationMs?: number;
  temperature: number;
  requestFingerprint: string;
  promptVersion: string;
  inputSummary: CreatorLLMRunInputSummary;
  requestPayloadRaw: unknown | null;
  responsePayloadRaw: unknown | null;
  parsedOutputSnapshot: unknown | null;
  usage?: CreatorLLMRunRecord["usage"];
  status: CreatorLLMRunRecord["status"];
  apiKeySource?: CreatorLLMRunRecord["apiKeySource"];
  errorCode?: string;
  errorMessage?: string;
}): CreatorLLMRunRecord {
  const estimatedCostUsd = estimateCreatorProviderCost(input.provider, input.model, input.usage);

  return {
    id: randomUUID(),
    feature: input.feature,
    provider: input.provider,
    operation: input.operation,
    model: input.model,
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    sourceSignature: input.sourceSignature,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    fetchDurationMs: input.fetchDurationMs,
    parseDurationMs: input.parseDurationMs,
    status: input.status,
    temperature: input.temperature,
    requestFingerprint: input.requestFingerprint,
    promptVersion: input.promptVersion,
    inputSummary: input.inputSummary,
    usage: input.usage,
    estimatedCostUsd,
    estimatedCostSource: estimatedCostUsd == null ? "unavailable" : "estimated",
    apiKeySource: input.apiKeySource,
    requestPayloadRaw: input.requestPayloadRaw,
    responsePayloadRaw: input.responsePayloadRaw,
    parsedOutputSnapshot: input.parsedOutputSnapshot,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    redactionState: "raw",
    exportable: true,
    containsRawPayload: true,
  };
}

export function withValidationErrorTrace(
  llmRun: CreatorLLMRunRecord,
  message: string,
  errorCode = "validation_error"
): CreatorLLMRunRecord {
  return {
    ...llmRun,
    status: "validation_error",
    errorCode,
    errorMessage: message,
  };
}

export async function runTrackedCreatorJson(input: {
  apiKey: string;
  apiKeySource: CreatorLLMRunRecord["apiKeySource"];
  provider: CreatorLLMRunRecord["provider"];
  model: string;
  temperature: number;
  messages: CreatorRuntimeMessage[];
  feature: CreatorLLMFeature;
  operation: CreatorLLMOperation;
  promptVersion: string;
  inputSummary: CreatorLLMRunInputSummary;
  requestFingerprint: string;
  projectId?: string;
  sourceAssetId?: string;
  sourceSignature?: string;
  signal?: AbortSignal;
}): Promise<{ parsed: unknown; llmRun: CreatorLLMRunRecord; rawProviderPayload: unknown }> {
  const requestPayloadRaw = {
    provider: input.provider,
    model: input.model,
    temperature: input.temperature,
    response_format: { type: "json_object" as const },
    messages: input.messages,
  };
  const startedAt = Date.now();

  let responsePayloadRaw: unknown = null;
  let fetchDurationMs: number | undefined;

  try {
    const { response, responseText, payload } = await requestOpenAICompatJson({
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      temperature: input.temperature,
      messages: input.messages,
      signal: input.signal,
    });

    const fetchCompletedAt = Date.now();
    fetchDurationMs = Math.max(0, fetchCompletedAt - startedAt);
    responsePayloadRaw = payload;

    if (!response.ok) {
      const providerMessage = String(responseText ?? "").slice(0, 400);
      const code = toCreatorProviderErrorCode(input.provider, response.status);
      const message = toCreatorProviderErrorMessage(input.provider, response.status, providerMessage);

      throw new CreatorAIError(message, {
        status: response.status >= 500 ? 502 : response.status,
        code,
        trace: buildRunRecord({
          feature: input.feature,
          provider: input.provider,
          operation: input.operation,
          model: input.model,
          projectId: input.projectId,
          sourceAssetId: input.sourceAssetId,
          sourceSignature: input.sourceSignature,
          startedAt,
          completedAt: fetchCompletedAt,
          fetchDurationMs,
          temperature: input.temperature,
          requestFingerprint: input.requestFingerprint,
          promptVersion: input.promptVersion,
          inputSummary: input.inputSummary,
          requestPayloadRaw,
          responsePayloadRaw,
          parsedOutputSnapshot: null,
          status: "provider_error",
          apiKeySource: input.apiKeySource,
          errorCode: code,
          errorMessage: message,
        }),
      });
    }

    const parseStartedAt = Date.now();
    const assistantText = extractOpenAICompatAssistantText(responsePayloadRaw);
    if (!assistantText) {
      throw new CreatorAIError(`${input.provider === "gemini" ? "Gemini" : "OpenAI"} response did not contain assistant content.`, {
        status: 502,
        code: `invalid_${input.provider}_response`,
        trace: buildRunRecord({
          feature: input.feature,
          provider: input.provider,
          operation: input.operation,
          model: input.model,
          projectId: input.projectId,
          sourceAssetId: input.sourceAssetId,
          sourceSignature: input.sourceSignature,
          startedAt,
          completedAt: Date.now(),
          fetchDurationMs,
          temperature: input.temperature,
          requestFingerprint: input.requestFingerprint,
          promptVersion: input.promptVersion,
          inputSummary: input.inputSummary,
          requestPayloadRaw,
          responsePayloadRaw,
          parsedOutputSnapshot: null,
          usage: normalizeOpenAICompatUsage(responsePayloadRaw),
          status: "parse_error",
          apiKeySource: input.apiKeySource,
          errorCode: `invalid_${input.provider}_response`,
          errorMessage: `${input.provider === "gemini" ? "Gemini" : "OpenAI"} response did not contain assistant content.`,
        }),
      });
    }

    const parsed = safeJsonParse(assistantText);
    if (!parsed) {
      const invalidJsonMessage = buildInvalidJsonResponseMessage(input.provider, assistantText);
      throw new CreatorAIError(invalidJsonMessage, {
        status: 502,
        code: `invalid_${input.provider}_response`,
        trace: buildRunRecord({
          feature: input.feature,
          provider: input.provider,
          operation: input.operation,
          model: input.model,
          projectId: input.projectId,
          sourceAssetId: input.sourceAssetId,
          sourceSignature: input.sourceSignature,
          startedAt,
          completedAt: Date.now(),
          fetchDurationMs,
          parseDurationMs: Math.max(0, Date.now() - parseStartedAt),
          temperature: input.temperature,
          requestFingerprint: input.requestFingerprint,
          promptVersion: input.promptVersion,
          inputSummary: input.inputSummary,
          requestPayloadRaw,
          responsePayloadRaw,
          parsedOutputSnapshot: null,
          usage: normalizeOpenAICompatUsage(responsePayloadRaw),
          status: "parse_error",
          apiKeySource: input.apiKeySource,
          errorCode: `invalid_${input.provider}_response`,
          errorMessage: invalidJsonMessage,
        }),
      });
    }

    const completedAt = Date.now();
    const parseDurationMs = Math.max(0, completedAt - parseStartedAt);
    const usage = normalizeOpenAICompatUsage(responsePayloadRaw);
    const llmRun = buildRunRecord({
      feature: input.feature,
      provider: input.provider,
      operation: input.operation,
      model: input.model,
      projectId: input.projectId,
      sourceAssetId: input.sourceAssetId,
      sourceSignature: input.sourceSignature,
      startedAt,
      completedAt,
      fetchDurationMs,
      parseDurationMs,
      temperature: input.temperature,
      requestFingerprint: input.requestFingerprint,
      promptVersion: input.promptVersion,
      inputSummary: input.inputSummary,
      requestPayloadRaw,
      responsePayloadRaw,
      parsedOutputSnapshot: parsed,
      usage,
      status: "success",
      apiKeySource: input.apiKeySource,
    });

    return {
      parsed,
      llmRun,
      rawProviderPayload: responsePayloadRaw,
    };
  } catch (error) {
    if (error instanceof CreatorAIError) {
      throw error;
    }

    const completedAt = Date.now();
    const message = error instanceof Error ? error.message : "Creator provider request failed.";
    throw new CreatorAIError(message, {
      status: 502,
      code: `${input.provider}_request_failed`,
      trace: buildRunRecord({
        feature: input.feature,
        provider: input.provider,
        operation: input.operation,
        model: input.model,
        projectId: input.projectId,
        sourceAssetId: input.sourceAssetId,
        sourceSignature: input.sourceSignature,
        startedAt,
        completedAt,
        fetchDurationMs,
        temperature: input.temperature,
        requestFingerprint: input.requestFingerprint,
        promptVersion: input.promptVersion,
        inputSummary: input.inputSummary,
        requestPayloadRaw,
        responsePayloadRaw,
        parsedOutputSnapshot: null,
        status: "provider_error",
        apiKeySource: input.apiKeySource,
        errorCode: `${input.provider}_request_failed`,
        errorMessage: message,
      }),
    });
  }
}
