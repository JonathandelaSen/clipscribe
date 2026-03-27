import type { HistoryItem, TranscriptVersion } from "@/lib/history";
import type { EditorAssetRecord, EditorExportEngine, EditorProjectRecord } from "@/lib/editor/types";
import type {
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorShortSystemExportCounts,
  CreatorShortSystemExportTimingsMs,
  CreatorSuggestedShort,
  CreatorVideoInfoProjectRecord,
  CreatorViralClip,
} from "@/lib/creator/types";

export type ContentProjectRecord = EditorProjectRecord & {
  activeSourceAssetId?: string;
  youtubeVideoInfo?: CreatorVideoInfoProjectRecord;
};

export type ProjectAssetRole = "source" | "derived" | "support";
export type ProjectAssetOrigin = "upload" | "short-export" | "timeline-export" | "manual";

export interface ProjectAssetRecord extends EditorAssetRecord {
  role: ProjectAssetRole;
  origin: ProjectAssetOrigin;
  derivedFromAssetId?: string;
}

export interface AssetTranscriptRecord {
  assetId: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  timestamp: number;
  activeTranscriptVersionId?: string;
  transcripts: TranscriptVersion[];
}

export type ProjectExportKind = "short" | "timeline";
export type ProjectExportStatus = "completed" | "failed";

export interface ProjectExportRecord {
  id: string;
  projectId: string;
  kind: ProjectExportKind;
  sourceAssetId?: string;
  shortProjectId?: string;
  outputAssetId?: string;
  createdAt: number;
  status: ProjectExportStatus;
  sourceFilename?: string;
  engine?: EditorExportEngine;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  aspectRatio?: EditorProjectRecord["aspectRatio"];
  resolution?: "720p" | "1080p" | "4K" | "1080x1920";
  width?: number;
  height?: number;
  warnings?: string[];
  error?: string;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
  renderModeUsed?: "fast_ass" | "png_parity";
  encoderUsed?: string;
  timingsMs?: CreatorShortSystemExportTimingsMs;
  counts?: CreatorShortSystemExportCounts;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  short?: CreatorSuggestedShort;
  editor?: CreatorShortEditorState;
}

export type ProjectHistoryItem = HistoryItem & {
  projectId: string;
  assetId: string;
};
