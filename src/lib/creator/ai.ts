import type {
  CreatorAIFeatureSettings,
  CreatorFeatureModelOption,
  CreatorLLMFeature,
  CreatorLLMProvider,
} from "./types";

export const CREATOR_PROVIDER_LABELS: Record<CreatorLLMProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
};

export const CREATOR_DEFAULT_PROVIDER_BY_FEATURE: Record<CreatorLLMFeature, CreatorLLMProvider> = {
  shorts: "gemini",
  video_info: "gemini",
};

const CURATED_CREATOR_MODEL_OPTIONS: Record<CreatorLLMProvider, CreatorFeatureModelOption[]> = {
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", source: "catalog" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", provider: "gemini", source: "catalog" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini", source: "catalog" },
  ],
  openai: [
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", source: "catalog" },
    { value: "gpt-4.1", label: "GPT-4.1", provider: "openai", source: "catalog" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", source: "catalog" },
  ],
};

export function sanitizeCreatorProvider(value: unknown): CreatorLLMProvider | undefined {
  return value === "openai" || value === "gemini" ? value : undefined;
}

export function sanitizeCreatorModelSelection(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function sanitizeCreatorFeatureSettings(
  value: unknown,
  feature: CreatorLLMFeature
): CreatorAIFeatureSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const provider = sanitizeCreatorProvider(record.provider) ?? CREATOR_DEFAULT_PROVIDER_BY_FEATURE[feature];
  const model = sanitizeCreatorModelSelection(record.model);

  if (!provider && !model) {
    return undefined;
  }

  return {
    provider,
    model,
  };
}

export function getCuratedCreatorModelOptions(provider: CreatorLLMProvider): CreatorFeatureModelOption[] {
  return CURATED_CREATOR_MODEL_OPTIONS[provider].map((option) => ({ ...option }));
}

export function getCreatorProviderLabel(provider: CreatorLLMProvider): string {
  return CREATOR_PROVIDER_LABELS[provider];
}

export function getCreatorPendingModelLabel(provider: CreatorLLMProvider): string {
  return `${getCreatorProviderLabel(provider)} pending`;
}
