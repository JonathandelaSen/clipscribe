import type { HistoryItem } from "../../history";
import type { AssetTranscriptRecord, ProjectHistoryItem } from "../../projects/types";

export function historyItemToTranscriptRecord(item: HistoryItem, projectId: string): AssetTranscriptRecord {
  return {
    assetId: item.id,
    projectId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    timestamp: item.timestamp,
    activeTranscriptVersionId: item.activeTranscriptVersionId,
    transcripts: item.transcripts,
  };
}

export function projectHistoryItemToTranscriptRecord(item: ProjectHistoryItem): AssetTranscriptRecord {
  return historyItemToTranscriptRecord(item, item.projectId);
}
