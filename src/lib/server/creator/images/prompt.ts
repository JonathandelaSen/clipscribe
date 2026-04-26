import type { CreatorImageGenerateRequest } from "../../../creator/types";
import { resolveImagePromptSlotLine } from "../../../creator/prompt-customization";

export const CREATOR_IMAGES_PROMPT_VERSION = "creator-images-v1";

export function buildCreatorImagePrompt(request: CreatorImageGenerateRequest): string {
  const profile = request.promptCustomization?.effectiveProfile;
  const extraInstructions = [
    resolveImagePromptSlotLine("persona", profile),
    resolveImagePromptSlotLine("style", profile),
    profile?.globalInstructions,
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = request.prompt.trim();
  return extraInstructions ? `${extraInstructions}\n\n${prompt}` : prompt;
}
