import {
  CREATOR_DEFAULT_PROVIDER_BY_FEATURE,
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
    defaultProvider: "openai",
    allowedProviders: ["openai"],
  },
};

function readFirstEnvValue(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function readCreatorFeatureEnvConfig(feature: CreatorLLMFeature): CreatorFeatureEnvConfig {
  const spec = FEATURE_CONFIG[feature];
  const explicitProvider = sanitizeCreatorProvider(process.env[spec.providerEnvKey]);
  const requestedProvider = explicitProvider ?? spec.defaultProvider;
  const provider = spec.allowedProviders.includes(requestedProvider) ? requestedProvider : spec.defaultProvider;
  const defaultProvider = CREATOR_DEFAULT_PROVIDER_BY_FEATURE[feature];
  const modelEnvKeys =
    provider === "openai"
      ? spec.modelEnvKeys
      : spec.modelEnvKeys.filter((key) => !key.startsWith("OPENAI_"));
  const defaultModel =
    sanitizeCreatorModelSelection(readFirstEnvValue(modelEnvKeys)) ??
    getCuratedCreatorModelOptions(provider)[0]?.value ??
    "";
  const rawTemperature = readFirstEnvValue(spec.temperatureEnvKeys);
  const temperature = rawTemperature && !Number.isNaN(Number(rawTemperature)) ? Number(rawTemperature) : 0.4;

  return {
    feature,
    provider,
    defaultProvider,
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
  const model = sanitizeCreatorModelSelection(requestConfig?.model) ?? envConfig.defaultModel;

  return {
    provider,
    model,
    temperature: envConfig.temperature,
  };
}
