import type {
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
  CreatorVideoInfoProjectRecord,
} from "@/lib/creator/types";
import type { ContentProjectRecord } from "@/lib/projects/types";

function makeVideoInfoRecordId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `videoinfo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildProjectVideoInfoRecord(input: {
  request: CreatorVideoInfoGenerateRequest;
  response: CreatorVideoInfoGenerateResponse;
}): CreatorVideoInfoProjectRecord {
  return {
    id: makeVideoInfoRecordId(),
    generatedAt: Date.now(),
    sourceAssetId: input.request.sourceAssetId,
    sourceSignature: input.request.sourceSignature,
    inputSummary: {
      transcriptId: input.request.transcriptId,
      subtitleId: input.request.subtitleId,
      transcriptVersionLabel: input.request.transcriptVersionLabel,
      subtitleVersionLabel: input.request.subtitleVersionLabel,
      sourceSignature: input.request.sourceSignature,
      videoInfoBlocks: input.request.videoInfoBlocks?.slice() ?? [],
      model: input.response.model,
    },
    analysis: input.response,
  };
}

export function resolveProjectVideoInfoAnalysis(
  project: Pick<ContentProjectRecord, "youtubeVideoInfo"> | null | undefined,
  sourceSignature?: string | null
): CreatorVideoInfoGenerateResponse | null {
  const saved = project?.youtubeVideoInfo;
  if (!saved) return null;
  if (sourceSignature && saved.sourceSignature && saved.sourceSignature !== sourceSignature) {
    return null;
  }
  return saved.analysis;
}
