import { useState } from "react";
import type { CreatorVideoInfoGenerateRequest, CreatorVideoInfoGenerateResponse } from "@/lib/creator/types";
import { buildPendingCreatorLlmRun } from "@/lib/creator/llm-run-pending";
import { postJson } from "@/hooks/creator-api";

const VIDEO_INFO_PENDING_PROMPT_VERSION = "creator-video-info-v4";

export function useCreatorVideoInfoGenerator() {
  const [videoInfoAnalysis, setVideoInfoAnalysis] = useState<CreatorVideoInfoGenerateResponse | null>(null);
  const [isGeneratingVideoInfo, setIsGeneratingVideoInfo] = useState(false);
  const [videoInfoError, setVideoInfoError] = useState<string | null>(null);

  const generateVideoInfo = async (payload: CreatorVideoInfoGenerateRequest, options?: { headers?: HeadersInit }) => {
    setIsGeneratingVideoInfo(true);
    setVideoInfoError(null);
    try {
      const result = await postJson<CreatorVideoInfoGenerateResponse>(
        "/api/creator/video-info/generate",
        payload,
        {
          headers: options?.headers,
          pendingLlmRun: buildPendingCreatorLlmRun({
            feature: "video_info",
            operation: "generate_video_info",
            promptVersion: VIDEO_INFO_PENDING_PROMPT_VERSION,
            request: payload,
            provider: payload.generationConfig?.provider,
            model: payload.generationConfig?.model,
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
