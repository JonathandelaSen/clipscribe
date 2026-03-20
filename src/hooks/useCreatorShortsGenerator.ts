import { useState } from "react";
import type { CreatorShortsGenerateRequest, CreatorShortsGenerateResponse } from "@/lib/creator/types";
import { CREATOR_OPENAI_API_KEY_HEADER } from "@/lib/creator/user-ai-settings";
import { postJson } from "@/hooks/creator-api";

export function useCreatorShortsGenerator() {
  const [shortsAnalysis, setShortsAnalysis] = useState<CreatorShortsGenerateResponse | null>(null);
  const [isGeneratingShorts, setIsGeneratingShorts] = useState(false);
  const [shortsError, setShortsError] = useState<string | null>(null);

  const generateShorts = async (payload: CreatorShortsGenerateRequest, options?: { openAIApiKey?: string }) => {
    setIsGeneratingShorts(true);
    setShortsError(null);
    try {
      const result = await postJson<CreatorShortsGenerateResponse>(
        "/api/creator/shorts/generate",
        payload,
        options?.openAIApiKey
          ? {
              [CREATOR_OPENAI_API_KEY_HEADER]: options.openAIApiKey,
            }
          : undefined
      );
      setShortsAnalysis(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shorts generation failed";
      setShortsError(message);
      throw error;
    } finally {
      setIsGeneratingShorts(false);
    }
  };

  return {
    shortsAnalysis,
    setShortsAnalysis,
    isGeneratingShorts,
    shortsError,
    generateShorts,
  };
}
