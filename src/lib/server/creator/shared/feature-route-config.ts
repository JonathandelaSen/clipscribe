import type { CreatorLLMFeature, CreatorTextFeatureConfigResponse } from "../../../creator/types";
import { resolveCreatorProviderApiKey } from "./api-key";
import { readCreatorFeatureEnvConfig } from "./feature-config";
import { getCreatorProviderFallbackModels, listOpenAICompatModels } from "./provider-registry";

function dedupeModels(
  defaultModel: string,
  models: CreatorTextFeatureConfigResponse["models"]
): CreatorTextFeatureConfigResponse["models"] {
  const seen = new Set<string>();
  const normalized = models.filter((model) => {
    if (seen.has(model.value)) return false;
    seen.add(model.value);
    return true;
  });

  if (defaultModel && !seen.has(defaultModel)) {
    normalized.unshift({
      value: defaultModel,
      label: defaultModel,
      provider: normalized[0]?.provider ?? "openai",
      source: "catalog",
    });
  }

  return normalized;
}

export async function loadCreatorTextFeatureConfig(
  feature: CreatorLLMFeature,
  headers: Pick<Headers, "get">,
  signal?: AbortSignal
): Promise<CreatorTextFeatureConfigResponse> {
  const envConfig = readCreatorFeatureEnvConfig(feature);
  const fallbackModels = getCreatorProviderFallbackModels(envConfig.provider);
  let apiKeySource: CreatorTextFeatureConfigResponse["apiKeySource"];
  let hasApiKey = false;

  try {
    const resolvedApiKey = resolveCreatorProviderApiKey(headers, envConfig.provider);
    const { apiKey } = resolvedApiKey;
    apiKeySource = resolvedApiKey.apiKeySource;
    hasApiKey = true;
    const providerModels = await listOpenAICompatModels({
      provider: envConfig.provider,
      apiKey,
      signal,
    });
    const models = dedupeModels(envConfig.defaultModel, [...providerModels, ...fallbackModels]);
    return {
      feature,
      provider: envConfig.provider,
      defaultProvider: envConfig.defaultProvider,
      defaultModel: envConfig.defaultModel,
      temperature: envConfig.temperature,
      models,
      modelSource: providerModels.length > 0 ? "mixed" : "catalog",
      hasApiKey,
      apiKeySource,
    };
  } catch {
    return {
      feature,
      provider: envConfig.provider,
      defaultProvider: envConfig.defaultProvider,
      defaultModel: envConfig.defaultModel,
      temperature: envConfig.temperature,
      models: dedupeModels(envConfig.defaultModel, fallbackModels),
      modelSource: "catalog",
      hasApiKey,
      apiKeySource,
    };
  }
}
