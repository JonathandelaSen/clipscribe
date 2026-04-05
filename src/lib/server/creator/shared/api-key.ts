import {
  CREATOR_GEMINI_API_KEY_HEADER,
  CREATOR_OPENAI_API_KEY_HEADER,
} from "../../../creator/user-ai-settings";
import type { CreatorLLMApiKeySource, CreatorLLMProvider } from "../../../creator/types";
import { CreatorAIError } from "./errors";

function readFirstEnvValue(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export function readCreatorOpenAIApiKeyFromEnv(): string {
  return readFirstEnvValue(["CREATOR_OPENAI_API_KEY", "OPENAI_API_KEY"]);
}

export function readCreatorGeminiApiKeyFromEnv(): string {
  return readFirstEnvValue(["CREATOR_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]);
}

export function resolveCreatorProviderApiKey(
  headers: Pick<Headers, "get">,
  provider: CreatorLLMProvider
): { apiKey: string; apiKeySource: CreatorLLMApiKeySource } {
  if (provider === "openai") {
    const headerApiKey = headers.get(CREATOR_OPENAI_API_KEY_HEADER)?.trim() ?? "";
    if (headerApiKey) {
      return {
        apiKey: headerApiKey,
        apiKeySource: "header",
      };
    }

    const envApiKey = readCreatorOpenAIApiKeyFromEnv();
    if (envApiKey) {
      return {
        apiKey: envApiKey,
        apiKeySource: "env",
      };
    }

    throw new CreatorAIError("OpenAI API key missing. Save it in Creator settings or set OPENAI_API_KEY.", {
      status: 401,
      code: "missing_openai_api_key",
    });
  }

  const headerApiKey = headers.get(CREATOR_GEMINI_API_KEY_HEADER)?.trim() ?? "";
  if (headerApiKey) {
    return {
      apiKey: headerApiKey,
      apiKeySource: "header",
    };
  }

  const envApiKey = readCreatorGeminiApiKeyFromEnv();
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      apiKeySource: "env",
    };
  }

  throw new CreatorAIError("Gemini API key missing. Save it in Creator settings or set GEMINI_API_KEY.", {
    status: 401,
    code: "missing_gemini_api_key",
  });
}
