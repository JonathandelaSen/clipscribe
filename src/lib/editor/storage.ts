import {
  getDefaultCreatorSubtitleStyle,
  resolveCreatorSubtitleStyle,
} from "../creator/subtitle-style";
import { makeId } from "../history";
import type {
  EditorAspectRatio,
  EditorAssetKind,
  EditorAssetRecord,
  EditorExportRecord,
  EditorProjectRecord,
  EditorSubtitlePreset,
  TimelineSelection,
  TimelineAudioItem,
  TimelineVideoClip,
} from "./types";

const DEFAULT_SUBTITLE_PRESET: EditorSubtitlePreset = "clean_caption";

type LegacyEditorProjectTimelineState = Partial<EditorProjectRecord["timeline"]> & {
  selectedClipId?: string;
  audioTrack?: TimelineAudioItem | null;
  audioItems?: TimelineAudioItem[];
  selectedItem?: TimelineSelection;
};

type LegacyEditorProjectRecord = Omit<EditorProjectRecord, "timeline"> & {
  timeline: LegacyEditorProjectTimelineState;
};

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
    canvas: {
      zoom: 1,
      panX: 0,
      panY: 0,
    },
    volume: 1,
    muted: false,
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
    volume: 1,
    muted: false,
  };
}

export function createEmptyEditorProject(input?: {
  id?: string;
  now?: number;
  name?: string;
  aspectRatio?: EditorAspectRatio;
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
    assetIds: [],
    timeline: {
      playheadSeconds: 0,
      zoomLevel: 1,
      selectedItem: undefined,
      videoClips: [],
      audioItems: [],
    },
    subtitles: {
      enabled: true,
      preset: DEFAULT_SUBTITLE_PRESET,
      positionXPercent: 50,
      positionYPercent: 84,
      scale: 1,
      style: getDefaultCreatorSubtitleStyle(DEFAULT_SUBTITLE_PRESET),
    },
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
    timeline: {
      playheadSeconds: timeline.playheadSeconds ?? 0,
      zoomLevel: timeline.zoomLevel ?? 1,
      selectedItem,
      videoClips: Array.isArray(timeline.videoClips) ? timeline.videoClips : [],
      audioItems,
    },
  };
}

export function createEditorAssetRecord(input: {
  projectId: string;
  kind: EditorAssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
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
    sourceType: input.sourceType,
    kind: input.kind,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    durationSeconds: Number(input.durationSeconds || 0),
    width: input.width,
    height: input.height,
    hasAudio: input.hasAudio,
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

export function buildEditorExportRecord(input: {
  id?: string;
  projectId: string;
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
    createdAt: input.createdAt ?? Date.now(),
    status: input.status ?? (input.error ? "failed" : "completed"),
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
    subtitles: {
      ...project.subtitles,
      style: resolveCreatorSubtitleStyle(project.subtitles.preset, project.subtitles.style),
    },
  };
}
