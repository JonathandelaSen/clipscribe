import type { ShortExportGeometryResult } from "@/lib/creator/core/export-geometry";
import type { CreatorShortSemanticSubtitlePayload } from "@/lib/creator/semantic-subtitles";
import type {
  CreatorReactiveOverlayPresetId,
  CreatorShortSystemExportCounts,
  CreatorShortSystemExportTimingsMs,
  CreatorShortEditorState,
  CreatorShortRasterOverlayKind,
  CreatorShortRenderResponse,
  CreatorSuggestedShort,
} from "@/lib/creator/types";

export const CREATOR_SYSTEM_EXPORT_FORM_FIELDS = {
  payload: "payload",
  engine: "engine",
  sourceFile: "source_file",
  visualSourceFile: "visual_source_file",
  overlays: "overlays",
  overlaySequences: "overlay_sequences",
} as const;

const CREATOR_SYSTEM_EXPORT_HEADER_NAMES = {
  filename: "x-clipscribe-short-export-filename",
  width: "x-clipscribe-short-export-width",
  height: "x-clipscribe-short-export-height",
  sizeBytes: "x-clipscribe-short-export-size-bytes",
  durationSeconds: "x-clipscribe-short-export-duration-seconds",
  subtitleBurnedIn: "x-clipscribe-short-export-subtitle-burned-in",
  renderModeUsed: "x-clipscribe-short-export-render-mode-used",
  encoderUsed: "x-clipscribe-short-export-encoder-used",
  timingsMs: "x-clipscribe-short-export-timings-ms",
  counts: "x-clipscribe-short-export-counts",
  debugNotes: "x-clipscribe-short-export-debug-notes",
  debugFfmpegCommand: "x-clipscribe-short-export-debug-ffmpeg-command",
} as const;

export interface CreatorShortSystemExportOverlayDescriptor {
  start: number;
  end: number;
  fileField: string;
  filename: string;
  kind?: CreatorShortRasterOverlayKind;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** FFmpeg crop expression for atlas overlays. When set, the server applies
   *  `crop=overlayWidth:overlayHeight:0:EXPR` before the overlay filter. */
  cropExpression?: string;
}

export interface CreatorShortSystemExportOverlaySequenceDescriptor {
  fps: number;
  frameCount: number;
  fileFieldPrefix: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mimeType?: string;
}

export interface CreatorShortSystemExportOverlaySummary {
  subtitleFrameCount: number;
  introOverlayFrameCount: number;
  outroOverlayFrameCount: number;
  reactiveOverlayFrameCount?: number;
  reactiveOverlayCount?: number;
  reactiveOverlayPresetIds?: CreatorReactiveOverlayPresetId[];
}

export interface CreatorShortSystemExportPayload {
  renderRequestId?: string;
  sourceFilename: string;
  shortName?: string;
  short: CreatorSuggestedShort;
  editor: CreatorShortEditorState;
  sourceVideoSize: { width: number; height: number };
  visualSource?: {
    kind: "video" | "image";
    filename: string;
  } | null;
  sourceTrim?: {
    requestedOffsetSeconds: number;
    requestedDurationSeconds: number;
  } | null;
  geometry: ShortExportGeometryResult;
  subtitleRenderMode: "fast_ass" | "png_parity";
  semanticSubtitles?: CreatorShortSemanticSubtitlePayload | null;
  subtitleBurnedIn: boolean;
  overlaySummary: CreatorShortSystemExportOverlaySummary;
  clientTimingsMs?: Partial<CreatorShortSystemExportTimingsMs["client"]>;
}

export interface CreatorShortSystemExportResponseMetadata {
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  subtitleBurnedIn: boolean;
  renderModeUsed: "fast_ass" | "png_parity";
  encoderUsed: string;
  timingsMs?: CreatorShortSystemExportTimingsMs;
  counts?: CreatorShortSystemExportCounts;
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

function parseNumericHeader(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBooleanHeader(value: string | null): boolean {
  return value === "1" || value === "true";
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

function parseJsonHeader<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function buildCreatorShortSystemExportResponseHeaders(
  metadata: CreatorShortSystemExportResponseMetadata
): HeadersInit {
  return {
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.filename]: metadata.filename,
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.width]: String(metadata.width),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.height]: String(metadata.height),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.sizeBytes]: String(metadata.sizeBytes),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.durationSeconds]: String(metadata.durationSeconds),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.subtitleBurnedIn]: metadata.subtitleBurnedIn ? "1" : "0",
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.renderModeUsed]: metadata.renderModeUsed,
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.encoderUsed]: metadata.encoderUsed,
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.timingsMs]: JSON.stringify(metadata.timingsMs ?? {}),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.counts]: JSON.stringify(metadata.counts ?? {}),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.debugNotes]: JSON.stringify(metadata.debugNotes),
    [CREATOR_SYSTEM_EXPORT_HEADER_NAMES.debugFfmpegCommand]: JSON.stringify(metadata.debugFfmpegCommand),
  };
}

export function parseCreatorShortSystemExportResponseHeaders(
  headers: Headers,
  fallback: {
    filename: string;
  }
): CreatorShortSystemExportResponseMetadata {
  return {
    filename: headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.filename) || fallback.filename,
    width: parseNumericHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.width)),
    height: parseNumericHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.height)),
    sizeBytes: parseNumericHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.sizeBytes)),
    durationSeconds: parseNumericHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.durationSeconds)),
    subtitleBurnedIn: parseBooleanHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.subtitleBurnedIn)),
    renderModeUsed:
      headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.renderModeUsed) === "png_parity" ? "png_parity" : "fast_ass",
    encoderUsed: headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.encoderUsed) || "libx264",
    timingsMs: parseJsonHeader<CreatorShortSystemExportTimingsMs>(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.timingsMs)),
    counts: parseJsonHeader<CreatorShortSystemExportCounts>(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.counts)),
    debugNotes: parseStringArrayHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.debugNotes)),
    debugFfmpegCommand: parseStringArrayHeader(headers.get(CREATOR_SYSTEM_EXPORT_HEADER_NAMES.debugFfmpegCommand)),
  };
}

export function buildCompletedCreatorShortRenderResponse(input: {
  providerMode: CreatorShortRenderResponse["providerMode"];
  jobId: string;
  createdAt: number;
  filename: string;
  subtitleBurnedIn: boolean;
  ffmpegCommandPreview: string[];
  notes: string[];
  durationSeconds?: number;
  renderModeUsed?: "fast_ass" | "png_parity";
  encoderUsed?: string;
  timingsMs?: CreatorShortSystemExportTimingsMs;
  counts?: CreatorShortSystemExportCounts;
}): CreatorShortRenderResponse {
  return {
    ok: true,
    providerMode: input.providerMode,
    jobId: input.jobId,
    status: "completed",
    createdAt: input.createdAt,
    estimatedSeconds: Math.max(0, input.durationSeconds ?? 0),
    output: {
      filename: input.filename,
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleBurnedIn: input.subtitleBurnedIn,
    },
    debugPreview: {
      ffmpegCommandPreview: input.ffmpegCommandPreview,
      notes: input.notes,
      renderModeUsed: input.renderModeUsed,
      encoderUsed: input.encoderUsed,
      timingsMs: input.timingsMs,
      counts: input.counts,
    },
  };
}
