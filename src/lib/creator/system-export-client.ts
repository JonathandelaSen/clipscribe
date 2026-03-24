import {
  createBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
  type BrowserRenderLifecycle,
} from "@/lib/browser-render";
import { buildCreatorShortExportFilename } from "@/lib/creator/export-output";
import {
  buildCompletedCreatorShortRenderResponse,
  CREATOR_SYSTEM_EXPORT_FORM_FIELDS,
  parseCreatorShortSystemExportResponseHeaders,
  type CreatorShortSystemExportOverlayDescriptor,
  type CreatorShortSystemExportPayload,
} from "@/lib/creator/system-export-contract";
import { assertExportGeometryInvariants } from "@/lib/creator/core/export-contracts";
import { buildShortExportGeometry } from "@/lib/creator/core/export-geometry";
import { resolveCreatorSuggestedShort } from "@/lib/creator/shorts-compat";
import { renderSubtitlesToPngs } from "@/lib/creator/subtitle-canvas";
import { trimSourceForExport } from "@/lib/creator/source-trim";
import { renderTextOverlayToPngFrames } from "@/lib/creator/text-overlay-canvas";
import type {
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorShortRenderResponse,
  CreatorSuggestedShort,
  CreatorViralClip,
} from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const FAST_SEEK_CUSHION_SECONDS = 3;
const PROGRESS = {
  init: 2,
  geometryReady: 5,
  trimReady: 12,
  introReady: 14,
  outroReady: 16,
  subtitlesReady: 20,
  renderStart: 20,
  renderMax: 92,
  responseRead: 95,
  packaged: 97,
  complete: 100,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseErrorResponseText(text: string): string {
  if (!text.trim()) return "System export failed.";
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : text.trim();
  } catch {
    return text.trim();
  }
}

function createProgressTimer(input: {
  clipDurationSeconds: number;
  startPercent: number;
  endPercent: number;
  onProgress?: (progressPct: number) => void;
}) {
  let lastProgress = input.startPercent;
  const startedAt = Date.now();
  const quickRampMs = Math.max(4_000, input.clipDurationSeconds * 2_500);
  const tailTauMs = Math.max(10_000, input.clipDurationSeconds * 4_000);
  const quickTarget = Math.min(input.endPercent - 4, input.startPercent + (input.endPercent - input.startPercent) * 0.82);

  const emit = () => {
    const elapsed = Date.now() - startedAt;
    let next = input.startPercent;
    if (elapsed <= quickRampMs) {
      const linear = clamp(elapsed / quickRampMs, 0, 1);
      const eased = 1 - Math.pow(1 - linear, 3);
      next = input.startPercent + (quickTarget - input.startPercent) * eased;
    } else {
      const tailElapsed = elapsed - quickRampMs;
      const tailEased = 1 - Math.exp(-tailElapsed / tailTauMs);
      next = quickTarget + (input.endPercent - quickTarget) * tailEased;
    }
    const rounded = Math.round(clamp(next, input.startPercent, input.endPercent));
    if (rounded > lastProgress) {
      lastProgress = rounded;
      input.onProgress?.(rounded);
    }
  };

  const timerId = setInterval(emit, 250);
  emit();
  return {
    stop() {
      clearInterval(timerId);
    },
  };
}

export interface RequestSystemCreatorShortExportInput {
  sourceFile: File;
  sourceFilename: string;
  short?: CreatorSuggestedShort;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  subtitleChunks: SubtitleChunk[];
  editor: CreatorShortEditorState;
  sourceVideoSize: { width: number; height: number };
  previewViewport?: { width: number; height: number } | null;
  previewVideoRect?: { width: number; height: number } | null;
  onProgress?: (progressPct: number) => void;
  renderLifecycle?: BrowserRenderLifecycle;
}

export interface RequestSystemCreatorShortExportResult {
  file: File;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  subtitleBurnedIn: boolean;
  ffmpegCommandPreview: string[];
  notes: string[];
  renderResponse: CreatorShortRenderResponse;
}

export async function requestSystemCreatorShortExport(
  input: RequestSystemCreatorShortExportInput
): Promise<RequestSystemCreatorShortExportResult> {
  const short = resolveCreatorSuggestedShort({
    short: input.short,
    clip: input.clip,
    plan: input.plan,
  });
  const clipDurationSeconds = Math.max(0.5, short.endSeconds - short.startSeconds);

  let lastProgressPct = 0;
  const emitProgress = (pct: number) => {
    const next = Math.round(clamp(pct, 0, 100));
    if (next <= lastProgressPct) return;
    lastProgressPct = next;
    input.onProgress?.(next);
  };

  setBrowserRenderStage(input.renderLifecycle, "preparing");
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  emitProgress(PROGRESS.init);

  const geometry = buildShortExportGeometry({
    sourceWidth: input.sourceVideoSize.width,
    sourceHeight: input.sourceVideoSize.height,
    editor: input.editor,
    previewViewport: input.previewViewport ?? null,
    previewVideoRect: input.previewVideoRect ?? null,
    outputWidth: OUTPUT_WIDTH,
    outputHeight: OUTPUT_HEIGHT,
  });

  assertExportGeometryInvariants(
    {
      sourceWidth: input.sourceVideoSize.width,
      sourceHeight: input.sourceVideoSize.height,
      geometry,
      expectedOutputWidth: OUTPUT_WIDTH,
      expectedOutputHeight: OUTPUT_HEIGHT,
    },
    { contextLabel: "system-export-client" }
  );
  emitProgress(PROGRESS.geometryReady);

  // Pre-trim source video to just the needed segment using -c copy (no re-encoding).
  // This dramatically reduces upload size from potentially GBs to a few MB.
  const trimResult = await trimSourceForExport({
    sourceFile: input.sourceFile,
    clipStartSeconds: short.startSeconds,
    clipEndSeconds: short.endSeconds,
    signal: input.renderLifecycle?.signal,
  });
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  emitProgress(PROGRESS.trimReady);

  // Adjust the short timestamps to be relative to the trimmed file
  const trimOffset = trimResult.trimmedOffsetSeconds;
  const adjustedShort = trimOffset > 0
    ? {
        ...short,
        startSeconds: short.startSeconds - trimOffset,
        endSeconds: short.endSeconds - trimOffset,
      }
    : short;

  // Recompute seek values for the adjusted short
  const adjustedInputSeekSeconds = Math.max(0, adjustedShort.startSeconds - FAST_SEEK_CUSHION_SECONDS);
  const adjustedExactTrimAfterSeekSeconds = Math.max(0, adjustedShort.startSeconds - adjustedInputSeekSeconds);

  const introOverlayFrames = await renderTextOverlayToPngFrames({
    overlay: input.editor.introOverlay ?? {
      enabled: false,
      text: "",
      startOffsetSeconds: 0,
      durationSeconds: 0,
      positionXPercent: 50,
      positionYPercent: 24,
      scale: 1,
      maxWidthPct: 78,
    },
    slot: "intro",
    clipDurationSeconds: short.durationSeconds,
    timeOffsetSeconds: adjustedExactTrimAfterSeekSeconds,
    signal: input.renderLifecycle?.signal,
  });
  emitProgress(PROGRESS.introReady);

  const outroOverlayFrames = await renderTextOverlayToPngFrames({
    overlay: input.editor.outroOverlay ?? {
      enabled: false,
      text: "",
      startOffsetSeconds: 0,
      durationSeconds: 0,
      positionXPercent: 50,
      positionYPercent: 34,
      scale: 0.9,
      maxWidthPct: 72,
    },
    slot: "outro",
    clipDurationSeconds: short.durationSeconds,
    timeOffsetSeconds: adjustedExactTrimAfterSeekSeconds,
    signal: input.renderLifecycle?.signal,
  });
  emitProgress(PROGRESS.outroReady);

  const subtitleFrames = await renderSubtitlesToPngs(
    input.subtitleChunks ?? [],
    adjustedShort,
    input.editor,
    adjustedExactTrimAfterSeekSeconds,
    input.renderLifecycle?.signal
  );
  emitProgress(PROGRESS.subtitlesReady);
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);

  const overlayFrames = [...introOverlayFrames, ...outroOverlayFrames, ...subtitleFrames];
  const overlayDescriptors: CreatorShortSystemExportOverlayDescriptor[] = [];
  const formData = new FormData();
  const payload: CreatorShortSystemExportPayload = {
    sourceFilename: input.sourceFilename,
    short: adjustedShort,
    editor: input.editor,
    sourceVideoSize: input.sourceVideoSize,
    geometry,
    previewViewport: input.previewViewport ?? null,
    previewVideoRect: input.previewVideoRect ?? null,
    subtitleBurnedIn: subtitleFrames.length > 0,
    overlaySummary: {
      subtitleFrameCount: subtitleFrames.length,
      introOverlayFrameCount: introOverlayFrames.length,
      outroOverlayFrameCount: outroOverlayFrames.length,
    },
  };

  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload, JSON.stringify(payload));
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile, trimResult.trimmedFile, trimResult.trimmedFile.name);

  overlayFrames.forEach((frame, index) => {
    const fileField = `overlay_${index}`;
    const filename = `${String(index).padStart(3, "0")}.png`;
    const pngBytes = new Uint8Array(new ArrayBuffer(frame.pngBytes.byteLength));
    pngBytes.set(frame.pngBytes);
    overlayDescriptors.push({
      start: frame.start,
      end: frame.end,
      fileField,
      filename,
    });
    formData.set(fileField, new File([pngBytes], filename, { type: "image/png" }), filename);
  });
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, JSON.stringify(overlayDescriptors));

  setBrowserRenderStage(input.renderLifecycle, "rendering");
  emitProgress(PROGRESS.renderStart);
  const progressTimer = createProgressTimer({
    clipDurationSeconds,
    startPercent: PROGRESS.renderStart,
    endPercent: PROGRESS.renderMax,
    onProgress: input.onProgress,
  });

  try {
    const response = await fetch("/api/creator/shorts/render", {
      method: "POST",
      body: formData,
      signal: input.renderLifecycle?.signal,
    });
    progressTimer.stop();

    if (response.status === 499 || input.renderLifecycle?.signal?.aborted) {
      throw createBrowserRenderCanceledError();
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(parseErrorResponseText(errorText));
    }

    setBrowserRenderStage(input.renderLifecycle, "handoff");
    emitProgress(PROGRESS.responseRead);
    const metadata = parseCreatorShortSystemExportResponseHeaders(response.headers, {
      filename: buildCreatorShortExportFilename(input.sourceFilename, short),
    });
    const arrayBuffer = await response.arrayBuffer();
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    const file = new File([arrayBuffer], metadata.filename, {
      type: response.headers.get("content-type") || "video/mp4",
    });
    emitProgress(PROGRESS.packaged);

    const renderResponse = buildCompletedCreatorShortRenderResponse({
      providerMode: "system",
      jobId: `short_render_${Date.now()}`,
      createdAt: Date.now(),
      filename: metadata.filename,
      subtitleBurnedIn: metadata.subtitleBurnedIn,
      ffmpegCommandPreview: metadata.debugFfmpegCommand,
      notes: metadata.debugNotes,
      durationSeconds: metadata.durationSeconds,
    });

    setBrowserRenderStage(input.renderLifecycle, "complete");
    emitProgress(PROGRESS.complete);

    return {
      file,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: metadata.sizeBytes || file.size,
      durationSeconds: metadata.durationSeconds,
      subtitleBurnedIn: metadata.subtitleBurnedIn,
      ffmpegCommandPreview: metadata.debugFfmpegCommand,
      notes: metadata.debugNotes,
      renderResponse,
    };
  } catch (error) {
    progressTimer.stop();
    throw error;
  }
}
