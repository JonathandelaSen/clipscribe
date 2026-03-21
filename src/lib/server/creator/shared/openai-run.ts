import { createHash, randomUUID } from "node:crypto";

import type {
  CreatorGenerationSourceInput,
  CreatorLLMFeature,
  CreatorLLMOperation,
  CreatorLLMRunInputSummary,
  CreatorLLMRunRecord,
  CreatorLLMUsage,
} from "../../../creator/types";
import { CreatorAIError } from "./errors";

type LooseRecord = Record<string, unknown>;

type OpenAIMessage = {
  role: "system" | "user";
  content: string;
};

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function extractAssistantText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const message = first.message;
  if (!isRecord(message)) return null;
  const content = message.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!isRecord(part)) return "";
        if (part.type !== "text") return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean);

    return textParts.length ? textParts.join("\n") : null;
  }

  return null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toOpenAIErrorMessage(status: number, providerMessage: string): string {
  try {
    const parsed = JSON.parse(providerMessage);
    if (parsed?.error?.message) {
      return `OpenAI API Error: ${parsed.error.message}`;
    }
  } catch {}

  if (status === 401) return "OpenAI authentication failed. Check the API key saved in this browser.";
  if (status === 429) return "OpenAI rejected the request because of quota or rate limits.";
  if (status >= 500) return "OpenAI is temporarily unavailable. Please retry in a moment.";
  return providerMessage || `OpenAI request failed (${status}).`;
}

function normalizeUsage(payload: unknown): CreatorLLMUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  const promptTokens = typeof payload.usage.prompt_tokens === "number" ? payload.usage.prompt_tokens : undefined;
  const completionTokens =
    typeof payload.usage.completion_tokens === "number" ? payload.usage.completion_tokens : undefined;
  const totalTokens = typeof payload.usage.total_tokens === "number" ? payload.usage.total_tokens : undefined;

  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

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

function estimateOpenAICostUsd(model: string, usage?: CreatorLLMUsage): number | null {
  void model;
  void usage;
  return null;
}

function buildRunRecord(input: {
  feature: CreatorLLMFeature;
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
  usage?: CreatorLLMUsage;
  status: CreatorLLMRunRecord["status"];
  errorCode?: string;
  errorMessage?: string;
}): CreatorLLMRunRecord {
  return {
    id: randomUUID(),
    feature: input.feature,
    provider: "openai",
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
    estimatedCostUsd: estimateOpenAICostUsd(input.model, input.usage),
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

export async function runTrackedOpenAIJson(input: {
  apiKey: string;
  model: string;
  temperature: number;
  messages: OpenAIMessage[];
  feature: CreatorLLMFeature;
  operation: CreatorLLMOperation;
  promptVersion: string;
  inputSummary: CreatorLLMRunInputSummary;
  requestFingerprint: string;
  projectId?: string;
  sourceAssetId?: string;
  sourceSignature?: string;
}): Promise<{ parsed: unknown; llmRun: CreatorLLMRunRecord; rawProviderPayload: unknown }> {
  const requestPayloadRaw = {
    model: input.model,
    temperature: input.temperature,
    response_format: { type: "json_object" as const },
    messages: input.messages,
  };
  const startedAt = Date.now();

  let responsePayloadRaw: unknown = null;
  let fetchDurationMs: number | undefined;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(requestPayloadRaw),
      cache: "no-store",
    });

    const fetchCompletedAt = Date.now();
    fetchDurationMs = Math.max(0, fetchCompletedAt - startedAt);
    const rawResponseText = await response.text();
    const completedAt = Date.now();
    responsePayloadRaw = safeJsonParse(rawResponseText) ?? rawResponseText;

    if (!response.ok) {
      const providerMessage = String(rawResponseText ?? "").slice(0, 400);
      const code =
        response.status === 401
          ? "openai_auth_error"
          : response.status === 429
            ? "openai_rate_limited"
            : "openai_request_failed";

      throw new CreatorAIError(toOpenAIErrorMessage(response.status, providerMessage), {
        status: response.status >= 500 ? 502 : response.status,
        code,
        trace: buildRunRecord({
          feature: input.feature,
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
          errorCode: code,
          errorMessage: toOpenAIErrorMessage(response.status, providerMessage),
        }),
      });
    }

    const assistantText = extractAssistantText(responsePayloadRaw);
    if (!assistantText) {
      throw new CreatorAIError("OpenAI response did not contain assistant content.", {
        status: 502,
        code: "invalid_openai_response",
        trace: buildRunRecord({
          feature: input.feature,
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
          status: "parse_error",
          errorCode: "invalid_openai_response",
          errorMessage: "OpenAI response did not contain assistant content.",
        }),
      });
    }

    const parseStartedAt = Date.now();
    const parsed = safeJsonParse(assistantText);
    const parseCompletedAt = Date.now();
    const parseDurationMs = Math.max(0, parseCompletedAt - parseStartedAt);

    if (!parsed) {
      throw new CreatorAIError("OpenAI returned malformed JSON.", {
        status: 502,
        code: "invalid_openai_response",
        trace: buildRunRecord({
          feature: input.feature,
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
          parsedOutputSnapshot: null,
          status: "parse_error",
          errorCode: "invalid_openai_response",
          errorMessage: "OpenAI returned malformed JSON.",
        }),
      });
    }

    return {
      parsed,
      rawProviderPayload: responsePayloadRaw,
      llmRun: buildRunRecord({
        feature: input.feature,
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
        usage: normalizeUsage(responsePayloadRaw),
        status: "success",
      }),
    };
  } catch (error) {
    if (error instanceof CreatorAIError) {
      throw error;
    }

    const completedAt = Date.now();
    const message = error instanceof Error ? error.message : "OpenAI request failed.";
    throw new CreatorAIError(message, {
      status: 502,
      code: "openai_request_failed",
      trace: buildRunRecord({
        feature: input.feature,
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
        errorCode: "openai_request_failed",
        errorMessage: message,
      }),
    });
  }
}
