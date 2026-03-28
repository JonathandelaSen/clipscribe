import { useState } from "react";
import type { CreatorVideoInfoGenerateRequest, CreatorVideoInfoGenerateResponse } from "@/lib/creator/types";
import { buildPendingCreatorLlmRun } from "@/lib/creator/llm-run-pending";
import { CREATOR_OPENAI_API_KEY_HEADER } from "@/lib/creator/user-ai-settings";
import { postJson } from "@/hooks/creator-api";

const VIDEO_INFO_PENDING_PROMPT_VERSION = "creator-video-info-v4";

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
        {
          headers: options?.openAIApiKey
            ? {
                [CREATOR_OPENAI_API_KEY_HEADER]: options.openAIApiKey,
              }
            : undefined,
          pendingLlmRun: buildPendingCreatorLlmRun({
            feature: "video_info",
            operation: "generate_video_info",
            promptVersion: VIDEO_INFO_PENDING_PROMPT_VERSION,
            request: payload,
            inputSummary: {
              videoInfoBlocks: payload.videoInfoBlocks?.slice(),
              promptCustomizationMode: payload.promptCustomization?.mode ?? "default",
              promptCustomizationHash: payload.promptCustomization?.hash,
              promptEditedSections: payload.promptCustomization?.editedSections?.slice() ?? [],
            },
          }),
        }
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
