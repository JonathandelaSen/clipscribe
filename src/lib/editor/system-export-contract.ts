import type { EditorAssetRecord, EditorResolution } from "./types";

export const EDITOR_SYSTEM_EXPORT_FORM_FIELDS = {
  project: "project",
  resolution: "resolution",
  engine: "engine",
  assets: "assets",
} as const;

const EDITOR_SYSTEM_EXPORT_HEADER_NAMES = {
  filename: "x-clipscribe-export-filename",
  width: "x-clipscribe-export-width",
  height: "x-clipscribe-export-height",
  sizeBytes: "x-clipscribe-export-size-bytes",
  durationSeconds: "x-clipscribe-export-duration-seconds",
  warnings: "x-clipscribe-export-warnings",
  debugNotes: "x-clipscribe-export-debug-notes",
  debugFfmpegCommand: "x-clipscribe-export-debug-ffmpeg-command",
} as const;

export type SystemEditorExportAssetRecord = Omit<EditorAssetRecord, "fileBlob">;

export interface EditorSystemExportAssetDescriptor {
  asset: SystemEditorExportAssetRecord;
  fileField: string;
}

export interface EditorSystemExportResponseMetadata {
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  warnings: string[];
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

function parseNumericHeader(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStringArrayHeader(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function buildEditorSystemExportResponseHeaders(
  metadata: EditorSystemExportResponseMetadata
): HeadersInit {
  return {
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.filename]: metadata.filename,
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.width]: String(metadata.width),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.height]: String(metadata.height),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.sizeBytes]: String(metadata.sizeBytes),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.durationSeconds]: String(metadata.durationSeconds),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.warnings]: JSON.stringify(metadata.warnings),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.debugNotes]: JSON.stringify(metadata.debugNotes),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.debugFfmpegCommand]: JSON.stringify(metadata.debugFfmpegCommand),
  };
}

export function parseEditorSystemExportResponseHeaders(
  headers: Headers,
  fallback: {
    filename: string;
    resolution: EditorResolution;
  }
): EditorSystemExportResponseMetadata {
  return {
    filename: headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.filename) || fallback.filename,
    width: parseNumericHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.width)),
    height: parseNumericHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.height)),
    sizeBytes: parseNumericHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.sizeBytes)),
    durationSeconds: parseNumericHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.durationSeconds)),
    warnings: parseStringArrayHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.warnings)),
    debugNotes: parseStringArrayHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.debugNotes)),
    debugFfmpegCommand: parseStringArrayHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.debugFfmpegCommand)),
  };
}
