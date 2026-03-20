import { useState } from "react";
import type { CreatorVideoInfoGenerateRequest, CreatorVideoInfoGenerateResponse } from "@/lib/creator/types";
import { CREATOR_OPENAI_API_KEY_HEADER } from "@/lib/creator/user-ai-settings";
import { postJson } from "@/hooks/creator-api";

export function useCreatorVideoInfoGenerator() {
  const [videoInfoAnalysis, setVideoInfoAnalysis] = useState<CreatorVideoInfoGenerateResponse | null>(null);
  const [isGeneratingVideoInfo, setIsGeneratingVideoInfo] = useState(false);
  const [videoInfoError, setVideoInfoError] = useState<string | null>(null);

  const generateVideoInfo = async (payload: CreatorVideoInfoGenerateRequest, options?: { openAIApiKey?: string }) => {
    setIsGeneratingVideoInfo(true);
    setVideoInfoError(null);
    try {
      const result = await postJson<CreatorVideoInfoGenerateResponse>(
        "/api/creator/video-info/generate",
        payload,
        options?.openAIApiKey
          ? {
              [CREATOR_OPENAI_API_KEY_HEADER]: options.openAIApiKey,
            }
          : undefined
      );
      setVideoInfoAnalysis(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video info generation failed";
      setVideoInfoError(message);
      throw error;
    } finally {
      setIsGeneratingVideoInfo(false);
    }
  };

  return {
    videoInfoAnalysis,
    setVideoInfoAnalysis,
    isGeneratingVideoInfo,
    videoInfoError,
    generateVideoInfo,
  };
}
