import type {
  CreatorAIFeatureSettings,
  CreatorFeatureModelOption,
  CreatorImageModelOption,
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
  images: "openai",
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

const CURATED_CREATOR_IMAGE_MODEL_OPTIONS: Record<CreatorLLMProvider, CreatorImageModelOption[]> = {
  openai: [
    { value: "gpt-image-2", label: "GPT Image 2", provider: "openai", family: "openai_image", source: "catalog" },
    { value: "gpt-image-1.5", label: "GPT Image 1.5", provider: "openai", family: "openai_image", source: "catalog" },
    { value: "gpt-image-1-mini", label: "GPT Image 1 Mini", provider: "openai", family: "openai_image", source: "catalog" },
    { value: "gpt-image-1", label: "GPT Image 1", provider: "openai", family: "openai_image", source: "catalog" },
  ],
  gemini: [
    {
      value: "imagen-4.0-fast-generate-001",
      label: "Imagen 4 Fast",
      provider: "gemini",
      family: "google_imagen",
      source: "catalog",
    },
    {
      value: "imagen-4.0-generate-001",
      label: "Imagen 4",
      provider: "gemini",
      family: "google_imagen",
      source: "catalog",
    },
    {
      value: "imagen-4.0-ultra-generate-001",
      label: "Imagen 4 Ultra",
      provider: "gemini",
      family: "google_imagen",
      source: "catalog",
    },
    {
      value: "imagen-3.0-generate-002",
      label: "Imagen 3",
      provider: "gemini",
      family: "google_imagen",
      source: "catalog",
    },
    {
      value: "gemini-3.1-flash-image-preview",
      label: "Gemini 3.1 Flash Image",
      provider: "gemini",
      family: "google_gemini_image",
      source: "catalog",
    },
    {
      value: "gemini-3-pro-image-preview",
      label: "Gemini 3 Pro Image",
      provider: "gemini",
      family: "google_gemini_image",
      source: "catalog",
    },
    {
      value: "gemini-2.5-flash-image",
      label: "Gemini 2.5 Flash Image",
      provider: "gemini",
      family: "google_gemini_image",
      source: "catalog",
    },
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

export function getCuratedCreatorImageModelOptions(provider: CreatorLLMProvider): CreatorImageModelOption[] {
  return CURATED_CREATOR_IMAGE_MODEL_OPTIONS[provider].map((option) => ({ ...option }));
}

export function getCreatorImageModelOption(
  provider: CreatorLLMProvider,
  model: string
): CreatorImageModelOption | undefined {
  return CURATED_CREATOR_IMAGE_MODEL_OPTIONS[provider].find((option) => option.value === model);
}

export function getCreatorProviderLabel(provider: CreatorLLMProvider): string {
  return CREATOR_PROVIDER_LABELS[provider];
}

export function getCreatorPendingModelLabel(provider: CreatorLLMProvider): string {
  return `${getCreatorProviderLabel(provider)} pending`;
}
