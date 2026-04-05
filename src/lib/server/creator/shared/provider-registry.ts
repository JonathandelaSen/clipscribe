import type {
  CreatorFeatureModelOption,
  CreatorLLMProvider,
  CreatorLLMUsage,
} from "../../../creator/types";
import { getCuratedCreatorModelOptions } from "../../../creator/ai";

type LooseRecord = Record<string, unknown>;

type ProviderPrice = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

const OPENAI_COMPAT_BASE_URLS: Record<CreatorLLMProvider, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const PROVIDER_PRICING: Partial<Record<CreatorLLMProvider, Partial<Record<string, ProviderPrice>>>> = {
  openai: {
    "gpt-4.1": { inputUsdPer1M: 2, outputUsdPer1M: 8 },
    "gpt-4.1-mini": { inputUsdPer1M: 0.4, outputUsdPer1M: 1.6 },
    "gpt-4.1-nano": { inputUsdPer1M: 0.1, outputUsdPer1M: 0.4 },
    "gpt-4o": { inputUsdPer1M: 2.5, outputUsdPer1M: 10 },
    "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  },
  gemini: {
    "gemini-2.5-flash": { inputUsdPer1M: 0.3, outputUsdPer1M: 2.5 },
    "gemini-2.5-flash-lite": { inputUsdPer1M: 0.1, outputUsdPer1M: 0.4 },
    "gemini-2.5-pro": { inputUsdPer1M: 1.25, outputUsdPer1M: 10 },
  },
};

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

export type CreatorRuntimeMessage = {
  role: "system" | "user";
  content: string;
};

export function extractOpenAICompatAssistantText(payload: unknown): string | null {
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

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizeOpenAICompatUsage(payload: unknown): CreatorLLMUsage | undefined {
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

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

export function estimateCreatorProviderCost(
  provider: CreatorLLMProvider,
  model: string,
  usage?: CreatorLLMUsage
): number | null {
  if (!usage) return null;
  if (!Number.isFinite(usage.promptTokens) || !Number.isFinite(usage.completionTokens)) return null;

  const normalizedModel = normalizeModelId(model);
  const pricingEntries = PROVIDER_PRICING[provider] ?? {};
  const pricing =
    pricingEntries[normalizedModel] ??
    Object.entries(pricingEntries).find(([candidate]) => normalizedModel.startsWith(candidate))?.[1];

  if (!pricing) return null;

  const promptCost = ((usage.promptTokens ?? 0) / 1_000_000) * pricing.inputUsdPer1M;
  const completionCost = ((usage.completionTokens ?? 0) / 1_000_000) * pricing.outputUsdPer1M;
  return Number((promptCost + completionCost).toFixed(6));
}

function toProviderErrorMessage(provider: CreatorLLMProvider, status: number, providerMessage: string): string {
  try {
    const parsed = JSON.parse(providerMessage);
    if (parsed?.error?.message) {
      return `${provider === "gemini" ? "Gemini" : "OpenAI"} API Error: ${parsed.error.message}`;
    }
  } catch {}

  const providerLabel = provider === "gemini" ? "Gemini" : "OpenAI";
  if (status === 401) return `${providerLabel} authentication failed. Check the API key saved in this browser.`;
  if (status === 429) return `${providerLabel} rejected the request because of quota or rate limits.`;
  if (status >= 500) return `${providerLabel} is temporarily unavailable. Please retry in a moment.`;
  return providerMessage || `${providerLabel} request failed (${status}).`;
}

function toModelLabel(modelId: string): string {
  return modelId
    .replace(/^models\//, "")
    .split("-")
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join(" ");
}

export async function requestOpenAICompatJson(input: {
  provider: CreatorLLMProvider;
  apiKey: string;
  model: string;
  temperature: number;
  messages: CreatorRuntimeMessage[];
  signal?: AbortSignal;
}): Promise<{ response: Response; responseText: string; payload: unknown }> {
  const response = await fetch(`${OPENAI_COMPAT_BASE_URLS[input.provider]}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.temperature,
      response_format: { type: "json_object" },
      messages: input.messages,
    }),
    cache: "no-store",
    signal: input.signal,
  });

  const responseText = await response.text();
  return {
    response,
    responseText,
    payload: safeJsonParse(responseText) ?? responseText,
  };
}

export async function listOpenAICompatModels(input: {
  provider: CreatorLLMProvider;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<CreatorFeatureModelOption[]> {
  const response = await fetch(`${OPENAI_COMPAT_BASE_URLS[input.provider]}/models`, {
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    cache: "no-store",
    signal: input.signal,
  });

  if (!response.ok) {
    const providerMessage = (await response.text()).slice(0, 400);
    throw new Error(toProviderErrorMessage(input.provider, response.status, providerMessage));
  }

  const payload = (await response.json()) as unknown;
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const values = data
    .flatMap((entry) => {
      const record = isRecord(entry) ? entry : null;
      const id = typeof record?.id === "string" ? record.id.trim() : "";
      return id ? [id] : [];
    })
    .filter((value) => !value.startsWith("omni-moderation") && !value.includes("embedding"));

  const uniqueValues = Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
  return uniqueValues.map((value) => ({
    value,
    label: toModelLabel(value),
    provider: input.provider,
    source: "provider",
  }));
}

export function getCreatorProviderFallbackModels(provider: CreatorLLMProvider): CreatorFeatureModelOption[] {
  return getCuratedCreatorModelOptions(provider);
}

export function toCreatorProviderErrorCode(
  provider: CreatorLLMProvider,
  status: number
): string {
  if (status === 401) return `${provider}_auth_error`;
  if (status === 429) return `${provider}_rate_limited`;
  return `${provider}_request_failed`;
}

export function toCreatorProviderErrorMessage(
  provider: CreatorLLMProvider,
  status: number,
  providerMessage: string
): string {
  return toProviderErrorMessage(provider, status, providerMessage);
}
