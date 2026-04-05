import type {
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
  CreatorVideoInfoProjectRecord,
} from "@/lib/creator/types";
import type { ContentProjectRecord } from "@/lib/projects/types";

const MAX_VIDEO_INFO_HISTORY = 20;

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
      provider: input.response.providerMode === "openai" || input.response.providerMode === "gemini"
        ? input.response.providerMode
        : undefined,
      model: input.response.model,
      promptCustomizationMode: input.request.promptCustomization?.mode ?? "default",
      promptCustomizationHash: input.request.promptCustomization?.hash,
      promptEditedSections: input.request.promptCustomization?.editedSections?.slice() ?? [],
    },
    analysis: input.response,
  };
}

/**
 * Migrates a project that may still use the legacy single-record `youtubeVideoInfo`
 * into the array-based `youtubeVideoInfoHistory`. Returns the normalised history array.
 */
export function resolveProjectVideoInfoHistory(
  project: Pick<ContentProjectRecord, "youtubeVideoInfo" | "youtubeVideoInfoHistory"> | null | undefined
): CreatorVideoInfoProjectRecord[] {
  if (project?.youtubeVideoInfoHistory?.length) {
    return project.youtubeVideoInfoHistory;
  }
  // Backward compat: wrap legacy single record into an array
  if (project?.youtubeVideoInfo) {
    return [project.youtubeVideoInfo];
  }
  return [];
}

/**
 * Appends a new record to the history array, capping at MAX_VIDEO_INFO_HISTORY.
 * Returns the updated array (newest first).
 */
export function appendProjectVideoInfoRecord(
  existing: CreatorVideoInfoProjectRecord[],
  newRecord: CreatorVideoInfoProjectRecord
): CreatorVideoInfoProjectRecord[] {
  const updated = [newRecord, ...existing.filter((r) => r.id !== newRecord.id)];
  return updated.slice(0, MAX_VIDEO_INFO_HISTORY);
}

/**
 * Removes a record from the history array by id.
 */
export function removeProjectVideoInfoRecord(
  existing: CreatorVideoInfoProjectRecord[],
  recordId: string
): CreatorVideoInfoProjectRecord[] {
  return existing.filter((r) => r.id !== recordId);
}

/**
 * Resolves the best-matching video info analysis from the history.
 * Prefers matching sourceSignature; falls back to the latest entry.
 */
export function resolveProjectVideoInfoAnalysis(
  project: Pick<ContentProjectRecord, "youtubeVideoInfo" | "youtubeVideoInfoHistory"> | null | undefined,
  sourceSignature?: string | null
): CreatorVideoInfoGenerateResponse | null {
  const history = resolveProjectVideoInfoHistory(project);
  if (history.length === 0) return null;

  if (sourceSignature) {
    const match = history.find((r) => r.sourceSignature === sourceSignature);
    if (match) return match.analysis;
  }

  // Fallback: latest by generatedAt
  const sorted = [...history].sort((a, b) => b.generatedAt - a.generatedAt);
  return sorted[0]?.analysis ?? null;
}
