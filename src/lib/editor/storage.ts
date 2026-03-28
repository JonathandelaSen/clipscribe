import {
  getDefaultCreatorSubtitleStyle,
  resolveCreatorSubtitleStyle,
} from "../creator/subtitle-style";
import { makeId } from "../history";
import type {
  EditorAspectRatio,
  EditorAssetKind,
  EditorAssetRecord,
  EditorCanvasState,
  EditorExportEngine,
  EditorExportRecord,
  EditorProjectRecord,
  EditorSubtitlePreset,
  EditorSubtitleTrackSettings,
  TimelineClipGroup,
  TimelineImageItem,
  TimelineSelection,
  TimelineAudioItem,
  TimelineVideoClipActions,
  TimelineVideoClip,
} from "./types";

const DEFAULT_SUBTITLE_PRESET: EditorSubtitlePreset = "clean_caption";
export const DEFAULT_EDITOR_MEDIA_VOLUME = 1;
export const DEFAULT_EDITOR_MEDIA_MUTED = false;
export const DEFAULT_TIMELINE_VIDEO_CLIP_ACTIONS: TimelineVideoClipActions = {
  reverse: false,
};

type LegacyEditorProjectTimelineState = Partial<EditorProjectRecord["timeline"]> & {
  selectedClipId?: string;
  audioTrack?: TimelineAudioItem | null;
  audioItems?: TimelineAudioItem[];
  selectedItem?: TimelineSelection;
};

type LegacyEditorProjectRecord = Omit<EditorProjectRecord, "timeline"> & {
  timeline: LegacyEditorProjectTimelineState;
};

type LegacyEditorExportSummary = EditorProjectRecord["latestExport"] & {
  engine?: EditorExportEngine;
};

type LegacyEditorExportRecord = Omit<EditorExportRecord, "engine"> & {
  engine?: EditorExportEngine;
};

export function getDefaultEditorCanvasState(): EditorCanvasState {
  return {
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}

export function getDefaultTimelineVideoClipActions(): TimelineVideoClipActions {
  return {
    ...DEFAULT_TIMELINE_VIDEO_CLIP_ACTIONS,
  };
}

export function getDefaultEditorSubtitleStyle(
  preset: EditorSubtitlePreset
) {
  if (preset !== "clean_caption") {
    return getDefaultCreatorSubtitleStyle(preset);
  }

  return resolveCreatorSubtitleStyle(preset, {
    borderColor: "#111111",
    borderWidth: 4.8,
    shadowOpacity: 0.46,
    shadowDistance: 3,
  });
}

export function getDefaultEditorSubtitleTrackSettings(): EditorSubtitleTrackSettings {
  return {
    source: {
      kind: "none",
    },
    label: undefined,
    language: undefined,
    chunks: [],
    subtitleTimingMode: "segment",
    offsetSeconds: 0,
    trimStartSeconds: 0,
    trimEndSeconds: 0,
    enabled: true,
    preset: DEFAULT_SUBTITLE_PRESET,
    positionXPercent: 50,
    positionYPercent: 78,
    scale: 1,
    style: getDefaultEditorSubtitleStyle(DEFAULT_SUBTITLE_PRESET),
  };
}

function getSubtitleTrackSourceDurationSeconds(
  chunks: EditorSubtitleTrackSettings["chunks"]
): number {
  return chunks.reduce((max, chunk) => {
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1];
    const fallback = typeof start === "number" && Number.isFinite(start) ? start : 0;
    const candidate = typeof end === "number" && Number.isFinite(end) ? end : fallback;
    return Math.max(max, candidate);
  }, 0);
}

function normalizeSubtitleTrimEndSeconds(
  trimEndSeconds: number,
  chunks: EditorSubtitleTrackSettings["chunks"]
): number {
  if (!Number.isFinite(trimEndSeconds) || trimEndSeconds < 0) {
    return getSubtitleTrackSourceDurationSeconds(chunks);
  }
  return trimEndSeconds;
}

export function normalizeEditorSubtitleTrackSettings(
  subtitles: Partial<EditorSubtitleTrackSettings> | undefined
): EditorSubtitleTrackSettings {
  const defaults = getDefaultEditorSubtitleTrackSettings();
  const source = subtitles?.source;
  const normalizedSource =
    source?.kind === "history-subtitle"
      ? {
          kind: "history-subtitle" as const,
          sourceProjectId: String(source.sourceProjectId ?? ""),
          transcriptId: String(source.transcriptId ?? ""),
          subtitleId: String(source.subtitleId ?? ""),
        }
      : source?.kind === "uploaded-srt"
        ? { kind: "uploaded-srt" as const }
        : { kind: "none" as const };

  const chunks = Array.isArray(subtitles?.chunks) ? subtitles.chunks : defaults.chunks;
  const preset = subtitles?.preset ?? defaults.preset;
  const defaultStyle = getDefaultEditorSubtitleStyle(preset);

  return {
    source: normalizedSource,
    label: typeof subtitles?.label === "string" && subtitles.label.trim() ? subtitles.label.trim() : undefined,
    language:
      typeof subtitles?.language === "string" && subtitles.language.trim() ? subtitles.language.trim() : undefined,
    chunks,
    subtitleTimingMode:
      subtitles?.subtitleTimingMode === "word" ||
      subtitles?.subtitleTimingMode === "pair" ||
      subtitles?.subtitleTimingMode === "triple" ||
      subtitles?.subtitleTimingMode === "segment"
        ? subtitles.subtitleTimingMode
        : defaults.subtitleTimingMode,
    offsetSeconds: Number.isFinite(subtitles?.offsetSeconds) ? Number(subtitles?.offsetSeconds) : defaults.offsetSeconds,
    trimStartSeconds: Number.isFinite(subtitles?.trimStartSeconds)
      ? Math.max(0, Number(subtitles?.trimStartSeconds))
      : defaults.trimStartSeconds,
    trimEndSeconds: normalizeSubtitleTrimEndSeconds(Number(subtitles?.trimEndSeconds), chunks),
    enabled: typeof subtitles?.enabled === "boolean" ? subtitles.enabled : defaults.enabled,
    preset,
    positionXPercent: Number.isFinite(subtitles?.positionXPercent)
      ? Math.min(90, Math.max(10, Number(subtitles?.positionXPercent)))
      : defaults.positionXPercent,
    positionYPercent: Number.isFinite(subtitles?.positionYPercent)
      ? Math.min(92, Math.max(45, Number(subtitles?.positionYPercent)))
      : defaults.positionYPercent,
    scale: Number.isFinite(subtitles?.scale) ? Number(subtitles?.scale) : defaults.scale,
    style: resolveCreatorSubtitleStyle(preset, {
      ...defaultStyle,
      ...subtitles?.style,
      preset,
    }),
  };
}

export function normalizeTimelineVideoClip(
  clip: TimelineVideoClip | (Omit<TimelineVideoClip, "actions"> & { actions?: Partial<TimelineVideoClipActions> | null })
): TimelineVideoClip {
  return {
    ...clip,
    actions: {
      ...DEFAULT_TIMELINE_VIDEO_CLIP_ACTIONS,
      ...(clip.actions ?? {}),
    },
  };
}

export function normalizeTimelineClipGroup(
  group: TimelineClipGroup | (Partial<TimelineClipGroup> & Pick<TimelineClipGroup, "id">)
): TimelineClipGroup {
  return {
    id: group.id,
    kind: "joined",
    clipIds: Array.isArray(group.clipIds) ? group.clipIds.filter((clipId) => typeof clipId === "string") : [],
    label: typeof group.label === "string" ? group.label : "",
  };
}

export function normalizeTimelineImageItem(
  item: TimelineImageItem | (Partial<TimelineImageItem> & Pick<TimelineImageItem, "id" | "assetId">)
): TimelineImageItem {
  return {
    id: item.id,
    assetId: item.assetId,
    label: typeof item.label === "string" ? item.label : "",
    canvas: item.canvas ?? getDefaultEditorCanvasState(),
  };
}

export function createDefaultVideoClip(input: {
  assetId: string;
  label: string;
  durationSeconds: number;
}): TimelineVideoClip {
  return {
    id: makeId("edclip"),
    assetId: input.assetId,
    label: input.label,
    trimStartSeconds: 0,
    trimEndSeconds: Math.max(0.5, Number(input.durationSeconds || 0)),
    canvas: getDefaultEditorCanvasState(),
    volume: DEFAULT_EDITOR_MEDIA_VOLUME,
    muted: DEFAULT_EDITOR_MEDIA_MUTED,
    actions: getDefaultTimelineVideoClipActions(),
  };
}

export function createDefaultAudioTrack(input: {
  assetId: string;
  durationSeconds: number;
}): TimelineAudioItem {
  return {
    id: makeId("edaudio"),
    assetId: input.assetId,
    startOffsetSeconds: 0,
    trimStartSeconds: 0,
    trimEndSeconds: Math.max(0.5, Number(input.durationSeconds || 0)),
    volume: DEFAULT_EDITOR_MEDIA_VOLUME,
    muted: DEFAULT_EDITOR_MEDIA_MUTED,
  };
}

export function createDefaultImageTrackItem(input: {
  assetId: string;
  label: string;
}): TimelineImageItem {
  return {
    id: makeId("edimage"),
    assetId: input.assetId,
    label: input.label,
    canvas: getDefaultEditorCanvasState(),
  };
}

export function createEmptyEditorProject(input?: {
  id?: string;
  now?: number;
  name?: string;
  aspectRatio?: EditorAspectRatio;
  activeSourceAssetId?: string;
}): EditorProjectRecord {
  const now = input?.now ?? Date.now();
  const id = input?.id ?? makeId("editor_project");
  return {
    id,
    name: input?.name?.trim() || "Untitled Timeline",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    status: "draft",
    aspectRatio: input?.aspectRatio ?? "16:9",
    activeSourceAssetId: input?.activeSourceAssetId,
    assetIds: [],
    timeline: {
      playheadSeconds: 0,
      zoomLevel: 1,
      selectedItem: undefined,
      imageItems: [],
      videoClips: [],
      videoClipGroups: [],
      audioItems: [],
    },
    subtitles: getDefaultEditorSubtitleTrackSettings(),
  };
}

export function normalizeLegacyEditorProjectRecord(project: EditorProjectRecord | LegacyEditorProjectRecord): EditorProjectRecord {
  const timeline = (project.timeline ?? {}) as LegacyEditorProjectTimelineState;
  const audioItems = Array.isArray(timeline.audioItems) && timeline.audioItems.length > 0
    ? timeline.audioItems
    : timeline.audioTrack
      ? [timeline.audioTrack]
      : [];
  const selectedItem = timeline.selectedItem
    ? timeline.selectedItem
    : timeline.selectedClipId
      ? { kind: "video" as const, id: timeline.selectedClipId }
      : undefined;

  return {
    ...project,
    latestExport: project.latestExport
      ? {
          ...(project.latestExport as LegacyEditorExportSummary),
          engine: project.latestExport.engine === "browser" ? "browser" : "system",
        }
      : undefined,
    timeline: {
      playheadSeconds: timeline.playheadSeconds ?? 0,
      zoomLevel: timeline.zoomLevel ?? 1,
      selectedItem,
      imageItems: Array.isArray(timeline.imageItems)
        ? timeline.imageItems.map((item) => normalizeTimelineImageItem(item))
        : [],
      videoClips: Array.isArray(timeline.videoClips)
        ? timeline.videoClips.map((clip) => normalizeTimelineVideoClip(clip))
        : [],
      videoClipGroups: Array.isArray(timeline.videoClipGroups)
        ? timeline.videoClipGroups.map((group) => normalizeTimelineClipGroup(group))
        : [],
      audioItems,
    },
    subtitles: normalizeEditorSubtitleTrackSettings(project.subtitles),
  };
}

export function normalizeLegacyEditorExportRecord(
  record: EditorExportRecord | LegacyEditorExportRecord
): EditorExportRecord {
  return {
    ...record,
    engine: record.engine === "browser" ? "browser" : "system",
  };
}

export function createEditorAssetRecord(input: {
  projectId: string;
  role?: EditorAssetRecord["role"];
  origin?: EditorAssetRecord["origin"];
  kind: EditorAssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  derivedFromAssetId?: string;
  sourceAssetId?: string;
  sourceType: EditorAssetRecord["sourceType"];
  sourceMediaId?: string;
  sourceProjectId?: string;
  captionSource: EditorAssetRecord["captionSource"];
  fileBlob?: File;
  id?: string;
  now?: number;
}): EditorAssetRecord {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? makeId("editor_asset"),
    projectId: input.projectId,
    role: input.role ?? "support",
    origin: input.origin ?? (input.sourceType === "history" ? "manual" : "upload"),
    sourceType: input.sourceType,
    kind: input.kind,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    durationSeconds: Number(input.durationSeconds || 0),
    width: input.width,
    height: input.height,
    hasAudio: input.hasAudio,
    derivedFromAssetId: input.derivedFromAssetId,
    sourceAssetId: input.sourceAssetId,
    sourceMediaId: input.sourceMediaId,
    sourceProjectId: input.sourceProjectId,
    createdAt: now,
    updatedAt: now,
    captionSource: input.captionSource,
    fileBlob: input.fileBlob,
  };
}

export function markEditorProjectExporting(project: EditorProjectRecord, now = Date.now()): EditorProjectRecord {
  return {
    ...project,
    status: "exporting",
    updatedAt: now,
    lastOpenedAt: now,
    lastError: undefined,
  };
}

export function markEditorProjectFailed(project: EditorProjectRecord, error: string, now = Date.now()): EditorProjectRecord {
  return {
    ...project,
    status: "error",
    updatedAt: now,
    lastOpenedAt: now,
    lastError: error,
  };
}

export function markEditorProjectSaved(project: EditorProjectRecord, now = Date.now()): EditorProjectRecord {
  return {
    ...project,
    status: "draft",
    updatedAt: now,
    lastOpenedAt: now,
  };
}

export function restoreEditorProjectAfterCanceledExport(
  project: EditorProjectRecord,
  previousProject: Pick<EditorProjectRecord, "status" | "latestExport" | "lastError"> | null,
  now = Date.now()
): EditorProjectRecord {
  const previousStatus = previousProject?.status;
  return {
    ...project,
    status: previousStatus && previousStatus !== "exporting" ? previousStatus : "draft",
    updatedAt: now,
    lastOpenedAt: now,
    latestExport: previousProject?.latestExport ?? project.latestExport,
    lastError: previousProject?.lastError,
  };
}

function sanitizePersistedPlayheadSeconds(playheadSeconds: number): number {
  return Number.isFinite(playheadSeconds) ? Math.max(0, playheadSeconds) : 0;
}

export function serializeEditorProjectForPersistence(
  project: EditorProjectRecord,
  persistedPlayheadSeconds = project.timeline.playheadSeconds
): EditorProjectRecord {
  return {
    ...project,
    timeline: {
      ...project.timeline,
      playheadSeconds: sanitizePersistedPlayheadSeconds(persistedPlayheadSeconds),
    },
  };
}

export function getEditorProjectPersistenceFingerprint(
  project: EditorProjectRecord,
  assetIds: readonly string[],
  persistedPlayheadSeconds = project.timeline.playheadSeconds
): string {
  return JSON.stringify({
    project: serializeEditorProjectForPersistence(project, persistedPlayheadSeconds),
    assetIds,
  });
}

export function buildEditorExportRecord(input: {
  id?: string;
  projectId: string;
  sourceAssetId?: string;
  outputAssetId?: string;
  engine: EditorExportEngine;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  aspectRatio: EditorExportRecord["aspectRatio"];
  resolution: EditorExportRecord["resolution"];
  width: number;
  height: number;
  warnings?: string[];
  error?: string;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
  createdAt?: number;
  status?: EditorExportRecord["status"];
}): EditorExportRecord {
  return {
    id: input.id ?? makeId("editor_export"),
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    outputAssetId: input.outputAssetId,
    createdAt: input.createdAt ?? Date.now(),
    status: input.status ?? (input.error ? "failed" : "completed"),
    engine: input.engine,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    width: input.width,
    height: input.height,
    warnings: input.warnings,
    error: input.error,
    debugFfmpegCommand: input.debugFfmpegCommand,
    debugNotes: input.debugNotes,
  };
}

export function applyResolvedSubtitleStyle(project: EditorProjectRecord): EditorProjectRecord {
  return {
    ...project,
    subtitles: normalizeEditorSubtitleTrackSettings(project.subtitles),
  };
}
