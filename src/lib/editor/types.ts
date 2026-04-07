import type { SubtitleChunk } from "../history";
import type {
  CreatorSubtitleStyleSettings,
  CreatorSubtitleTimingMode,
  CreatorVerticalEditorPreset,
} from "../creator/types";

export type EditorAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type EditorResolution = "720p" | "1080p" | "4K";
export type EditorProjectStatus = "draft" | "exporting" | "error";
export type EditorExportStatus = "completed" | "failed";
export type EditorExportEngine = "system";
export type EditorAssetSource = "history" | "upload";
export type EditorAssetKind = "video" | "audio" | "image";
export type EditorAssetRole = "source" | "derived" | "support";
export type EditorAssetOrigin = "upload" | "short-export" | "timeline-export" | "manual" | "ai-audio";

export type EditorSubtitlePreset = CreatorVerticalEditorPreset["subtitleStyle"];
export const EDITOR_SUBTITLE_TRACK_ID = "subtitle-track";

export type CaptionSourceRef =
  | {
      kind: "none";
    }
  | {
      kind: "history-subtitle";
      sourceProjectId: string;
      transcriptId: string;
      subtitleId: string;
      language: string;
      label: string;
    }
  | {
      kind: "asset-subtitle";
      sourceAssetId: string;
      transcriptId: string;
      subtitleId: string;
      language: string;
      label: string;
    }
  | {
      kind: "embedded-srt";
      label: string;
      language?: string;
      chunks: SubtitleChunk[];
    };

export type EditorSubtitleTrackSource =
  | {
      kind: "none";
    }
  | {
      kind: "history-subtitle";
      sourceProjectId: string;
      transcriptId: string;
      subtitleId: string;
    }
  | {
      kind: "uploaded-srt";
    };

export interface EditorCanvasState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface TimelineVideoClipActions {
  reverse: boolean;
}

export interface TimelineVideoClip {
  id: string;
  assetId: string;
  label: string;
  trimStartSeconds: number;
  trimEndSeconds: number;
  canvas: EditorCanvasState;
  volume: number;
  muted: boolean;
  actions: TimelineVideoClipActions;
}

export interface TimelineClipGroup {
  id: string;
  kind: "joined";
  clipIds: string[];
  label: string;
}

export interface TimelineAudioItem {
  id: string;
  assetId: string;
  startOffsetSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  volume: number;
  muted: boolean;
}

export interface TimelineImageItem {
  id: string;
  assetId: string;
  label: string;
  canvas: EditorCanvasState;
}

export type EditorReactiveOverlayPresetId = "waveform_line" | "equalizer_bars" | "pulse_ring";

export interface TimelineOverlayItem {
  id: string;
  presetId: EditorReactiveOverlayPresetId;
  startOffsetSeconds: number;
  durationSeconds: number;
  positionXPercent: number;
  positionYPercent: number;
  widthPercent: number;
  heightPercent: number;
  scale: number;
  opacity: number;
  tintHex: string;
  sensitivity: number;
  smoothing: number;
}

export type TimelineSelectionKind = "video" | "video-group" | "audio" | "image" | "overlay" | "subtitle";

export interface TimelineSelection {
  kind: TimelineSelectionKind;
  id: string;
}

export interface EditorSubtitleTrackSettings {
  source: EditorSubtitleTrackSource;
  label?: string;
  language?: string;
  chunks: SubtitleChunk[];
  subtitleTimingMode: CreatorSubtitleTimingMode;
  offsetSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  enabled: boolean;
  preset: EditorSubtitlePreset;
  positionXPercent: number;
  positionYPercent: number;
  scale: number;
  style?: Partial<CreatorSubtitleStyleSettings>;
}

export interface EditorProjectTimelineState {
  playheadSeconds: number;
  zoomLevel: number;
  selectedItem?: TimelineSelection;
  imageItems: TimelineImageItem[];
  overlayItems: TimelineOverlayItem[];
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
  audioItems: TimelineAudioItem[];
}

export interface EditorExportSummary {
  id: string;
  createdAt: number;
  filename: string;
  aspectRatio: EditorAspectRatio;
  resolution: EditorResolution;
  engine: EditorExportEngine;
  status: EditorExportStatus;
}

export interface EditorProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  status: EditorProjectStatus;
  aspectRatio: EditorAspectRatio;
  activeSourceAssetId?: string;
  assetIds: string[];
  timeline: EditorProjectTimelineState;
  subtitles: EditorSubtitleTrackSettings;
  latestExport?: EditorExportSummary;
  lastError?: string;
}

export interface EditorAssetRecord {
  id: string;
  projectId: string;
  role: EditorAssetRole;
  origin: EditorAssetOrigin;
  sourceType: EditorAssetSource;
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
  sourceMediaId?: string;
  sourceProjectId?: string;
  createdAt: number;
  updatedAt: number;
  captionSource: CaptionSourceRef;
  fileBlob?: File;
}

export interface EditorExportRecord {
  id: string;
  projectId: string;
  sourceAssetId?: string;
  outputAssetId?: string;
  createdAt: number;
  status: EditorExportStatus;
  engine: EditorExportEngine;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  aspectRatio: EditorAspectRatio;
  resolution: EditorResolution;
  width: number;
  height: number;
  warnings?: string[];
  error?: string;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
}

export interface TimelineClipPlacement {
  clip: TimelineVideoClip;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  index: number;
}

export interface TimelineAudioPlacement {
  item: TimelineAudioItem;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  index: number;
}

export interface TimelineImagePlacement {
  item: TimelineImageItem;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  index: number;
}

export interface TimelineOverlayPlacement {
  item: TimelineOverlayItem;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  index: number;
}

export interface ResolvedEditorAsset {
  asset: EditorAssetRecord;
  file: File | null;
  missing: boolean;
}
