import { useState } from "react";

import { buildPendingCreatorLlmRun } from "@/lib/creator/llm-run-pending";
import type { CreatorImageGenerateRequest, CreatorImageGenerateResponse } from "@/lib/creator/types";
import { CreatorApiError, postJson } from "@/hooks/creator-api";

const IMAGE_PENDING_PROMPT_VERSION = "creator-images-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function formatImageGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Image generation failed";
  if (!(error instanceof CreatorApiError) || !isRecord(error.details)) return message;

  const providerErrorMessage = error.details.providerErrorMessage;
  if (typeof providerErrorMessage !== "string" || !providerErrorMessage.trim()) return message;
  if (message.includes(providerErrorMessage)) return message;
  return `${message} API error: ${providerErrorMessage.trim()}`;
}

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
      setImageError(formatImageGenerationError(error));
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
