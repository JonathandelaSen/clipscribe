export type ComposerAssetType = "audio" | "video";
export type ComposerLane = "audio" | "video";
export type ComposerFitMode = "fit" | "fill";
export type ComposerRatio = "9:16" | "1:1" | "16:9";
export type ComposerQuality = "low" | "medium" | "high";
export type ComposerProjectStatus = "draft" | "exporting" | "exported" | "error";
export type ComposerExportStatus = "completed" | "failed";

export interface ComposerExportSettings {
  ratio: ComposerRatio;
  quality: ComposerQuality;
}

export interface ComposerTimelineItem {
  id: string;
  assetId: string;
  lane: ComposerLane;
  timelineStartSeconds: number;
  sourceStartSeconds: number;
  durationSeconds: number;
  volume: number;
  muted: boolean;
  fitMode?: ComposerFitMode;
  offsetX?: number;
  offsetY?: number;
}

export interface ComposerProjectTimelineSnapshot {
  items: ComposerTimelineItem[];
}

export interface ComposerProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: ComposerProjectStatus;
  exportSettings: ComposerExportSettings;
  timeline: ComposerProjectTimelineSnapshot;
  lastExportId?: string;
  lastError?: string;
}

export interface ComposerAssetRecord {
  id: string;
  projectId: string;
  type: ComposerAssetType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  fileId: string;
  createdAt: number;
}

export interface ComposerAssetFileRecord {
  id: string;
  file: File;
}

export interface ComposerExportRecord {
  id: string;
  projectId: string;
  createdAt: number;
  status: ComposerExportStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  ratio: ComposerRatio;
  quality: ComposerQuality;
  resolution: string;
  fileBlob?: Blob;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
  error?: string;
}

