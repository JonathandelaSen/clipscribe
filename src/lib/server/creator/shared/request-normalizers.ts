import type {
  CreatorGenerationConfig,
  CreatorGenerationSourceInput,
  CreatorShortsGenerateRequest,
  CreatorVideoInfoPromptCustomizationSnapshot,
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateRequest,
} from "../../../creator/types";
import { sanitizeCreatorModelSelection, sanitizeCreatorProvider } from "../../../creator/ai";
import {
  computePromptCustomizationHash,
  sanitizeVideoInfoPromptProfile,
  summarizeVideoInfoPromptEdits,
} from "../../../creator/prompt-customization";

export const ALL_VIDEO_INFO_BLOCKS: CreatorVideoInfoBlock[] = [
  "titleIdeas",
  "description",
  "pinnedComment",
  "hashtags",
  "thumbnailHooks",
  "chapters",
  "contentPack",
  "insights",
];

function normalizeCreatorSourceInput(input: CreatorGenerationSourceInput): CreatorGenerationSourceInput {
  return {
    projectId: input.projectId ? String(input.projectId) : undefined,
    sourceAssetId: input.sourceAssetId ? String(input.sourceAssetId) : undefined,
    transcriptId: input.transcriptId ? String(input.transcriptId) : undefined,
    subtitleId: input.subtitleId ? String(input.subtitleId) : undefined,
    sourceSignature: input.sourceSignature ? String(input.sourceSignature) : undefined,
    transcriptText: String(input.transcriptText || "").trim(),
    transcriptChunks: Array.isArray(input.transcriptChunks) ? input.transcriptChunks : [],
    subtitleChunks: Array.isArray(input.subtitleChunks) ? input.subtitleChunks : undefined,
    transcriptVersionLabel: input.transcriptVersionLabel ? String(input.transcriptVersionLabel) : undefined,
    subtitleVersionLabel: input.subtitleVersionLabel ? String(input.subtitleVersionLabel) : undefined,
    generationConfig: normalizeGenerationConfig(input.generationConfig),
  };
}

function normalizeGenerationConfig(value: unknown): CreatorGenerationConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const provider = sanitizeCreatorProvider(record.provider);
  const model = sanitizeCreatorModelSelection(record.model);
  if (!provider && !model) {
    return undefined;
  }

  return {
    provider,
    model,
  };
}

export function normalizeShortsGenerateRequest(input: CreatorShortsGenerateRequest): CreatorShortsGenerateRequest {
  const normalized = normalizeCreatorSourceInput(input);
  return {
    ...normalized,
    niche: input.niche ? String(input.niche) : undefined,
    audience: input.audience ? String(input.audience) : undefined,
    tone: input.tone ? String(input.tone) : undefined,
  };
}

export function normalizeVideoInfoGenerateRequest(input: CreatorVideoInfoGenerateRequest): CreatorVideoInfoGenerateRequest {
  const normalized = normalizeCreatorSourceInput(input);
  const promptCustomization = normalizeVideoInfoPromptCustomization(input.promptCustomization);
  return {
    ...normalized,
    videoInfoBlocks: Array.isArray(input.videoInfoBlocks)
      ? input.videoInfoBlocks
          .filter((value): value is CreatorVideoInfoBlock => typeof value === "string")
          .slice(0, 16)
      : undefined,
    promptCustomization,
  };
}

function normalizeVideoInfoPromptCustomization(
  value: unknown
): CreatorVideoInfoPromptCustomizationSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const mode = (value as { mode?: unknown }).mode;
  if (mode !== "default" && mode !== "global_customized" && mode !== "run_override") {
    return undefined;
  }

  const effectiveProfile = sanitizeVideoInfoPromptProfile(
    (value as { effectiveProfile?: unknown }).effectiveProfile
  );
  if (!effectiveProfile) {
    return undefined;
  }

  const editedSections = summarizeVideoInfoPromptEdits(effectiveProfile);
  return {
    mode,
    effectiveProfile,
    hash: computePromptCustomizationHash(effectiveProfile),
    editedSections,
  };
}

export function selectedVideoInfoBlocks(request: CreatorVideoInfoGenerateRequest): Set<CreatorVideoInfoBlock> {
  const blocks = request.videoInfoBlocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return new Set(ALL_VIDEO_INFO_BLOCKS);
  }
  return new Set(blocks);
}
