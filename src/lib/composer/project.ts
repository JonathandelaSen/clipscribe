import { makeId } from "@/lib/history";
import type {
  ComposerAssetRecord,
  ComposerExportRecord,
  ComposerExportSettings,
  ComposerProjectRecord,
  ComposerProjectStatus,
  ComposerTimelineItem,
} from "@/lib/composer/types";

export const DEFAULT_COMPOSER_EXPORT_SETTINGS: ComposerExportSettings = {
  ratio: "9:16",
  quality: "medium",
};

export function buildComposerProjectRecord(input: {
  now: number;
  status: ComposerProjectStatus;
  name: string;
  timelineItems: ComposerTimelineItem[];
  exportSettings: ComposerExportSettings;
  existing?: ComposerProjectRecord;
  explicitId?: string;
  lastExportId?: string;
  lastError?: string;
}): ComposerProjectRecord {
  return {
    id: input.existing?.id ?? input.explicitId ?? makeId("composerproj"),
    name: input.name.trim() || input.existing?.name || "Untitled timeline",
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
    status: input.status,
    exportSettings: input.exportSettings,
    timeline: {
      items: input.timelineItems,
    },
    lastExportId: input.lastExportId ?? input.existing?.lastExportId,
    lastError: input.status === "error" ? input.lastError ?? input.existing?.lastError : undefined,
  };
}

export function deriveComposerProjectName(assetFilename?: string | null): string {
  if (!assetFilename) return "Untitled timeline";
  const stem = assetFilename.replace(/\.[^/.]+$/, "").trim();
  return stem ? `${stem} timeline` : "Untitled timeline";
}

export function buildComposerAssetRecord(input: {
  projectId: string;
  fileId: string;
  type: ComposerAssetRecord["type"];
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  createdAt: number;
  explicitId?: string;
}): ComposerAssetRecord {
  return {
    id: input.explicitId ?? makeId("composerasset"),
    projectId: input.projectId,
    type: input.type,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    durationSeconds: input.durationSeconds,
    width: input.width,
    height: input.height,
    hasAudio: input.hasAudio,
    fileId: input.fileId,
    createdAt: input.createdAt,
  };
}

export function buildComposerVideoTimelineItem(input: {
  assetId: string;
  timelineStartSeconds: number;
  durationSeconds: number;
}): ComposerTimelineItem {
  return {
    id: makeId("composervideo"),
    assetId: input.assetId,
    lane: "video",
    timelineStartSeconds: input.timelineStartSeconds,
    sourceStartSeconds: 0,
    durationSeconds: input.durationSeconds,
    volume: 1,
    muted: true,
    fitMode: "fill",
    offsetX: 0,
    offsetY: 0,
  };
}

export function buildComposerAudioTimelineItem(input: {
  assetId: string;
  timelineStartSeconds?: number;
  durationSeconds: number;
}): ComposerTimelineItem {
  return {
    id: makeId("composeraudio"),
    assetId: input.assetId,
    lane: "audio",
    timelineStartSeconds: input.timelineStartSeconds ?? 0,
    sourceStartSeconds: 0,
    durationSeconds: input.durationSeconds,
    volume: 1,
    muted: false,
  };
}

export function buildComposerExportRecord(input: {
  projectId: string;
  createdAt: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  ratio: ComposerExportSettings["ratio"];
  quality: ComposerExportSettings["quality"];
  resolution: string;
  fileBlob?: Blob;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
  status?: ComposerExportRecord["status"];
  error?: string;
}): ComposerExportRecord {
  return {
    id: makeId("composerexport"),
    projectId: input.projectId,
    createdAt: input.createdAt,
    status: input.status ?? "completed",
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    ratio: input.ratio,
    quality: input.quality,
    resolution: input.resolution,
    fileBlob: input.fileBlob,
    debugFfmpegCommand: input.debugFfmpegCommand,
    debugNotes: input.debugNotes,
    error: input.error,
  };
}
