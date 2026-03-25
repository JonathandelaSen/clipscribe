import {
  createBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
  type BrowserRenderLifecycle,
} from "@/lib/browser-render";
import { buildCreatorShortExportFilename } from "@/lib/creator/export-output";
import {
  buildCreatorSemanticSubtitlePayload,
  shouldUseCreatorPngSubtitleFallback,
} from "@/lib/creator/semantic-subtitles";
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
import { renderSubtitleAtlases } from "@/lib/creator/subtitle-canvas";
import { trimSourceForExport } from "@/lib/creator/source-trim";
import { renderTextOverlayToPngFrames } from "@/lib/creator/text-overlay-canvas";
import type {
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorShortRenderResponse,
  CreatorSuggestedShort,
  CreatorShortSystemExportCounts,
  CreatorShortSystemExportTimingsMs,
  CreatorViralClip,
} from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const FAST_SEEK_CUSHION_SECONDS = 3;
const SERVER_PROGRESS_POLL_INTERVAL_MS = 1_200;
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

function nowMs() {
  return performance.now();
}

function roundMs(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

function createRenderRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `short_render_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
}

function getOverlayRasterPixelArea(input: {
  width?: number;
  height?: number;
}): number {
  return Math.max(1, input.width ?? OUTPUT_WIDTH) * Math.max(1, input.height ?? OUTPUT_HEIGHT);
}

function getOverlayRasterAreaPct(input: {
  width?: number;
  height?: number;
}) {
  return Number(((getOverlayRasterPixelArea(input) / (OUTPUT_WIDTH * OUTPUT_HEIGHT)) * 100).toFixed(2));
}

function describeOverlayRenderPath(input: {
  kind?: "intro_overlay" | "outro_overlay" | "subtitle_atlas" | "subtitle_frame";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  if (input.kind === "intro_overlay" || input.kind === "outro_overlay") {
    return typeof input.x === "number" &&
      typeof input.y === "number" &&
      typeof input.width === "number" &&
      typeof input.height === "number"
      ? "bounded_png"
      : "fullscreen_png_legacy";
  }
  return input.kind ?? "overlay";
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

function mapServerRenderProgressToClientProgress(serverProgressPct: number) {
  const normalized = clamp(serverProgressPct, 0, 100);
  return PROGRESS.renderStart + ((PROGRESS.renderMax - PROGRESS.renderStart) * normalized) / 100;
}

function waitForDelayOrAbort(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timerId = setTimeout(() => {
      cleanup();
      resolve(true);
    }, delayMs);

    const handleAbort = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      clearTimeout(timerId);
      signal?.removeEventListener("abort", handleAbort);
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

interface CreatorShortRenderProgressPollEvent {
  index: number;
  createdAt: number;
  elapsedMs: number;
  stage: string;
  message: string;
  progressPct?: number;
  processedSeconds?: number;
  durationSeconds?: number;
}

interface CreatorShortRenderProgressPollSnapshot {
  exists: boolean;
  requestId: string;
  status?: "pending" | "running" | "completed" | "failed" | "canceled";
  progressPct?: number;
  errorMessage?: string;
  cursor: number;
  events: CreatorShortRenderProgressPollEvent[];
}

function formatServerProgressLog(event: CreatorShortRenderProgressPollEvent) {
  const parts = [`server +${(event.elapsedMs / 1000).toFixed(2)}s`, `stage=${event.stage}`];
  if (typeof event.progressPct === "number") {
    parts.push(`progress=${event.progressPct.toFixed(1)}%`);
  }
  if (typeof event.processedSeconds === "number" && typeof event.durationSeconds === "number") {
    parts.push(`${event.processedSeconds.toFixed(2)}s/${event.durationSeconds.toFixed(2)}s`);
  }
  return `Server event (${parts.join(", ")}): ${event.message}`;
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
  onDebugLog?: (message: string) => void;
  renderLifecycle?: BrowserRenderLifecycle;
}

export interface RequestSystemCreatorShortExportResult {
  file: File;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  subtitleBurnedIn: boolean;
  renderModeUsed: "fast_ass" | "png_parity";
  encoderUsed: string;
  timingsMs?: CreatorShortSystemExportTimingsMs;
  counts?: CreatorShortSystemExportCounts;
  ffmpegCommandPreview: string[];
  notes: string[];
  renderResponse: CreatorShortRenderResponse;
}

export async function requestSystemCreatorShortExport(
  input: RequestSystemCreatorShortExportInput
): Promise<RequestSystemCreatorShortExportResult> {
  const requestStartedAt = nowMs();
  const logDebug = (message: string) => {
    input.onDebugLog?.(message);
  };
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
  logDebug(
    `Geometry ready: ${geometry.scaledWidth}x${geometry.scaledHeight} -> ${geometry.outputWidth}x${geometry.outputHeight}.`
  );

  const trimResult = await trimSourceForExport({
    sourceFile: input.sourceFile,
    clipStartSeconds: short.startSeconds,
    clipEndSeconds: short.endSeconds,
    signal: input.renderLifecycle?.signal,
  });
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  emitProgress(PROGRESS.trimReady);
  if (trimResult.trimmedOffsetSeconds > 0 || trimResult.trimmedFile.size !== input.sourceFile.size) {
    logDebug(
      `Source trim ready: ${input.sourceFile.size}B -> ${trimResult.trimmedFile.size}B, offset=${trimResult.trimmedOffsetSeconds.toFixed(2)}s.`
    );
  } else {
    logDebug(`Source trim skipped: uploading original file (${input.sourceFile.size}B).`);
  }

  const trimOffset = trimResult.trimmedOffsetSeconds;
  const adjustedShort = trimOffset > 0
    ? {
        ...short,
        startSeconds: short.startSeconds - trimOffset,
        endSeconds: short.endSeconds - trimOffset,
      }
    : short;

  const adjustedInputSeekSeconds = Math.max(0, adjustedShort.startSeconds - FAST_SEEK_CUSHION_SECONDS);
  const adjustedExactTrimAfterSeekSeconds = Math.max(0, adjustedShort.startSeconds - adjustedInputSeekSeconds);

  const introStartedAt = nowMs();
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
  const introOverlayRenderMs = roundMs(nowMs() - introStartedAt);
  emitProgress(PROGRESS.introReady);
  if (introOverlayFrames[0]) {
    const frame = introOverlayFrames[0];
    logDebug(
      `Intro overlay prepared: ${introOverlayFrames.length} frame(s) in ${introOverlayRenderMs}ms; ${describeOverlayRenderPath(frame)} ${frame.width ?? OUTPUT_WIDTH}x${frame.height ?? OUTPUT_HEIGHT} at (${frame.x ?? 0},${frame.y ?? 0}), ${frame.pngBytes.byteLength}B, raster=${getOverlayRasterPixelArea(frame)}px (${getOverlayRasterAreaPct(frame)}% of frame).`
    );
  } else {
    logDebug(`Intro overlay prepared: 0 frame(s) in ${introOverlayRenderMs}ms.`);
  }

  const outroStartedAt = nowMs();
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
  const outroOverlayRenderMs = roundMs(nowMs() - outroStartedAt);
  emitProgress(PROGRESS.outroReady);
  if (outroOverlayFrames[0]) {
    const frame = outroOverlayFrames[0];
    logDebug(
      `Outro overlay prepared: ${outroOverlayFrames.length} frame(s) in ${outroOverlayRenderMs}ms; ${describeOverlayRenderPath(frame)} ${frame.width ?? OUTPUT_WIDTH}x${frame.height ?? OUTPUT_HEIGHT} at (${frame.x ?? 0},${frame.y ?? 0}), ${frame.pngBytes.byteLength}B, raster=${getOverlayRasterPixelArea(frame)}px (${getOverlayRasterAreaPct(frame)}% of frame).`
    );
  } else {
    logDebug(`Outro overlay prepared: 0 frame(s) in ${outroOverlayRenderMs}ms.`);
  }

  const subtitleStartedAt = nowMs();
  const semanticSubtitles = buildCreatorSemanticSubtitlePayload({
    subtitleChunks: input.subtitleChunks ?? [],
    short: adjustedShort,
    editor: input.editor,
    timeOffsetSeconds: adjustedExactTrimAfterSeekSeconds,
  });
  const usePngSubtitleFallback =
    semanticSubtitles != null && shouldUseCreatorPngSubtitleFallback(semanticSubtitles.style);
  const subtitleRenderMode = usePngSubtitleFallback ? "png_parity" : "fast_ass";
  const subtitleAtlases =
    subtitleRenderMode === "png_parity"
      ? await renderSubtitleAtlases(
          input.subtitleChunks ?? [],
          adjustedShort,
          input.editor,
          adjustedExactTrimAfterSeekSeconds,
          input.renderLifecycle?.signal
        )
      : [];
  const subtitlePreparationMs = roundMs(nowMs() - subtitleStartedAt);
  emitProgress(PROGRESS.subtitlesReady);
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  logDebug(
    `Subtitle mode selected: ${subtitleRenderMode}; semantic events=${semanticSubtitles?.chunks.length ?? 0}; png atlases=${subtitleAtlases.length}; prep=${subtitlePreparationMs}ms.`
  );

  const overlayDescriptors: CreatorShortSystemExportOverlayDescriptor[] = [];
  const formData = new FormData();
  const requestAssemblyStartedAt = nowMs();

  let overlayIndex = 0;
  const addOverlayFrame = (frame: {
    pngBytes: Uint8Array;
    start: number;
    end: number;
    cropExpression?: string;
    kind?: "intro_overlay" | "outro_overlay" | "subtitle_atlas" | "subtitle_frame";
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) => {
    const fileField = `overlay_${overlayIndex}`;
    const filename = `${String(overlayIndex).padStart(3, "0")}.png`;
    const pngBytes = new Uint8Array(frame.pngBytes.byteLength);
    pngBytes.set(frame.pngBytes);
    overlayDescriptors.push({
      start: frame.start,
      end: frame.end,
      fileField,
      filename,
      kind: frame.kind,
      x: typeof frame.x === "number" ? Math.max(0, Math.round(frame.x)) : undefined,
      y: typeof frame.y === "number" ? Math.max(0, Math.round(frame.y)) : undefined,
      width: typeof frame.width === "number" ? Math.max(1, Math.round(frame.width)) : undefined,
      height: typeof frame.height === "number" ? Math.max(1, Math.round(frame.height)) : undefined,
      cropExpression: frame.cropExpression,
    });
    formData.set(fileField, new File([pngBytes], filename, { type: "image/png" }), filename);
    overlayIndex++;
  };

  for (const frame of introOverlayFrames) addOverlayFrame(frame);
  for (const frame of outroOverlayFrames) addOverlayFrame(frame);
  for (const atlas of subtitleAtlases) addOverlayFrame(atlas);
  const overlayRasterPixelArea = overlayDescriptors.reduce(
    (total, overlay) => total + getOverlayRasterPixelArea(overlay),
    0
  );
  const overlayRasterAreaPct = Number(
    ((overlayRasterPixelArea / (OUTPUT_WIDTH * OUTPUT_HEIGHT)) * 100).toFixed(2)
  );

  const clientTimingsBase = {
    introOverlayRender: introOverlayRenderMs,
    outroOverlayRender: outroOverlayRenderMs,
    subtitlePreparation: subtitlePreparationMs,
  } as const;
  const renderRequestId = createRenderRequestId();

  const payload: CreatorShortSystemExportPayload = {
    renderRequestId,
    sourceFilename: input.sourceFilename,
    short: adjustedShort,
    editor: input.editor,
    sourceVideoSize: input.sourceVideoSize,
    geometry,
    previewViewport: input.previewViewport ?? null,
    previewVideoRect: input.previewVideoRect ?? null,
    subtitleRenderMode,
    semanticSubtitles: subtitleRenderMode === "fast_ass" ? semanticSubtitles : null,
    subtitleBurnedIn: (semanticSubtitles?.chunks.length ?? 0) > 0 || subtitleAtlases.length > 0,
    overlaySummary: {
      subtitleFrameCount: subtitleAtlases.length,
      introOverlayFrameCount: introOverlayFrames.length,
      outroOverlayFrameCount: outroOverlayFrames.length,
    },
    clientTimingsMs: clientTimingsBase,
  };

  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload, JSON.stringify(payload));
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile, trimResult.trimmedFile, trimResult.trimmedFile.name);
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, JSON.stringify(overlayDescriptors));
  const requestAssemblyMs = roundMs(nowMs() - requestAssemblyStartedAt);
  logDebug(`Server render request id: ${renderRequestId}.`);
  logDebug(
    `Request body assembled in ${requestAssemblyMs}ms: overlays=${overlayDescriptors.length}, renderMode=${subtitleRenderMode}, overlay_raster=${overlayRasterPixelArea}px (${overlayRasterAreaPct}% of frame).`
  );

  setBrowserRenderStage(input.renderLifecycle, "rendering");
  emitProgress(PROGRESS.renderStart);
  const progressTimer = createProgressTimer({
    clipDurationSeconds,
    startPercent: PROGRESS.renderStart,
    endPercent: PROGRESS.renderMax,
    onProgress: input.onProgress,
  });
  let progressTimerStopped = false;
  const stopProgressTimer = () => {
    if (progressTimerStopped) return;
    progressTimerStopped = true;
    progressTimer.stop();
  };
  let serverProgressCursor = -1;
  let serverReportedProgress = false;
  let pollingFailureLogged = false;
  const progressPollingController = new AbortController();
  const handleRenderAbort = () => {
    progressPollingController.abort();
  };
  if (input.renderLifecycle?.signal?.aborted) {
    progressPollingController.abort();
  } else {
    input.renderLifecycle?.signal?.addEventListener("abort", handleRenderAbort, { once: true });
  }

  const applyServerProgress = (progressPct: number) => {
    if (!serverReportedProgress) {
      serverReportedProgress = true;
      stopProgressTimer();
      logDebug("Server-reported render progress detected; client estimate paused.");
    }
    emitProgress(mapServerRenderProgressToClientProgress(progressPct));
  };

  const pollServerProgressOnce = async () => {
    const params = new URLSearchParams({
      requestId: renderRequestId,
    });
    if (serverProgressCursor >= 0) {
      params.set("cursor", String(serverProgressCursor));
    }

    const response = await fetch(`/api/creator/shorts/render?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "cache-control": "no-store",
      },
      signal: progressPollingController.signal,
    });
    if (!response.ok) {
      throw new Error(`Progress endpoint returned ${response.status}.`);
    }

    const snapshot = (await response.json()) as CreatorShortRenderProgressPollSnapshot;
    if (!snapshot.exists) {
      return false;
    }

    serverProgressCursor = snapshot.cursor;
    for (const event of snapshot.events) {
      logDebug(formatServerProgressLog(event));
      if (typeof event.progressPct === "number") {
        applyServerProgress(event.progressPct);
      }
    }

    if (!snapshot.events.length && typeof snapshot.progressPct === "number") {
      applyServerProgress(snapshot.progressPct);
    }
    if (
      snapshot.status &&
      snapshot.status !== "pending" &&
      snapshot.status !== "running" &&
      snapshot.errorMessage &&
      snapshot.events.length === 0
    ) {
      logDebug(`Server render status=${snapshot.status}: ${snapshot.errorMessage}`);
    }

    return snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "canceled";
  };

  const progressPollingPromise = (async () => {
    while (!progressPollingController.signal.aborted) {
      try {
        const reachedTerminalStatus = await pollServerProgressOnce();
        if (reachedTerminalStatus) return;
      } catch (error) {
        if (progressPollingController.signal.aborted) return;
        if (!pollingFailureLogged) {
          pollingFailureLogged = true;
          logDebug(
            `Server progress polling unavailable: ${error instanceof Error ? error.message : "unknown error"}.`
          );
        }
      }

      const shouldContinue = await waitForDelayOrAbort(
        SERVER_PROGRESS_POLL_INTERVAL_MS,
        progressPollingController.signal
      );
      if (!shouldContinue) return;
    }
  })();
  logDebug(
    `Estimated client-side progress while waiting for server render (${PROGRESS.renderStart}% -> ${PROGRESS.renderMax}%).`
  );

  try {
    const postStartedAt = nowMs();
    logDebug("POST /api/creator/shorts/render started.");
    const response = await fetch("/api/creator/shorts/render", {
      method: "POST",
      body: formData,
      signal: input.renderLifecycle?.signal,
    });
    const postMs = roundMs(nowMs() - postStartedAt);
    stopProgressTimer();
    try {
      await pollServerProgressOnce();
    } catch {}
    progressPollingController.abort();
    await progressPollingPromise;

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
    logDebug(
      `Response headers received after ${postMs}ms: renderMode=${metadata.renderModeUsed}, encoder=${metadata.encoderUsed}.`
    );
    const responseReadStartedAt = nowMs();
    const arrayBuffer = await response.arrayBuffer();
    const responseReadMs = roundMs(nowMs() - responseReadStartedAt);
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    const file = new File([arrayBuffer], metadata.filename, {
      type: response.headers.get("content-type") || "video/mp4",
    });
    emitProgress(PROGRESS.packaged);
    logDebug(`Response body read in ${responseReadMs}ms (${file.size}B).`);

    const timingsMs: CreatorShortSystemExportTimingsMs = {
      ...metadata.timingsMs,
      client: {
        ...(metadata.timingsMs?.client ?? {}),
        ...clientTimingsBase,
        requestAssembly: requestAssemblyMs,
        post: postMs,
        responseRead: responseReadMs,
        total: roundMs(nowMs() - requestStartedAt),
      },
    };
    logDebug(
      `Timing summary: client_total=${timingsMs.client?.total ?? 0}ms, server_total=${timingsMs.server?.total ?? 0}ms, ffmpeg=${timingsMs.server?.ffmpeg ?? 0}ms.`
    );

    const renderResponse = buildCompletedCreatorShortRenderResponse({
      providerMode: "system",
      jobId: `short_render_${Date.now()}`,
      createdAt: Date.now(),
      filename: metadata.filename,
      subtitleBurnedIn: metadata.subtitleBurnedIn,
      ffmpegCommandPreview: metadata.debugFfmpegCommand,
      notes: metadata.debugNotes,
      durationSeconds: metadata.durationSeconds,
      renderModeUsed: metadata.renderModeUsed,
      encoderUsed: metadata.encoderUsed,
      timingsMs,
      counts: metadata.counts,
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
      renderModeUsed: metadata.renderModeUsed,
      encoderUsed: metadata.encoderUsed,
      timingsMs,
      counts: metadata.counts,
      ffmpegCommandPreview: metadata.debugFfmpegCommand,
      notes: metadata.debugNotes,
      renderResponse,
    };
  } catch (error) {
    stopProgressTimer();
    try {
      await pollServerProgressOnce();
    } catch {}
    progressPollingController.abort();
    await progressPollingPromise.catch(() => {});
    logDebug(`Export request failed: ${error instanceof Error ? error.message : "unknown error"}.`);
    throw error;
  } finally {
    input.renderLifecycle?.signal?.removeEventListener("abort", handleRenderAbort);
  }
}
