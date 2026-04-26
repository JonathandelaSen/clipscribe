import type { CreatorImageGenerateRequest } from "../../../creator/types";
import { resolveImagePromptSlotLine } from "../../../creator/prompt-customization";

export const CREATOR_IMAGES_PROMPT_VERSION = "creator-images-v1";

export function buildCreatorImagePrompt(request: CreatorImageGenerateRequest): string {
  const profile = request.promptCustomization?.effectiveProfile;
  return [
    resolveImagePromptSlotLine("persona", profile),
    resolveImagePromptSlotLine("style", profile),
    profile?.globalInstructions ? "" : undefined,
    profile?.globalInstructions,
    "",
    `Aspect ratio: ${request.aspectRatio ?? "1:1"}`,
    `Output format: ${request.outputFormat ?? "png"}`,
    "",
    "Image brief:",
    request.prompt,
  ]
    .filter(Boolean)
    .join("\n");
}
