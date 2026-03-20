import type {
  CreatorGenerationSourceInput,
  CreatorShortsGenerateRequest,
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateRequest,
} from "../../../creator/types";

export const ALL_VIDEO_INFO_BLOCKS: CreatorVideoInfoBlock[] = [
  "titleIdeas",
  "description",
  "pinnedComment",
  "hashtagsSeo",
  "thumbnailHooks",
  "chapters",
  "contentPack",
  "insights",
];

function normalizeCreatorSourceInput(input: CreatorGenerationSourceInput): CreatorGenerationSourceInput {
  return {
    transcriptText: String(input.transcriptText || "").trim(),
    transcriptChunks: Array.isArray(input.transcriptChunks) ? input.transcriptChunks : [],
    subtitleChunks: Array.isArray(input.subtitleChunks) ? input.subtitleChunks : undefined,
    transcriptVersionLabel: input.transcriptVersionLabel ? String(input.transcriptVersionLabel) : undefined,
    subtitleVersionLabel: input.subtitleVersionLabel ? String(input.subtitleVersionLabel) : undefined,
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
  return {
    ...normalized,
    videoInfoBlocks: Array.isArray(input.videoInfoBlocks)
      ? input.videoInfoBlocks
          .filter((value): value is CreatorVideoInfoBlock => typeof value === "string")
          .slice(0, 16)
      : undefined,
  };
}

export function selectedVideoInfoBlocks(request: CreatorVideoInfoGenerateRequest): Set<CreatorVideoInfoBlock> {
  const blocks = request.videoInfoBlocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return new Set(ALL_VIDEO_INFO_BLOCKS);
  }
  return new Set(blocks);
}
