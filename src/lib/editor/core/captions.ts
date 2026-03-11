import { getSubtitleById, getTranscriptById, type HistoryItem, type SubtitleChunk } from "../../history";
import type {
  CaptionSourceRef,
  EditorAssetRecord,
  EditorProjectRecord,
  TimelineClipPlacement,
} from "../types";
import { getTimelineClipPlacements } from "./timeline";

export interface TimelineCaptionChunk extends SubtitleChunk {
  sourceClipId: string;
  sourceAssetId: string;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

export function resolveCaptionSourceChunks(
  captionSource: CaptionSourceRef,
  historyMap: Map<string, HistoryItem>
): SubtitleChunk[] {
  if (captionSource.kind === "embedded-srt") return captionSource.chunks;
  if (captionSource.kind === "none") return [];

  const item = historyMap.get(captionSource.sourceProjectId);
  if (!item) return [];
  const transcript = getTranscriptById(item, captionSource.transcriptId);
  if (!transcript) return [];
  return getSubtitleById(transcript, captionSource.subtitleId)?.chunks ?? [];
}

export function offsetCaptionChunksForClip(
  rawChunks: SubtitleChunk[],
  placement: TimelineClipPlacement
): TimelineCaptionChunk[] {
  return rawChunks.flatMap((chunk) => {
    const rawStart = chunk.timestamp?.[0];
    if (typeof rawStart !== "number" || !Number.isFinite(rawStart)) return [];

    const rawEndValue = chunk.timestamp?.[1];
    const rawEnd = typeof rawEndValue === "number" && Number.isFinite(rawEndValue) ? rawEndValue : rawStart;

    const start = Math.max(rawStart, placement.clip.trimStartSeconds);
    const end = Math.min(rawEnd, placement.clip.trimEndSeconds);
    if (end <= start) return [];

    return [
      {
        ...chunk,
        sourceClipId: placement.clip.id,
        sourceAssetId: placement.clip.assetId,
        timestamp: [
          roundMs(placement.startSeconds + (start - placement.clip.trimStartSeconds)),
          roundMs(placement.startSeconds + (end - placement.clip.trimStartSeconds)),
        ],
      },
    ];
  });
}

export function buildProjectCaptionTimeline(input: {
  project: EditorProjectRecord;
  assets: EditorAssetRecord[];
  historyMap: Map<string, HistoryItem>;
}): TimelineCaptionChunk[] {
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);

  return placements.flatMap((placement) => {
    const asset = assetsById.get(placement.clip.assetId);
    if (!asset) return [];
    const chunks = resolveCaptionSourceChunks(asset.captionSource, input.historyMap);
    return offsetCaptionChunksForClip(chunks, placement);
  });
}
