import {
  getSubtitleById,
  getTranscriptById,
  shiftSubtitleChunks,
  type HistoryItem,
  type SubtitleChunk,
} from "../../history";
import { buildPopCaptionChunks } from "../../creator/core/pop-captions";
import type { CreatorSubtitleTimingMode } from "../../creator/types";
import type {
  CaptionSourceRef,
  EditorAssetRecord,
  EditorProjectRecord,
  TimelineClipPlacement,
} from "../types";
import { EDITOR_SUBTITLE_TRACK_ID } from "../types";
import { normalizeEditorSubtitleTrackSettings } from "../storage";
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
  if (captionSource.kind === "asset-subtitle") {
    const item = historyMap.get(captionSource.sourceAssetId);
    if (!item) return [];
    const transcript = getTranscriptById(item, captionSource.transcriptId);
    if (!transcript) return [];
    return getSubtitleById(transcript, captionSource.subtitleId)?.chunks ?? [];
  }

  const item = historyMap.get(captionSource.sourceProjectId);
  if (!item) return [];
  const transcript = getTranscriptById(item, captionSource.transcriptId);
  if (!transcript) return [];
  return getSubtitleById(transcript, captionSource.subtitleId)?.chunks ?? [];
}

function getProjectSubtitleTrackSourceChunks(
  project: EditorProjectRecord,
  historyMap: Map<string, HistoryItem>
): SubtitleChunk[] {
  const subtitles = normalizeEditorSubtitleTrackSettings(project.subtitles);

  if (subtitles.source.kind === "uploaded-srt") {
    return subtitles.chunks;
  }

  if (subtitles.source.kind === "history-subtitle") {
    const item = historyMap.get(subtitles.source.sourceProjectId);
    if (!item) return subtitles.chunks;
    const transcript = getTranscriptById(item, subtitles.source.transcriptId);
    if (!transcript) return subtitles.chunks;
    return getSubtitleById(transcript, subtitles.source.subtitleId)?.chunks ?? subtitles.chunks;
  }

  return subtitles.chunks;
}

function getProjectSubtitleTrackWordChunks(
  project: EditorProjectRecord,
  historyMap: Map<string, HistoryItem>
): SubtitleChunk[] {
  const subtitles = normalizeEditorSubtitleTrackSettings(project.subtitles);
  if (subtitles.source.kind !== "history-subtitle") return [];

  const item = historyMap.get(subtitles.source.sourceProjectId);
  if (!item) return [];
  const transcript = getTranscriptById(item, subtitles.source.transcriptId);
  if (!transcript) return [];
  const subtitle = getSubtitleById(transcript, subtitles.source.subtitleId);
  if (!subtitle || subtitle.kind === "translation" || !transcript.wordChunks?.length) return [];

  const sourceLanguage = (subtitle.sourceLanguage ?? subtitle.language ?? "").toLowerCase();
  const transcriptLanguage = (transcript.detectedLanguage ?? transcript.requestedLanguage ?? "").toLowerCase();
  if (!sourceLanguage || sourceLanguage !== transcriptLanguage) {
    return [];
  }

  return subtitle.shiftSeconds !== 0
    ? shiftSubtitleChunks(transcript.wordChunks, subtitle.shiftSeconds)
    : transcript.wordChunks;
}

export function getProjectSubtitleTrackEffectiveTimingMode(input: {
  project: EditorProjectRecord;
  historyMap: Map<string, HistoryItem>;
}): CreatorSubtitleTimingMode {
  const subtitles = normalizeEditorSubtitleTrackSettings(input.project.subtitles);
  if (subtitles.subtitleTimingMode === "segment") return "segment";
  return getProjectSubtitleTrackWordChunks(input.project, input.historyMap).length > 0
    ? subtitles.subtitleTimingMode
    : "segment";
}

function getSubtitleTrackSourceDurationSeconds(chunks: SubtitleChunk[]): number {
  return chunks.reduce((max, chunk) => {
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1];
    const safeStart = typeof start === "number" && Number.isFinite(start) ? start : 0;
    const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : safeStart;
    return Math.max(max, safeEnd);
  }, 0);
}

export function hasProjectSubtitleTrack(project: EditorProjectRecord): boolean {
  return (
    project.subtitles.source.kind !== "none" ||
    project.subtitles.chunks.length > 0 ||
    Boolean(project.subtitles.label)
  );
}

export function buildProjectSubtitleTimeline(input: {
  project: EditorProjectRecord;
  historyMap: Map<string, HistoryItem>;
}): TimelineCaptionChunk[] {
  const subtitles = normalizeEditorSubtitleTrackSettings(input.project.subtitles);
  const effectiveTimingMode = getProjectSubtitleTrackEffectiveTimingMode(input);
  const rawChunks =
    effectiveTimingMode === "segment"
      ? getProjectSubtitleTrackSourceChunks(input.project, input.historyMap)
      : buildPopCaptionChunks(
          getProjectSubtitleTrackWordChunks(input.project, input.historyMap),
          effectiveTimingMode
        );
  if (!subtitles.enabled || rawChunks.length === 0) return [];

  const sourceDurationSeconds = getSubtitleTrackSourceDurationSeconds(rawChunks);
  const trimEndSeconds =
    subtitles.trimEndSeconds > subtitles.trimStartSeconds ? subtitles.trimEndSeconds : sourceDurationSeconds;

  return rawChunks.flatMap((chunk) => {
    const rawStart = chunk.timestamp?.[0];
    if (typeof rawStart !== "number" || !Number.isFinite(rawStart)) return [];

    const rawEndValue = chunk.timestamp?.[1];
    const rawEnd = typeof rawEndValue === "number" && Number.isFinite(rawEndValue) ? rawEndValue : rawStart;
    const start = Math.max(rawStart, subtitles.trimStartSeconds);
    const end = Math.min(rawEnd, trimEndSeconds);
    if (end <= start) return [];

    return [
      {
        ...chunk,
        sourceClipId: EDITOR_SUBTITLE_TRACK_ID,
        sourceAssetId: EDITOR_SUBTITLE_TRACK_ID,
        timestamp: [roundMs(start - subtitles.trimStartSeconds + subtitles.offsetSeconds), roundMs(end - subtitles.trimStartSeconds + subtitles.offsetSeconds)],
      },
    ];
  });
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
  const projectSubtitleTimeline = buildProjectSubtitleTimeline({
    project: input.project,
    historyMap: input.historyMap,
  });
  if (projectSubtitleTimeline.length > 0 || hasProjectSubtitleTrack(input.project)) {
    return projectSubtitleTimeline;
  }

  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);

  return placements.flatMap((placement) => {
    const asset = assetsById.get(placement.clip.assetId);
    if (!asset) return [];
    const chunks = resolveCaptionSourceChunks(asset.captionSource, input.historyMap);
    return offsetCaptionChunksForClip(chunks, placement);
  });
}

export function hydrateProjectSubtitleTrackFromLegacyCaptions(input: {
  project: EditorProjectRecord;
  assets: EditorAssetRecord[];
  historyMap: Map<string, HistoryItem>;
}): EditorProjectRecord {
  if (hasProjectSubtitleTrack(input.project)) {
    return {
      ...input.project,
      subtitles: normalizeEditorSubtitleTrackSettings(input.project.subtitles),
    };
  }

  for (const asset of input.assets) {
    if (asset.captionSource.kind === "none") continue;
    const chunks = resolveCaptionSourceChunks(asset.captionSource, input.historyMap);
    if (chunks.length === 0) continue;

    const subtitles =
      asset.captionSource.kind === "embedded-srt"
        ? {
            ...normalizeEditorSubtitleTrackSettings(input.project.subtitles),
            source: { kind: "uploaded-srt" as const },
            label: asset.captionSource.label,
            language: asset.captionSource.language,
            chunks: asset.captionSource.chunks,
            trimStartSeconds: 0,
            trimEndSeconds: getSubtitleTrackSourceDurationSeconds(asset.captionSource.chunks),
          }
        : {
            ...normalizeEditorSubtitleTrackSettings(input.project.subtitles),
            source: {
              kind: "history-subtitle" as const,
              sourceProjectId:
                asset.captionSource.kind === "asset-subtitle"
                  ? asset.captionSource.sourceAssetId
                  : asset.captionSource.sourceProjectId,
              transcriptId: asset.captionSource.transcriptId,
              subtitleId: asset.captionSource.subtitleId,
            },
            label: asset.captionSource.label,
            language: asset.captionSource.language,
            chunks,
            trimStartSeconds: 0,
            trimEndSeconds: getSubtitleTrackSourceDurationSeconds(chunks),
          };

    return {
      ...input.project,
      subtitles,
    };
  }

  return {
    ...input.project,
    subtitles: normalizeEditorSubtitleTrackSettings(input.project.subtitles),
  };
}
