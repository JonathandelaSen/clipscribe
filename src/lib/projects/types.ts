import type { HistoryItem, TranscriptVersion } from "@/lib/history";
import type {
  EditorAssetRecord,
  EditorExportCounts,
  EditorExportEngine,
  EditorExportTimingsMs,
  EditorProjectRecord,
} from "@/lib/editor/types";
import type {
  CreatorShortEditorState,
  CreatorImageProjectRecord,
  CreatorShortPlan,
  CreatorShortSystemExportCounts,
  CreatorShortSystemExportTimingsMs,
  CreatorSuggestedShort,
  CreatorVideoInfoProjectRecord,
  CreatorViralClip,
} from "@/lib/creator/types";
import type { ProjectVoiceoverDraft, ProjectVoiceoverRecord } from "@/lib/voiceover/types";

export type ContentProjectRecord = EditorProjectRecord & {
  activeSourceAssetId?: string;
  /** @deprecated Use youtubeVideoInfoHistory instead. Kept for migration from legacy single-record shape. */
  youtubeVideoInfo?: CreatorVideoInfoProjectRecord;
  youtubeVideoInfoHistory?: CreatorVideoInfoProjectRecord[];
  aiImageHistory?: CreatorImageProjectRecord[];
  voiceoverDraft?: ProjectVoiceoverDraft;
};

export type ProjectAssetRole = "source" | "derived" | "support";
export type ProjectAssetOrigin =
  | "upload"
  | "short-export"
  | "timeline-export"
  | "manual"
  | "ai-audio"
  | "ai-image"
  | "youtube-import";

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
export type ProjectYouTubeUploadSourceMode = "local_file" | "project_asset" | "project_export";
export type ProjectYouTubeUploadStepState = "applied" | "skipped" | "failed";

export interface ProjectYouTubeUploadDraftSnapshot {
  publishIntent?: "short" | "standard";
  title: string;
  description: string;
  privacyStatus: "private" | "unlisted" | "public";
  tags: string[];
  categoryId?: string;
  defaultLanguage?: string;
  publishAt?: string;
  recordingDate?: string;
  localizations: Array<{
    locale: string;
    title: string;
    description: string;
  }>;
  relatedVideo?: {
    videoId: string;
    title: string;
    watchUrl: string;
    studioUrl: string;
    privacyStatus?: "private" | "unlisted" | "public";
    publishedAt?: string;
    thumbnailUrl?: string;
  };
}

export interface ProjectYouTubeUploadResultSnapshot {
  processingStatus: string;
  uploadStatus?: string;
  failureReason?: string;
  rejectionReason?: string;
  privacyStatus?: string;
  thumbnailState: ProjectYouTubeUploadStepState;
  captionState: ProjectYouTubeUploadStepState;
}

export interface ProjectYouTubeUploadRecord {
  id: string;
  projectId: string;
  uploadedAt: number;
  videoId: string;
  watchUrl: string;
  studioUrl: string;
  sourceMode: ProjectYouTubeUploadSourceMode;
  sourceAssetId?: string;
  sourceExportId?: string;
  outputAssetId?: string;
  sourceFilename: string;
  draft: ProjectYouTubeUploadDraftSnapshot;
  result: ProjectYouTubeUploadResultSnapshot;
}

export interface ProjectExportRecord {
  id: string;
  projectId: string;
  kind: ProjectExportKind;
  sourceAssetId?: string;
  shortProjectId?: string;
  shortProjectName?: string;
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
  timingsMs?: CreatorShortSystemExportTimingsMs | EditorExportTimingsMs;
  counts?: CreatorShortSystemExportCounts | EditorExportCounts;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  short?: CreatorSuggestedShort;
  editor?: CreatorShortEditorState;
}

export type ProjectHistoryItem = HistoryItem & {
  projectId: string;
  assetId: string;
};

export type { ProjectVoiceoverRecord };
