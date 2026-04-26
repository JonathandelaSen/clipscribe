import { useState } from "react";

import { buildPendingCreatorLlmRun } from "@/lib/creator/llm-run-pending";
import type { CreatorImageGenerateRequest, CreatorImageGenerateResponse } from "@/lib/creator/types";
import { postJson } from "@/hooks/creator-api";

const IMAGE_PENDING_PROMPT_VERSION = "creator-images-v1";

export function useCreatorImageGenerator() {
  const [imageResult, setImageResult] = useState<CreatorImageGenerateResponse | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const generateImages = async (payload: CreatorImageGenerateRequest, options?: { headers?: HeadersInit }) => {
    setIsGeneratingImages(true);
    setImageError(null);
    try {
      const result = await postJson<CreatorImageGenerateResponse>(
        "/api/creator/images/generate",
        payload,
        {
          headers: options?.headers,
          pendingLlmRun: buildPendingCreatorLlmRun({
            feature: "images",
            operation: "generate_image",
            promptVersion: IMAGE_PENDING_PROMPT_VERSION,
            request: {
              projectId: payload.projectId,
              generationConfig: payload.generationConfig,
            },
            provider: payload.generationConfig?.provider,
            model: payload.generationConfig?.model,
            inputSummary: {
              promptCustomizationMode: payload.promptCustomization?.mode ?? "default",
              promptCustomizationHash: payload.promptCustomization?.hash,
              promptEditedSections: payload.promptCustomization?.editedSections?.slice() ?? [],
              imagePromptCharCount: payload.prompt.length,
              imageAspectRatio: payload.aspectRatio,
              imageSize: payload.size,
              imageQuality: payload.quality,
              imageFormat: payload.outputFormat,
              imageCount: payload.count,
            },
          }),
        }
      );
      setImageResult(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      setImageError(message);
      throw error;
    } finally {
      setIsGeneratingImages(false);
    }
  };

  return {
    imageResult,
    setImageResult,
    isGeneratingImages,
    imageError,
    generateImages,
  };
}
