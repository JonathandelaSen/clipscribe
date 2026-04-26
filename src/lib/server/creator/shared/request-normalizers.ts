import type {
  CreatorGenerationConfig,
  CreatorGenerationSourceInput,
  CreatorImageAspectRatio,
  CreatorImageFormat,
  CreatorImageGenerateRequest,
  CreatorImagePromptCustomizationSnapshot,
  CreatorImageQuality,
  CreatorShortsGenerateRequest,
  CreatorVideoInfoPromptCustomizationSnapshot,
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoMetadataTarget,
} from "../../../creator/types";
import { sanitizeCreatorModelSelection, sanitizeCreatorProvider } from "../../../creator/ai";
import {
  computePromptCustomizationHash,
  sanitizeImagePromptProfile,
  summarizeImagePromptEdits,
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
    focusedTranscriptText: input.focusedTranscriptText ? String(input.focusedTranscriptText).trim() : undefined,
    focusedTranscriptChunks: Array.isArray(input.focusedTranscriptChunks) ? input.focusedTranscriptChunks : undefined,
    contextTranscriptText: input.contextTranscriptText ? String(input.contextTranscriptText).trim() : undefined,
    contextTranscriptChunks: Array.isArray(input.contextTranscriptChunks) ? input.contextTranscriptChunks : undefined,
    contextTranscriptTruncated:
      typeof input.contextTranscriptTruncated === "boolean" ? input.contextTranscriptTruncated : undefined,
    subtitleChunks: Array.isArray(input.subtitleChunks) ? input.subtitleChunks : undefined,
    transcriptVersionLabel: input.transcriptVersionLabel ? String(input.transcriptVersionLabel) : undefined,
    subtitleVersionLabel: input.subtitleVersionLabel ? String(input.subtitleVersionLabel) : undefined,
    generationConfig: normalizeGenerationConfig(input.generationConfig),
  };
}

function normalizeMetadataTarget(value: unknown): CreatorVideoInfoMetadataTarget | undefined {
  return value === "youtube_short_publish" || value === "youtube_video" ? value : undefined;
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

function normalizeImageAspectRatio(value: unknown): CreatorImageAspectRatio {
  return value === "16:9" || value === "9:16" || value === "4:5" || value === "3:4" || value === "1:1"
    ? value
    : "1:1";
}

function normalizeImageQuality(value: unknown): CreatorImageQuality {
  return value === "low" || value === "medium" || value === "high" || value === "auto" ? value : "auto";
}

function normalizeImageFormat(value: unknown): CreatorImageFormat {
  return value === "jpeg" || value === "webp" || value === "png" ? value : "png";
}

function normalizeImageCount(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return 1;
  return Math.min(4, Math.max(1, Math.round(next)));
}

function normalizeImageSize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === "auto") return "auto";
  return /^\d{3,4}x\d{3,4}$/.test(trimmed) ? trimmed : undefined;
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
    metadataTarget: normalizeMetadataTarget(input.metadataTarget),
    videoInfoBlocks: Array.isArray(input.videoInfoBlocks)
      ? input.videoInfoBlocks
          .filter((value): value is CreatorVideoInfoBlock => typeof value === "string")
          .slice(0, 16)
      : undefined,
    promptCustomization,
  };
}

export function normalizeImageGenerateRequest(input: CreatorImageGenerateRequest): CreatorImageGenerateRequest {
  return {
    projectId: input.projectId ? String(input.projectId) : undefined,
    prompt: String(input.prompt || "").trim(),
    aspectRatio: normalizeImageAspectRatio(input.aspectRatio),
    size: normalizeImageSize(input.size),
    quality: normalizeImageQuality(input.quality),
    outputFormat: normalizeImageFormat(input.outputFormat),
    count: normalizeImageCount(input.count),
    generationConfig: normalizeGenerationConfig(input.generationConfig),
    promptCustomization: normalizeImagePromptCustomization(input.promptCustomization),
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

function normalizeImagePromptCustomization(
  value: unknown
): CreatorImagePromptCustomizationSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const mode = (value as { mode?: unknown }).mode;
  if (mode !== "default" && mode !== "global_customized" && mode !== "run_override") {
    return undefined;
  }

  const effectiveProfile = sanitizeImagePromptProfile(
    (value as { effectiveProfile?: unknown }).effectiveProfile
  );
  if (!effectiveProfile) {
    return undefined;
  }

  const editedSections = summarizeImagePromptEdits(effectiveProfile);
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
