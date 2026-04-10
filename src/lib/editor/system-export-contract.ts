import type {
  EditorAssetRecord,
  EditorExportCounts,
  EditorExportTimingsMs,
  EditorResolution,
} from "./types";

export const EDITOR_SYSTEM_EXPORT_FORM_FIELDS = {
  requestId: "requestId",
  project: "project",
  resolution: "resolution",
  engine: "engine",
  assets: "assets",
  overlays: "overlays",
  overlaySequences: "overlaySequences",
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
  encoderUsed: "x-clipscribe-export-encoder-used",
  hardwareAccelerated: "x-clipscribe-export-hardware-accelerated",
  timingsMs: "x-clipscribe-export-timings-ms",
  counts: "x-clipscribe-export-counts",
} as const;

export type SystemEditorExportAssetRecord = Omit<EditorAssetRecord, "fileBlob">;

export interface EditorSystemExportAssetDescriptor {
  asset: SystemEditorExportAssetRecord;
  fileField: string;
}

export interface EditorSystemExportOverlayDescriptor {
  start: number;
  end: number;
  fileField: string;
  filename: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cropExpression?: string;
}

export interface EditorSystemExportOverlaySequenceDescriptor {
  fps: number;
  frameCount: number;
  fileFieldPrefix: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mimeType: "image/png" | "image/webp";
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
  encoderUsed?: string;
  hardwareAccelerated?: boolean;
  timingsMs?: EditorExportTimingsMs;
  counts?: EditorExportCounts;
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

function parseBooleanHeader(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseObjectHeader<T extends object>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as T;
  } catch {
    return undefined;
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
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.encoderUsed]: metadata.encoderUsed ?? "",
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.hardwareAccelerated]:
      typeof metadata.hardwareAccelerated === "boolean" ? String(metadata.hardwareAccelerated) : "",
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.timingsMs]: JSON.stringify(metadata.timingsMs ?? {}),
    [EDITOR_SYSTEM_EXPORT_HEADER_NAMES.counts]: JSON.stringify(metadata.counts ?? {}),
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
    encoderUsed: headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.encoderUsed) || undefined,
    hardwareAccelerated: parseBooleanHeader(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.hardwareAccelerated)),
    timingsMs: parseObjectHeader<EditorExportTimingsMs>(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.timingsMs)),
    counts: parseObjectHeader<EditorExportCounts>(headers.get(EDITOR_SYSTEM_EXPORT_HEADER_NAMES.counts)),
  };
}
