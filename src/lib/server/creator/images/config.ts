import { getCuratedCreatorImageModelOptions, sanitizeCreatorProvider } from "../../../creator/ai";
import type { CreatorImageFeatureConfigResponse, CreatorLLMProvider } from "../../../creator/types";
import { resolveCreatorProviderApiKey } from "../shared/api-key";
import { readCreatorFeatureEnvConfig } from "../shared/feature-config";

function dedupeModels(models: CreatorImageFeatureConfigResponse["models"]): CreatorImageFeatureConfigResponse["models"] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.value)) return false;
    seen.add(model.value);
    return true;
  });
}

export async function loadCreatorImageFeatureConfig(
  headers: Pick<Headers, "get">,
  requestedProvider?: string
): Promise<CreatorImageFeatureConfigResponse> {
  const envConfig = readCreatorFeatureEnvConfig("images", sanitizeCreatorProvider(requestedProvider));
  const provider = envConfig.provider;
  const models = dedupeModels(getCuratedCreatorImageModelOptions(provider));
  let apiKeySource: CreatorImageFeatureConfigResponse["apiKeySource"];
  let hasApiKey = false;

  try {
    const resolvedApiKey = resolveCreatorProviderApiKey(headers, provider);
    apiKeySource = resolvedApiKey.apiKeySource;
    hasApiKey = true;
  } catch {}

  return {
    feature: "images",
    provider,
    defaultProvider: envConfig.defaultProvider,
    allowedProviders: [...envConfig.allowedProviders] as CreatorLLMProvider[],
    defaultModel: envConfig.defaultModel || models[0]?.value || "",
    models,
    modelSource: "catalog",
    hasApiKey,
    apiKeySource,
  };
}
