import type {
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorViralClip,
  ShortsPlatform,
} from "@/lib/creator/types";

export type CreatorShortProjectStatus = "draft" | "exporting" | "exported" | "error";
export type CreatorShortExportStatus = "completed" | "failed";

export interface CreatorShortProjectRecord {
  id: string;
  projectId: string;
  sourceAssetId: string;
  sourceFilename: string;
  transcriptId: string;
  subtitleId: string;
  clipId: string;
  planId: string;
  platform: ShortsPlatform;
  name: string;
  clip: CreatorViralClip;
  plan: CreatorShortPlan;
  editor: CreatorShortEditorState;
  createdAt: number;
  updatedAt: number;
  status: CreatorShortProjectStatus;
  lastExportId?: string;
  lastError?: string;
}

export interface CreatorShortExportRecord {
  id: string;
  shortProjectId: string;
  projectId: string;
  sourceAssetId?: string;
  outputAssetId?: string;
  sourceFilename: string;
  platform: ShortsPlatform;
  createdAt: number;
  status: CreatorShortExportStatus;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  fileBlob?: Blob;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
  clip: CreatorViralClip;
  plan: CreatorShortPlan;
  editor: CreatorShortEditorState;
  error?: string;
}
