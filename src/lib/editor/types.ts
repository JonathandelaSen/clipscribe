import type { SubtitleChunk } from "../history";
import type { CreatorSubtitleStyleSettings, CreatorVerticalEditorPreset } from "../creator/types";

export type EditorAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type EditorResolution = "720p" | "1080p" | "4K";
export type EditorProjectStatus = "draft" | "exporting" | "error";
export type EditorExportStatus = "completed" | "failed";
export type EditorExportEngine = "browser" | "system";
export type EditorAssetSource = "history" | "upload";
export type EditorAssetKind = "video" | "audio";

export type EditorSubtitlePreset = CreatorVerticalEditorPreset["subtitleStyle"];

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
      kind: "embedded-srt";
      label: string;
      language?: string;
      chunks: SubtitleChunk[];
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

export type TimelineSelectionKind = "video" | "video-group" | "audio";

export interface TimelineSelection {
  kind: TimelineSelectionKind;
  id: string;
}

export interface EditorSubtitleTrackSettings {
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
  assetIds: string[];
  timeline: EditorProjectTimelineState;
  subtitles: EditorSubtitleTrackSettings;
  latestExport?: EditorExportSummary;
  lastError?: string;
}

export interface EditorAssetRecord {
  id: string;
  projectId: string;
  sourceType: EditorAssetSource;
  kind: EditorAssetKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
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

export interface ResolvedEditorAsset {
  asset: EditorAssetRecord;
  file: File | null;
  missing: boolean;
}
