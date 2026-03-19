import { sortTranscriptVersions, type HistoryItem } from "../../history";

export interface DeleteTranscriptVersionResult {
  nextItem: HistoryItem | null;
  deletedTranscriptVersionId: string;
  deletedHistoryRecord: boolean;
}

export function deleteTranscriptVersionFromHistoryItem(
  item: HistoryItem,
  transcriptVersionId: string
): DeleteTranscriptVersionResult | null {
  if (!item.transcripts.some((transcript) => transcript.id === transcriptVersionId)) {
    return null;
  }

  const nextTranscripts = sortTranscriptVersions(item.transcripts.filter((transcript) => transcript.id !== transcriptVersionId));
  if (nextTranscripts.length === 0) {
    return {
      nextItem: null,
      deletedTranscriptVersionId: transcriptVersionId,
      deletedHistoryRecord: true,
    };
  }

  const nextActiveTranscriptVersionId =
    item.activeTranscriptVersionId === transcriptVersionId
      ? nextTranscripts[nextTranscripts.length - 1]?.id
      : item.activeTranscriptVersionId;

  return {
    nextItem: {
      ...item,
      transcripts: nextTranscripts,
      activeTranscriptVersionId: nextActiveTranscriptVersionId,
      updatedAt: Date.now(),
      timestamp: Date.now(),
    },
    deletedTranscriptVersionId: transcriptVersionId,
    deletedHistoryRecord: false,
  };
}
