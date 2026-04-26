import {
  CREATOR_DEFAULT_PROVIDER_BY_FEATURE,
  getCuratedCreatorImageModelOptions,
  getCuratedCreatorModelOptions,
  sanitizeCreatorModelSelection,
  sanitizeCreatorProvider,
} from "../../../creator/ai";
import type { CreatorGenerationConfig, CreatorLLMFeature, CreatorLLMProvider } from "../../../creator/types";

type FeatureConfigSpec = {
  providerEnvKey: string;
  modelEnvKeys: readonly string[];
  temperatureEnvKeys: readonly string[];
  defaultProvider: CreatorLLMProvider;
  allowedProviders: readonly CreatorLLMProvider[];
};

type CreatorFeatureEnvConfig = {
  feature: CreatorLLMFeature;
  provider: CreatorLLMProvider;
  defaultProvider: CreatorLLMProvider;
  allowedProviders: readonly CreatorLLMProvider[];
  defaultModel: string;
  temperature: number;
};

const FEATURE_CONFIG: Record<CreatorLLMFeature, FeatureConfigSpec> = {
  shorts: {
    providerEnvKey: "CREATOR_SHORTS_PROVIDER",
    modelEnvKeys: ["CREATOR_SHORTS_MODEL", "OPENAI_CREATOR_SHORTS_MODEL"],
    temperatureEnvKeys: ["CREATOR_SHORTS_TEMPERATURE", "OPENAI_CREATOR_SHORTS_TEMPERATURE"],
    defaultProvider: "gemini",
    allowedProviders: ["gemini", "openai"],
  },
  video_info: {
    providerEnvKey: "CREATOR_VIDEO_INFO_PROVIDER",
    modelEnvKeys: ["CREATOR_VIDEO_INFO_MODEL", "OPENAI_CREATOR_VIDEO_INFO_MODEL"],
    temperatureEnvKeys: ["CREATOR_VIDEO_INFO_TEMPERATURE", "OPENAI_CREATOR_VIDEO_INFO_TEMPERATURE"],
    defaultProvider: "gemini",
    allowedProviders: ["gemini", "openai"],
  },
  images: {
    providerEnvKey: "CREATOR_IMAGES_PROVIDER",
    modelEnvKeys: ["CREATOR_IMAGES_MODEL", "OPENAI_CREATOR_IMAGES_MODEL"],
    temperatureEnvKeys: ["CREATOR_IMAGES_TEMPERATURE", "OPENAI_CREATOR_IMAGES_TEMPERATURE"],
    defaultProvider: "openai",
    allowedProviders: ["openai", "gemini"],
  },
};

function readFirstEnvValue(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function readCreatorFeatureEnvConfig(
  feature: CreatorLLMFeature,
  requestedProvider?: CreatorLLMProvider
): CreatorFeatureEnvConfig {
  const spec = FEATURE_CONFIG[feature];
  const explicitProvider = sanitizeCreatorProvider(process.env[spec.providerEnvKey]);
  const envProviderCandidate = explicitProvider ?? spec.defaultProvider;
  const envProvider = spec.allowedProviders.includes(envProviderCandidate) ? envProviderCandidate : spec.defaultProvider;
  const provider = requestedProvider && spec.allowedProviders.includes(requestedProvider) ? requestedProvider : envProvider;
  const defaultProvider = CREATOR_DEFAULT_PROVIDER_BY_FEATURE[feature];
  const modelEnvKeys = (() => {
    if (provider !== envProvider) {
      return provider === "openai"
        ? spec.modelEnvKeys.filter((key) => key.startsWith("OPENAI_"))
        : [];
    }

    return provider === "openai"
      ? spec.modelEnvKeys
      : spec.modelEnvKeys.filter((key) => !key.startsWith("OPENAI_"));
  })();
  const defaultModel =
    sanitizeCreatorModelSelection(readFirstEnvValue(modelEnvKeys)) ??
    (feature === "images"
      ? getCuratedCreatorImageModelOptions(provider)[0]?.value
      : getCuratedCreatorModelOptions(provider)[0]?.value) ??
    "";
  const rawTemperature = readFirstEnvValue(spec.temperatureEnvKeys);
  const temperature = rawTemperature && !Number.isNaN(Number(rawTemperature)) ? Number(rawTemperature) : 0.4;

  return {
    feature,
    provider,
    defaultProvider,
    allowedProviders: spec.allowedProviders,
    defaultModel,
    temperature,
  };
}

export function resolveCreatorFeatureGenerationConfig(
  feature: CreatorLLMFeature,
  requestConfig?: CreatorGenerationConfig
): {
  provider: CreatorLLMProvider;
  model: string;
  temperature: number;
} {
  const envConfig = readCreatorFeatureEnvConfig(feature);
  const provider = sanitizeCreatorProvider(requestConfig?.provider) ?? envConfig.provider;
  const providerConfig = readCreatorFeatureEnvConfig(feature, provider);
  const model = sanitizeCreatorModelSelection(requestConfig?.model) ?? providerConfig.defaultModel;

  return {
    provider: providerConfig.provider,
    model,
    temperature: providerConfig.temperature,
  };
}
