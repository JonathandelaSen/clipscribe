import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CREATOR_SYSTEM_EXPORT_FORM_FIELDS,
  type CreatorShortSystemExportOverlayDescriptor,
  type CreatorShortSystemExportPayload,
  type CreatorShortSystemExportResponseMetadata,
} from "../../../creator/system-export-contract";
import { buildCanonicalShortExportGeometry } from "../../../creator/core/export-geometry";
import {
  exportCreatorShortWithSystemFfmpeg,
  isCreatorSystemRenderCanceledError,
  type CreatorSystemRenderOverlayInput,
  type CreatorSystemRenderResult,
} from "./system-render";
import { buildAssSubtitleDocument } from "./ass-subtitles";
import type { CreatorShortRenderProgressEventInput } from "./render-progress-store";
import {
  detectCreatorShortSourcePlaybackProfile,
  type CreatorShortSourcePlaybackProfile,
} from "./source-playback-profile";

type LooseRecord = Record<string, unknown>;

export interface ParsedCreatorShortSystemExportFormData {
  engine: "system";
  payload: CreatorShortSystemExportPayload;
  sourceFile: File;
  visualSourceFile?: File;
  overlays: Array<{
    descriptor: CreatorShortSystemExportOverlayDescriptor;
    file: File;
  }>;
}

export interface RenderedCreatorShortSystemExportResult {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  subtitleBurnedIn: boolean;
  renderModeUsed: CreatorShortSystemExportResponseMetadata["renderModeUsed"];
  encoderUsed: string;
  timingsMs: CreatorShortSystemExportResponseMetadata["timingsMs"];
  counts: CreatorShortSystemExportResponseMetadata["counts"];
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

export interface CreatorShortSystemExportDependencies {
  exportShort?: (input: Parameters<typeof exportCreatorShortWithSystemFfmpeg>[0]) => Promise<CreatorSystemRenderResult>;
  buildAssDocument?: (input: NonNullable<CreatorShortSystemExportPayload["semanticSubtitles"]>) => string;
  detectSourcePlaybackProfile?: typeof detectCreatorShortSourcePlaybackProfile;
}

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function sanitizeFilenameSegment(value: string, fallback: string) {
  const basename = path.basename(value || fallback);
  const normalized = basename.replace(/[^\w.-]+/g, "_");
  return normalized || fallback;
}

function toOwnedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

function parseJson<T>(value: FormDataEntryValue | null, label: string): T {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function parseOverlayDescriptor(value: unknown, index: number): CreatorShortSystemExportOverlayDescriptor {
  if (!isRecord(value)) {
    throw new Error(`overlays[${index}] is invalid.`);
  }
  if (typeof value.fileField !== "string" || !value.fileField.trim()) {
    throw new Error(`overlays[${index}].fileField is required.`);
  }
  if (typeof value.filename !== "string" || !value.filename.trim()) {
    throw new Error(`overlays[${index}].filename is required.`);
  }
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`overlays[${index}] must include a valid time range.`);
  }

  const cropExpression = typeof value.cropExpression === "string" && value.cropExpression.trim()
    ? value.cropExpression.trim()
    : undefined;
  const hasRasterBounds =
    value.x != null || value.y != null || value.width != null || value.height != null;

  let x: number | undefined;
  let y: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  if (hasRasterBounds) {
    x = Number(value.x);
    y = Number(value.y);
    width = Number(value.width);
    height = Number(value.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error(`overlays[${index}] must include finite x, y, width, and height.`);
    }
    if (x! < 0 || y! < 0 || width! <= 0 || height! <= 0) {
      throw new Error(`overlays[${index}] must include positive raster bounds.`);
    }
  }

  const kind =
    value.kind === "intro_overlay" ||
    value.kind === "outro_overlay" ||
    value.kind === "subtitle_atlas" ||
    value.kind === "subtitle_frame"
      ? value.kind
      : undefined;

  return {
    start,
    end,
    fileField: value.fileField,
    filename: value.filename,
    kind,
    x,
    y,
    width,
    height,
    cropExpression,
  };
}

function parsePayload(value: unknown): CreatorShortSystemExportPayload {
  if (!isRecord(value)) {
    throw new Error("payload is invalid.");
  }
  if (typeof value.sourceFilename !== "string" || !value.sourceFilename.trim()) {
    throw new Error("payload.sourceFilename is required.");
  }
  if (!isRecord(value.short)) {
    throw new Error("payload.short is required.");
  }
  if (!isRecord(value.editor)) {
    throw new Error("payload.editor is required.");
  }
  if (!isRecord(value.sourceVideoSize)) {
    throw new Error("payload.sourceVideoSize is required.");
  }
  const sourceWidth = Number(value.sourceVideoSize.width);
  const sourceHeight = Number(value.sourceVideoSize.height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error("payload.sourceVideoSize must include positive width and height.");
  }
  if (!isRecord(value.geometry) || typeof value.geometry.filter !== "string") {
    throw new Error("payload.geometry is required.");
  }
  if (!isRecord(value.overlaySummary)) {
    throw new Error("payload.overlaySummary is required.");
  }

  return {
    ...(value as unknown as CreatorShortSystemExportPayload),
    renderRequestId:
      typeof value.renderRequestId === "string" && value.renderRequestId.trim()
        ? value.renderRequestId.trim()
        : undefined,
    shortName:
      typeof value.shortName === "string" && value.shortName.trim()
        ? value.shortName.trim()
        : undefined,
    sourceTrim:
      isRecord(value.sourceTrim) &&
      Number.isFinite(Number(value.sourceTrim.requestedOffsetSeconds)) &&
      Number(value.sourceTrim.requestedOffsetSeconds) >= 0 &&
      Number.isFinite(Number(value.sourceTrim.requestedDurationSeconds)) &&
      Number(value.sourceTrim.requestedDurationSeconds) > 0
        ? {
            requestedOffsetSeconds: Number(value.sourceTrim.requestedOffsetSeconds),
            requestedDurationSeconds: Number(value.sourceTrim.requestedDurationSeconds),
          }
        : null,
    visualSource:
      isRecord(value.visualSource) &&
      (value.visualSource.kind === "video" || value.visualSource.kind === "image") &&
      typeof value.visualSource.filename === "string" &&
      value.visualSource.filename.trim()
        ? {
            kind: value.visualSource.kind,
            filename: value.visualSource.filename.trim(),
          }
        : null,
    subtitleRenderMode: value.subtitleRenderMode === "fast_ass" ? "fast_ass" : "png_parity",
    semanticSubtitles: isRecord(value.semanticSubtitles)
      ? (value.semanticSubtitles as unknown as CreatorShortSystemExportPayload["semanticSubtitles"])
      : null,
    clientTimingsMs: isRecord(value.clientTimingsMs)
      ? (value.clientTimingsMs as CreatorShortSystemExportPayload["clientTimingsMs"])
      : undefined,
  };
}

function inferVisualSourceKind(input: {
  payloadVisualSource?: CreatorShortSystemExportPayload["visualSource"];
  visualSourceFile?: File;
}): "video" | "image" | null {
  if (input.payloadVisualSource?.kind === "video" || input.payloadVisualSource?.kind === "image") {
    return input.payloadVisualSource.kind;
  }
  if (!input.visualSourceFile) return null;

  const mime = input.visualSourceFile.type.toLowerCase();
  const filename = input.visualSourceFile.name.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(filename)) return "image";
  if (/\.(mp4|mov|webm|mkv)$/i.test(filename)) return "video";
  return null;
}

function getOverlayRasterPixelArea(input: Pick<CreatorSystemRenderOverlayInput, "width" | "height">): number {
  return Math.max(1, input.width ?? 1080) * Math.max(1, input.height ?? 1920);
}

function round3(value: number): number {
  return Number(Math.max(0, value).toFixed(3));
}

function resolveTrimLeadInCompensationSeconds(input: {
  sourceTrim?: CreatorShortSystemExportPayload["sourceTrim"];
  sourcePlaybackProfile: CreatorShortSourcePlaybackProfile;
}) {
  const requestedDurationSeconds = input.sourceTrim?.requestedDurationSeconds ?? 0;
  if (!(requestedDurationSeconds > 0)) return 0;

  const requestedOffsetSeconds = Math.max(0, input.sourceTrim?.requestedOffsetSeconds ?? 0);
  const measuredDurationSeconds = Math.max(
    0,
    input.sourcePlaybackProfile.videoDurationSeconds,
    input.sourcePlaybackProfile.audioDurationSeconds
  );
  if (!(measuredDurationSeconds > requestedDurationSeconds)) return 0;

  const rawLeadInSeconds = measuredDurationSeconds - requestedDurationSeconds;
  const boundedLeadInSeconds = Math.min(rawLeadInSeconds, requestedOffsetSeconds);
  return boundedLeadInSeconds >= 0.25 ? round3(boundedLeadInSeconds) : 0;
}

export function parseCreatorShortSystemExportFormData(formData: FormData): ParsedCreatorShortSystemExportFormData {
  const engine = formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine);
  if (engine !== "system") {
    throw new Error("engine must be system.");
  }

  const payload = parsePayload(
    parseJson<unknown>(formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload), "payload")
  );
  const sourceFileValue = formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile);
  if (!(sourceFileValue instanceof File)) {
    throw new Error("source_file is required.");
  }
  const visualSourceFileValue = formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.visualSourceFile);
  if (visualSourceFileValue != null && !(visualSourceFileValue instanceof File)) {
    throw new Error("visual_source_file must be a file when provided.");
  }

  const rawDescriptors = parseJson<unknown[]>(
    formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays),
    "overlays"
  );
  const descriptors = rawDescriptors.map((value, index) => parseOverlayDescriptor(value, index));
  const overlays = descriptors.map((descriptor, index) => {
    const fileValue = formData.get(descriptor.fileField);
    if (!(fileValue instanceof File)) {
      throw new Error(`overlays[${index}] file is required.`);
    }
    return {
      descriptor,
      file: fileValue,
    };
  });

  return {
    engine: "system",
    payload,
    sourceFile: sourceFileValue,
    visualSourceFile: visualSourceFileValue instanceof File ? visualSourceFileValue : undefined,
    overlays,
  };
}

export async function renderCreatorShortSystemExport(
  input: {
    payload: CreatorShortSystemExportPayload;
    sourceFile: File;
    visualSourceFile?: File;
    overlays: Array<{
      descriptor: CreatorShortSystemExportOverlayDescriptor;
      file: File;
    }>;
    signal?: AbortSignal;
    formDataParseMs?: number;
    onProgressEvent?: (event: CreatorShortRenderProgressEventInput) => void;
  },
  dependencies: CreatorShortSystemExportDependencies = {}
): Promise<RenderedCreatorShortSystemExportResult> {
  const exportShort = dependencies.exportShort ?? exportCreatorShortWithSystemFfmpeg;
  const buildAssDocument = dependencies.buildAssDocument ?? buildAssSubtitleDocument;
  const detectSourcePlaybackProfile =
    dependencies.detectSourcePlaybackProfile ?? detectCreatorShortSourcePlaybackProfile;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clipscribe-short-export-"));
  const totalStartedAt = performance.now();
  let tempFileWriteMs = 0;
  let outputReadbackMs = 0;

  try {
    input.onProgressEvent?.({
      stage: "setup",
      message: `Server parsed export payload in ${Number((input.formDataParseMs ?? 0).toFixed(2))}ms (overlays=${input.overlays.length}, renderMode=${input.payload.subtitleRenderMode}).`,
    });
    const sourceFilename = sanitizeFilenameSegment(input.sourceFile.name, "source.mp4");
    const sourcePath = path.join(tempRoot, "source", sourceFilename);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const writeStartedAt = performance.now();
    const sourceBytes = new Uint8Array(await input.sourceFile.arrayBuffer());
    await writeFile(sourcePath, sourceBytes);
    let visualSourcePath: string | null = null;
    let visualSourceBytesLength = 0;
    if (input.visualSourceFile) {
      const visualFilename = sanitizeFilenameSegment(
        input.payload.visualSource?.filename || input.visualSourceFile.name,
        "visual_source"
      );
      visualSourcePath = path.join(tempRoot, "visual_source", visualFilename);
      await mkdir(path.dirname(visualSourcePath), { recursive: true });
      const visualBytes = new Uint8Array(await input.visualSourceFile.arrayBuffer());
      visualSourceBytesLength = visualBytes.byteLength;
      await writeFile(visualSourcePath, visualBytes);
    }

    const preparedOverlays: CreatorSystemRenderOverlayInput[] = [];
    let overlayBytesTotal = 0;
    for (const [index, entry] of input.overlays.entries()) {
      const overlayFilename = sanitizeFilenameSegment(entry.descriptor.filename, `overlay_${index}.png`);
      const overlayPath = path.join(
        tempRoot,
        "overlays",
        `${String(index).padStart(3, "0")}_${overlayFilename}`
      );
      await mkdir(path.dirname(overlayPath), { recursive: true });
      const overlayBytes = new Uint8Array(await entry.file.arrayBuffer());
      overlayBytesTotal += overlayBytes.byteLength;
      await writeFile(overlayPath, overlayBytes);
      preparedOverlays.push({
        absolutePath: overlayPath,
        filename: overlayFilename,
        start: entry.descriptor.start,
        end: entry.descriptor.end,
        kind: entry.descriptor.kind,
        x: entry.descriptor.x,
        y: entry.descriptor.y,
        width: entry.descriptor.width,
        height: entry.descriptor.height,
        cropExpression: entry.descriptor.cropExpression,
      });
    }
    tempFileWriteMs = performance.now() - writeStartedAt;
    const resolvedVisualSourceKind = inferVisualSourceKind({
      payloadVisualSource: input.payload.visualSource,
      visualSourceFile: input.visualSourceFile,
    });

    let sourcePlaybackProfile: CreatorShortSourcePlaybackProfile = {
      mode: "normal",
      hasVideo: true,
      hasAudio: true,
      videoDurationSeconds: 0,
      audioDurationSeconds: 0,
    };
    try {
      sourcePlaybackProfile = await detectSourcePlaybackProfile(sourcePath);
      input.onProgressEvent?.({
        stage: "setup",
        message:
          sourcePlaybackProfile.mode === "still"
            ? `Detected still-video source profile (videoDuration=${sourcePlaybackProfile.videoDurationSeconds.toFixed(2)}s, frameCount=${sourcePlaybackProfile.videoFrameCount ?? 0}).`
            : `Detected normal source playback profile (videoDuration=${sourcePlaybackProfile.videoDurationSeconds.toFixed(2)}s, frameCount=${sourcePlaybackProfile.videoFrameCount ?? 0}).`,
      });
    } catch (error) {
      input.onProgressEvent?.({
        stage: "setup",
        message: `Source playback profiling unavailable: ${error instanceof Error ? error.message : "unknown error"}; continuing with normal render path.`,
      });
    }

    const hasVisualOverride = Boolean(visualSourcePath) && !!resolvedVisualSourceKind;

    if (resolvedVisualSourceKind === "image") {
      input.onProgressEvent?.({
        stage: "setup",
        message:
          "Using static image visual override; original source audio remains authoritative while overlay/subtitle timing stays clip-relative.",
      });
    } else if (resolvedVisualSourceKind === "video") {
      input.onProgressEvent?.({
        stage: "setup",
        message:
          "Using replacement video visual override; original source audio remains authoritative while overlay/subtitle timing stays clip-relative.",
      });
    } else if (sourcePlaybackProfile.mode === "still") {
      input.onProgressEvent?.({
        stage: "setup",
        message: "Using static-video render path for a still source while keeping overlay/subtitle timing clip-relative.",
      });
    }

    const trimLeadInCompensationSeconds = resolveTrimLeadInCompensationSeconds({
      sourceTrim: input.payload.sourceTrim,
      sourcePlaybackProfile,
    });
    const effectiveShort =
      trimLeadInCompensationSeconds > 0
        ? {
            ...input.payload.short,
            startSeconds: round3(input.payload.short.startSeconds + trimLeadInCompensationSeconds),
            endSeconds: round3(input.payload.short.endSeconds + trimLeadInCompensationSeconds),
          }
        : input.payload.short;

    if (trimLeadInCompensationSeconds > 0) {
      input.onProgressEvent?.({
        stage: "setup",
        message:
          `Detected ${trimLeadInCompensationSeconds.toFixed(2)}s of keyframe lead-in from the pre-trimmed upload; ` +
          "rebasing seek and overlay timing to keep export audio/video aligned.",
      });
    }

    const effectiveOverlays = [...preparedOverlays];

    const effectiveSemanticSubtitles =
      input.payload.subtitleRenderMode === "fast_ass" &&
      input.payload.semanticSubtitles &&
      input.payload.semanticSubtitles.chunks.length > 0
        ? input.payload.semanticSubtitles
        : null;

    let subtitleTrackPath: string | null = null;
    if (effectiveSemanticSubtitles && effectiveSemanticSubtitles.chunks.length > 0) {
      subtitleTrackPath = path.join(tempRoot, "subtitles", "short.ass");
      await mkdir(path.dirname(subtitleTrackPath), { recursive: true });
      await writeFile(subtitleTrackPath, buildAssDocument(effectiveSemanticSubtitles), "utf8");
      input.onProgressEvent?.({
        stage: "setup",
        message: `Server prepared ASS subtitle track with ${effectiveSemanticSubtitles.chunks.length} semantic event(s).`,
      });
    }

    input.onProgressEvent?.({
      stage: "setup",
      message:
        `Server temp files ready in ${Number(tempFileWriteMs.toFixed(2))}ms (` +
        `source=${sourceBytes.byteLength}B, ` +
        `visual=${visualSourceBytesLength}B, overlays=${overlayBytesTotal}B).`,
    });

    const outputPath = path.join(tempRoot, "output", "short_export.mp4");
    const geometry = buildCanonicalShortExportGeometry({
      sourceWidth: input.payload.sourceVideoSize.width,
      sourceHeight: input.payload.sourceVideoSize.height,
      editor: input.payload.editor,
      outputWidth: input.payload.geometry.outputWidth,
      outputHeight: input.payload.geometry.outputHeight,
    });
    let lastLoggedProgress = -1;
    const result = await exportShort({
      sourceFilePath: sourcePath,
      visualSourceFilePath: visualSourcePath,
      visualSourceKind: resolvedVisualSourceKind,
      sourceFilename: input.payload.sourceFilename,
      shortName: input.payload.shortName,
      short: effectiveShort,
      editor: input.payload.editor,
      sourceVideoSize: input.payload.sourceVideoSize,
      geometry,
      overlays: effectiveOverlays,
      subtitleBurnedIn: input.payload.subtitleBurnedIn,
      subtitleTrackPath,
      sourcePlaybackMode: !hasVisualOverride && sourcePlaybackProfile.mode === "still" ? "still" : "normal",
      renderModeUsed: input.payload.subtitleRenderMode,
      overlaySummary: input.payload.overlaySummary,
      outputPath,
      overwrite: true,
      onLogEvent: (event) => {
        input.onProgressEvent?.(event);
      },
      onProgress: (progress) => {
        if (progress.percent <= lastLoggedProgress + 1 && progress.percent < 100) return;
        lastLoggedProgress = progress.percent;
        input.onProgressEvent?.({
          stage: "ffmpeg",
          message: `FFmpeg progress ${progress.percent.toFixed(1)}% (${progress.processedSeconds.toFixed(2)}s/${progress.durationSeconds.toFixed(2)}s).`,
          progressPct: Number(progress.percent.toFixed(2)),
          processedSeconds: Number(progress.processedSeconds.toFixed(2)),
          durationSeconds: Number(progress.durationSeconds.toFixed(2)),
        });
      },
      signal: input.signal,
    });
    const readStartedAt = performance.now();
    const bytes = toOwnedBytes(new Uint8Array(await readFile(result.outputPath)));
    outputReadbackMs = performance.now() - readStartedAt;
    input.onProgressEvent?.({
      stage: "finalize",
      message: `Server output readback completed in ${Number(outputReadbackMs.toFixed(2))}ms (${bytes.byteLength}B).`,
      progressPct: 100,
    });
    const subtitleChunkCount =
      effectiveSemanticSubtitles?.chunks.length ?? input.payload.overlaySummary.subtitleFrameCount;
    const overlayRasterPixelArea = effectiveOverlays.reduce(
      (total, overlay) => total + getOverlayRasterPixelArea(overlay),
      0
    );
    const overlayRasterAreaPct = Number(
      ((overlayRasterPixelArea / (1080 * 1920)) * 100).toFixed(2)
    );

    return {
      bytes,
      filename: result.filename,
      mimeType: "video/mp4",
      width: result.width,
      height: result.height,
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      subtitleBurnedIn: result.subtitleBurnedIn,
      renderModeUsed: result.renderModeUsed,
      encoderUsed: result.encoderUsed,
      timingsMs: {
        client: input.payload.clientTimingsMs,
        server: {
          formDataParse: Number((input.formDataParseMs ?? 0).toFixed(2)),
          tempFileWrite: Number(tempFileWriteMs.toFixed(2)),
          ffmpeg: result.ffmpegDurationMs,
          outputReadback: Number(outputReadbackMs.toFixed(2)),
          total: Number((performance.now() - totalStartedAt).toFixed(2)),
        },
        ffmpegBenchmarkMs: result.ffmpegBenchmarkMs,
      },
      counts: {
        subtitleChunkCount,
        pngOverlayCount: effectiveOverlays.length,
        overlayRasterPixelArea,
        overlayRasterAreaPct,
        introOverlayCount: input.payload.overlaySummary.introOverlayFrameCount,
        outroOverlayCount: input.payload.overlaySummary.outroOverlayFrameCount,
      },
      debugNotes: result.notes,
      debugFfmpegCommand: result.ffmpegCommandPreview,
    };
  } catch (error) {
    if (isCreatorSystemRenderCanceledError(error)) {
      throw error;
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
