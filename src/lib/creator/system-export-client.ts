import {
  createBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
  type BrowserRenderLifecycle,
} from "@/lib/browser-render";
import { buildCreatorShortExportFilename } from "@/lib/creator/export-output";
import {
  buildCreatorSemanticSubtitlePayload,
} from "@/lib/creator/semantic-subtitles";
import {
  buildCompletedCreatorShortRenderResponse,
  CREATOR_SYSTEM_EXPORT_FORM_FIELDS,
  parseCreatorShortSystemExportResponseHeaders,
  type CreatorShortSystemExportOverlayDescriptor,
  type CreatorShortSystemExportOverlaySequenceDescriptor,
  type CreatorShortSystemExportPayload,
} from "@/lib/creator/system-export-contract";
import { assertExportGeometryInvariants } from "@/lib/creator/core/export-contracts";
import { buildCanonicalShortExportGeometry } from "@/lib/creator/core/export-geometry";
import { resolveCreatorSuggestedShort } from "@/lib/creator/shorts-compat";
import { renderSubtitleAtlases } from "@/lib/creator/subtitle-canvas";
import { trimSourceForExport } from "@/lib/creator/source-trim";
import { renderTextOverlayToPngFrames } from "@/lib/creator/text-overlay-canvas";
import {
  buildCreatorReactiveOverlayAudioAnalysis,
} from "@/lib/creator/reactive-overlays";
import { prepareSystemExportTimelineArtifacts } from "./system-export-timeline";
import type {
  CreatorMotionOverlayItem,
  CreatorMotionOverlayPresetId,
  CreatorReactiveOverlayPresetId,
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorShortRenderResponse,
  CreatorSuggestedShort,
  CreatorShortSystemExportCounts,
  CreatorShortSystemExportTimingsMs,
  CreatorViralClip,
} from "@/lib/creator/types";
import { shiftSubtitleChunks, type SubtitleChunk } from "@/lib/history";
import {
  getMotionOverlayRasterPixelArea,
  isAudioReactiveMotionOverlayItem,
  renderMotionOverlayFrameSequence,
  resolveMotionOverlayExportFps,
  type MotionOverlayFrameSequence,
} from "@/lib/motion-overlays";

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const SERVER_PROGRESS_POLL_INTERVAL_MS = 1_200;
const PROGRESS = {
  init: 2,
  geometryReady: 5,
  trimReady: 12,
  introReady: 14,
  outroReady: 16,
  reactiveReady: 18,
  subtitlesReady: 22,
  renderStart: 22,
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

export function rebaseSubtitleChunksForTrim(
  subtitleChunks: SubtitleChunk[],
  trimOffsetSeconds: number
): SubtitleChunk[] {
  if (!Number.isFinite(trimOffsetSeconds) || Math.abs(trimOffsetSeconds) < 0.001) {
    return subtitleChunks;
  }
  return shiftSubtitleChunks(subtitleChunks, -trimOffsetSeconds);
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
    kind?: "intro_overlay" | "outro_overlay" | "reactive_overlay" | "motion_overlay" | "subtitle_atlas" | "subtitle_frame";
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
  if (input.kind === "reactive_overlay") {
    return "reactive_overlay_atlas";
  }
  if (input.kind === "motion_overlay") {
    return "motion_overlay_png";
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
  visualSourceFile?: File | null;
  visualSourceKind?: "video" | "image";
  shortName?: string;
  short?: CreatorSuggestedShort;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  subtitleChunks: SubtitleChunk[];
  editor: CreatorShortEditorState;
  sourceVideoSize: { width: number; height: number };
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

export interface RequestSystemCreatorShortExportDependencies {
  trimSourceForExportFn?: typeof trimSourceForExport;
  renderTextOverlayToPngFramesFn?: typeof renderTextOverlayToPngFrames;
  buildCreatorSemanticSubtitlePayloadFn?: typeof buildCreatorSemanticSubtitlePayload;
  renderSubtitleAtlasesFn?: typeof renderSubtitleAtlases;
  fetchFn?: typeof fetch;
}

export async function requestSystemCreatorShortExport(
  input: RequestSystemCreatorShortExportInput,
  dependencies: RequestSystemCreatorShortExportDependencies = {}
): Promise<RequestSystemCreatorShortExportResult> {
  const requestStartedAt = nowMs();
  const trimSourceForExportFn = dependencies.trimSourceForExportFn ?? trimSourceForExport;
  const renderTextOverlayToPngFramesFn =
    dependencies.renderTextOverlayToPngFramesFn ?? renderTextOverlayToPngFrames;
  const buildCreatorSemanticSubtitlePayloadFn =
    dependencies.buildCreatorSemanticSubtitlePayloadFn ?? buildCreatorSemanticSubtitlePayload;
  const renderSubtitleAtlasesFn = dependencies.renderSubtitleAtlasesFn ?? renderSubtitleAtlases;
  const fetchFn = dependencies.fetchFn ?? fetch;
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

  const geometry = buildCanonicalShortExportGeometry({
    sourceWidth: input.sourceVideoSize.width,
    sourceHeight: input.sourceVideoSize.height,
    editor: input.editor,
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
    `Geometry ready: mode=${geometry.layoutMode ?? "legacy"}, ${geometry.scaledWidth}x${geometry.scaledHeight} -> ${geometry.outputWidth}x${geometry.outputHeight}.`
  );

  const trimResult = await trimSourceForExportFn({
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
  const exportSubtitleChunks = rebaseSubtitleChunksForTrim(input.subtitleChunks ?? [], trimOffset);
  const adjustedShort = trimOffset > 0
    ? {
        ...short,
        startSeconds: short.startSeconds - trimOffset,
        endSeconds: short.endSeconds - trimOffset,
      }
    : short;

  const timelineArtifacts = await prepareSystemExportTimelineArtifacts(
    {
      short,
      adjustedShort,
      editor: input.editor,
      subtitleChunks: exportSubtitleChunks,
      signal: input.renderLifecycle?.signal,
    },
    {
      renderTextOverlayToPngFramesFn,
      buildCreatorSemanticSubtitlePayloadFn,
      renderSubtitleAtlasesFn,
    }
  );
  const introOverlayFrames = timelineArtifacts.introOverlayFrames;
  const introOverlayRenderMs = timelineArtifacts.timingsMs.introOverlayRender;
  emitProgress(PROGRESS.introReady);
  if (introOverlayFrames[0]) {
    const frame = introOverlayFrames[0];
    logDebug(
      `Intro overlay prepared: ${introOverlayFrames.length} frame(s) in ${introOverlayRenderMs}ms; ${describeOverlayRenderPath(frame)} ${frame.width ?? OUTPUT_WIDTH}x${frame.height ?? OUTPUT_HEIGHT} at (${frame.x ?? 0},${frame.y ?? 0}), ${frame.pngBytes.byteLength}B, raster=${getOverlayRasterPixelArea(frame)}px (${getOverlayRasterAreaPct(frame)}% of frame).`
    );
  } else {
    logDebug(`Intro overlay prepared: 0 frame(s) in ${introOverlayRenderMs}ms.`);
  }

  const outroOverlayFrames = timelineArtifacts.outroOverlayFrames;
  const outroOverlayRenderMs = timelineArtifacts.timingsMs.outroOverlayRender;
  emitProgress(PROGRESS.outroReady);
  if (outroOverlayFrames[0]) {
    const frame = outroOverlayFrames[0];
    logDebug(
      `Outro overlay prepared: ${outroOverlayFrames.length} frame(s) in ${outroOverlayRenderMs}ms; ${describeOverlayRenderPath(frame)} ${frame.width ?? OUTPUT_WIDTH}x${frame.height ?? OUTPUT_HEIGHT} at (${frame.x ?? 0},${frame.y ?? 0}), ${frame.pngBytes.byteLength}B, raster=${getOverlayRasterPixelArea(frame)}px (${getOverlayRasterAreaPct(frame)}% of frame).`
    );
  } else {
    logDebug(`Outro overlay prepared: 0 frame(s) in ${outroOverlayRenderMs}ms.`);
  }

  const motionOverlays = (input.editor.motionOverlays ?? input.editor.reactiveOverlays ?? []) as CreatorMotionOverlayItem[];
  const audioReactiveOverlays = motionOverlays.filter(isAudioReactiveMotionOverlayItem);
  const autonomousOverlays = motionOverlays.filter((overlay) => overlay.behavior === "autonomous");
  let motionOverlaySequences: MotionOverlayFrameSequence[] = [];
  let reactiveOverlayPreparationMs = 0;
  let motionOverlayRasterPixelArea = 0;
  let motionOverlayExportFps = 0;
  const motionOverlayPresetIds = Array.from(
    new Set(motionOverlays.map((overlay) => overlay.presetId).filter((presetId): presetId is CreatorMotionOverlayPresetId => typeof presetId === "string"))
  );
  const reactiveOverlayPresetIds = motionOverlayPresetIds.filter(
    (presetId): presetId is CreatorReactiveOverlayPresetId =>
      presetId === "waveform_line" || presetId === "equalizer_bars" || presetId === "pulse_ring"
  );
  if (motionOverlays.length > 0) {
    const reactiveStartedAt = nowMs();
    motionOverlayExportFps = resolveMotionOverlayExportFps(motionOverlays);
    let reactiveAnalysis = null;
    if (audioReactiveOverlays.length > 0) {
      const { decodeAudio } = await import("@/lib/audio");
      const decodedSamples = await decodeAudio(input.sourceFile);
      throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
      reactiveAnalysis = buildCreatorReactiveOverlayAudioAnalysis({
        clipStartSeconds: short.startSeconds,
        clipDurationSeconds,
        decodedSamples,
      });
    }
    motionOverlaySequences = await renderMotionOverlayFrameSequence({
      overlayItems: motionOverlays,
      analysis: reactiveAnalysis,
      outputWidth: OUTPUT_WIDTH,
      outputHeight: OUTPUT_HEIGHT,
      projectDuration: clipDurationSeconds,
      fps: motionOverlayExportFps,
      signal: input.renderLifecycle?.signal,
    });
    reactiveOverlayPreparationMs = roundMs(nowMs() - reactiveStartedAt);
    motionOverlayRasterPixelArea = motionOverlaySequences.reduce(
      (total, seq) => total + getMotionOverlayRasterPixelArea({
        width: seq.width ?? OUTPUT_WIDTH,
        height: seq.height ?? OUTPUT_HEIGHT,
        framesLength: seq.frames.length,
      }),
      0
    );
  }
  emitProgress(PROGRESS.reactiveReady);
  if (motionOverlaySequences[0]) {
    logDebug(
      `Motion overlays prepared: count=${motionOverlays.length}, sequences=${motionOverlaySequences.length}, fps=${motionOverlayExportFps}, presets=${motionOverlayPresetIds.join(",") || "none"}, reactive=${audioReactiveOverlays.length}, autonomous=${autonomousOverlays.length}, prep=${reactiveOverlayPreparationMs}ms, raster=${motionOverlayRasterPixelArea}px.`
    );
  } else {
    logDebug(`Motion overlays prepared: 0 sequence(s) in ${reactiveOverlayPreparationMs}ms.`);
  }

  const semanticSubtitles = timelineArtifacts.semanticSubtitles;
  const subtitleRenderMode = timelineArtifacts.subtitleRenderMode;
  const subtitleAtlases = timelineArtifacts.subtitleAtlases;
  const subtitlePreparationMs = timelineArtifacts.timingsMs.subtitlePreparation;
  emitProgress(PROGRESS.subtitlesReady);
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  if (trimOffset > 0 && exportSubtitleChunks.length > 0) {
    logDebug(
      `Rebased ${exportSubtitleChunks.length} subtitle chunk(s) by ${trimOffset.toFixed(2)}s after source trim.`
    );
  }
  logDebug(
      `Subtitle mode selected: ${subtitleRenderMode}; semantic events=${semanticSubtitles?.chunks.length ?? 0}; png atlases=${subtitleAtlases.length}; prep=${subtitlePreparationMs}ms.`
  );

  const overlayDescriptors: CreatorShortSystemExportOverlayDescriptor[] = [];
  const overlaySequenceDescriptors: CreatorShortSystemExportOverlaySequenceDescriptor[] = [];
  const formData = new FormData();
  const requestAssemblyStartedAt = nowMs();

  let overlayIndex = 0;
  const addOverlayFrame = (frame: {
    pngBytes: Uint8Array;
    start: number;
    end: number;
    cropExpression?: string;
    kind?: "intro_overlay" | "outro_overlay" | "reactive_overlay" | "subtitle_atlas" | "subtitle_frame";
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

  for (const [seqIndex, seq] of motionOverlaySequences.entries()) {
    const fileFieldPrefix = `overlay_seq_${seqIndex}`;
    overlaySequenceDescriptors.push({
      fps: seq.fps,
      frameCount: seq.frames.length,
      fileFieldPrefix,
      start: seq.start,
      end: seq.end,
      x: typeof seq.x === "number" ? Math.max(0, Math.round(seq.x)) : 0,
      y: typeof seq.y === "number" ? Math.max(0, Math.round(seq.y)) : 0,
      width: typeof seq.width === "number" ? Math.max(1, Math.round(seq.width)) : OUTPUT_WIDTH,
      height: typeof seq.height === "number" ? Math.max(1, Math.round(seq.height)) : OUTPUT_HEIGHT,
      mimeType: "image/webp",
    });

    for (let frameIndex = 0; frameIndex < seq.frames.length; frameIndex++) {
      const frameBuffer = seq.frames[frameIndex]?.bytes;
      if (!frameBuffer) continue;
      const frameName = `${fileFieldPrefix}_${frameIndex}.webp`;
      formData.set(
        `${fileFieldPrefix}_${frameIndex}`,
        // @ts-expect-error File constructor is available in browser context where this runs
        new File([frameBuffer], frameName, { type: "image/webp" }),
        frameName
      );
    }
  }

  for (const frame of introOverlayFrames) addOverlayFrame(frame);
  for (const frame of outroOverlayFrames) addOverlayFrame(frame);
  for (const atlas of subtitleAtlases) addOverlayFrame(atlas);
  const overlayRasterPixelArea = overlayDescriptors.reduce(
    (total, overlay) => total + getOverlayRasterPixelArea(overlay),
    0
  ) + motionOverlayRasterPixelArea;
  const overlayRasterAreaPct = Number(
    ((overlayRasterPixelArea / (OUTPUT_WIDTH * OUTPUT_HEIGHT)) * 100).toFixed(2)
  );

  const clientTimingsBase = {
    introOverlayRender: introOverlayRenderMs,
    outroOverlayRender: outroOverlayRenderMs,
      reactiveOverlayPreparation: reactiveOverlayPreparationMs,
    subtitlePreparation: subtitlePreparationMs,
  } as const;
  const renderRequestId = createRenderRequestId();

  const payload: CreatorShortSystemExportPayload = {
    renderRequestId,
    sourceFilename: input.sourceFilename,
    shortName: input.shortName?.trim() || undefined,
    short: adjustedShort,
    editor: input.editor,
    sourceVideoSize: input.sourceVideoSize,
    visualSource:
      input.visualSourceFile && input.visualSourceKind
        ? {
            kind: input.visualSourceKind,
            filename: input.visualSourceFile.name,
          }
        : null,
    sourceTrim:
      trimResult.trimmedOffsetSeconds > 0 && trimResult.trimmedDurationSeconds > 0
        ? {
            requestedOffsetSeconds: trimResult.trimmedOffsetSeconds,
            requestedDurationSeconds: trimResult.trimmedDurationSeconds,
          }
        : null,
    geometry,
    subtitleRenderMode,
    semanticSubtitles: subtitleRenderMode === "fast_ass" ? semanticSubtitles : null,
    subtitleBurnedIn: (semanticSubtitles?.chunks.length ?? 0) > 0 || subtitleAtlases.length > 0,
    overlaySummary: {
      subtitleFrameCount: subtitleAtlases.length,
      introOverlayFrameCount: introOverlayFrames.length,
      outroOverlayFrameCount: outroOverlayFrames.length,
      motionOverlayCount: motionOverlays.length,
      motionOverlaySequenceCount: motionOverlaySequences.length,
      motionOverlayPresetIds,
      audioReactiveOverlayCount: audioReactiveOverlays.length,
      autonomousOverlayCount: autonomousOverlays.length,
      reactiveOverlayFrameCount: motionOverlaySequences
        .filter((sequence) => sequence.behavior === "audio_reactive")
        .reduce((sum, sequence) => sum + sequence.frames.length, 0),
      reactiveOverlayCount: audioReactiveOverlays.length,
      reactiveOverlayPresetIds,
    },
    clientTimingsMs: clientTimingsBase,
  };

  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload, JSON.stringify(payload));
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile, trimResult.trimmedFile, trimResult.trimmedFile.name);
  if (input.visualSourceFile && input.visualSourceKind) {
    formData.set(
      CREATOR_SYSTEM_EXPORT_FORM_FIELDS.visualSourceFile,
      input.visualSourceFile,
      input.visualSourceFile.name
    );
  }
  formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, JSON.stringify(overlayDescriptors));
  if (overlaySequenceDescriptors.length > 0) {
    formData.set(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlaySequences, JSON.stringify(overlaySequenceDescriptors));
  }
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

    const response = await fetchFn(`/api/creator/shorts/render?${params.toString()}`, {
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
    const response = await fetchFn("/api/creator/shorts/render", {
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
      filename: buildCreatorShortExportFilename(input.sourceFilename, short, input.shortName),
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
