import type { CreatorImageAspectRatio, CreatorImageGenerateRequest, CreatorLLMProvider } from "../../../creator/types";
import { resolveImagePromptSlotLine } from "../../../creator/prompt-customization";

export const CREATOR_IMAGES_PROMPT_VERSION = "creator-images-v2";

const OPENAI_FRAME_INSTRUCTIONS: Record<CreatorImageAspectRatio, string> = {
  "1:1": "Frame instruction: Compose for a 1:1 square frame.",
  "16:9": "Frame instruction: Compose for a 16:9 wide landscape frame.",
  "9:16": "Frame instruction: Compose for a 9:16 vertical portrait frame.",
  "4:5": "Frame instruction: Compose for a 4:5 portrait frame.",
  "3:4": "Frame instruction: Compose for a 3:4 portrait frame.",
};

function resolveOpenAIFrameInstruction(aspectRatio?: CreatorImageAspectRatio): string {
  return OPENAI_FRAME_INSTRUCTIONS[aspectRatio ?? "1:1"];
}

export function buildCreatorImagePrompt(
  request: CreatorImageGenerateRequest,
  options?: { provider?: CreatorLLMProvider }
): string {
  const profile = request.promptCustomization?.effectiveProfile;
  const extraInstructions = [
    resolveImagePromptSlotLine("persona", profile),
    resolveImagePromptSlotLine("style", profile),
    profile?.globalInstructions,
    options?.provider === "openai" ? resolveOpenAIFrameInstruction(request.aspectRatio) : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = request.prompt.trim();
  return extraInstructions ? `${extraInstructions}\n\n${prompt}` : prompt;
}
