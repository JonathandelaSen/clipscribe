import { buildEditorExportFilename } from "./export-output";
import { filterEditorAssetsForExport } from "./export-capabilities";
import {
  buildProjectReactiveOverlayAudioAnalysisFromResolvedAssets,
  type EditorReactiveAudioAnalysisTrack,
} from "./reactive-overlays";
import {
  EDITOR_SYSTEM_EXPORT_FORM_FIELDS,
  parseEditorSystemExportResponseHeaders,
  type EditorSystemExportAssetDescriptor,
  type EditorSystemExportOverlayDescriptor,
  type EditorSystemExportOverlaySequenceDescriptor,
  type SystemEditorExportAssetRecord,
} from "./system-export-contract";
import type {
  EditorExportCounts,
  EditorExportTimingsMs,
  EditorProjectRecord,
  EditorResolution,
  ResolvedEditorAsset,
} from "./types";
import { getEditorOutputDimensions } from "./core/aspect-ratio";
import {
  isAudioReactiveMotionOverlayItem,
  renderMotionOverlayFrameSequence,
  resolveMotionOverlayExportFps,
  type MotionOverlayFrameSequence,
} from "../motion-overlays";

export interface SystemEditorExportClientResult {
  file: File;
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

interface EditorExportProgressPollEvent {
  index: number;
  createdAt: number;
  elapsedMs: number;
  stage: string;
  message: string;
  progressPct?: number;
  processedSeconds?: number;
  durationSeconds?: number;
}

interface EditorExportProgressPollSnapshot {
  exists: boolean;
  requestId: string;
  status?: "pending" | "running" | "completed" | "failed" | "canceled";
  progressPct?: number;
  errorMessage?: string;
  cursor: number;
  events: EditorExportProgressPollEvent[];
}

function formatServerProgressLog(event: EditorExportProgressPollEvent) {
  const parts = [`server +${(event.elapsedMs / 1000).toFixed(2)}s`, `stage=${event.stage}`];
  if (typeof event.progressPct === "number") {
    parts.push(`progress=${event.progressPct.toFixed(1)}%`);
  }
  if (typeof event.processedSeconds === "number" && typeof event.durationSeconds === "number") {
    parts.push(`${event.processedSeconds.toFixed(2)}s/${event.durationSeconds.toFixed(2)}s`);
  }
  return `Server event (${parts.join(", ")}): ${event.message}`;
}

function serializeAssetRecord(asset: ResolvedEditorAsset["asset"]): SystemEditorExportAssetRecord {
  const { fileBlob: _fileBlob, ...rest } = asset;
  void _fileBlob;
  return rest;
}

function createRenderRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `editor_render_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
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

export async function requestSystemEditorExport(input: {
  project: EditorProjectRecord;
  resolvedAssets: ResolvedEditorAsset[];
  resolution: EditorResolution;
  reactiveOverlayAnalysis?: EditorReactiveAudioAnalysisTrack | null;
  reactiveOverlaySequences?: MotionOverlayFrameSequence[] | null;
  analysisReuseWaitMs?: number;
  onReactiveOverlaySequencesPrepared?: (sequences: MotionOverlayFrameSequence[]) => void;
  signal?: AbortSignal;
  onServerProgress?: (progressPct: number) => void;
  onDebugLog?: (message: string) => void;
}): Promise<SystemEditorExportClientResult> {
  const totalStartedAt = performance.now();
  const logDebug = (message: string) => {
    input.onDebugLog?.(message);
  };
  const relevantAssets = filterEditorAssetsForExport(input.project, input.resolvedAssets).filter(
    (entry): entry is ResolvedEditorAsset & { file: File } => Boolean(entry.file)
  );
  const assetDescriptors: EditorSystemExportAssetDescriptor[] = [];
  const overlayDescriptors: EditorSystemExportOverlayDescriptor[] = [];
  const formData = new FormData();
  const requestId = createRenderRequestId();
  const localDebugNotes: string[] = [];
  let localOverlayPreparationMs = 0;
  let localOverlayRasterPixelArea = 0;
  let localOverlaySequenceCount = 0;
  const motionOverlays = input.project.timeline.overlayItems;
  const audioReactiveOverlayCount = motionOverlays.filter(isAudioReactiveMotionOverlayItem).length;
  const autonomousOverlayCount = motionOverlays.length - audioReactiveOverlayCount;
  const motionOverlayPresetIds = Array.from(new Set(motionOverlays.map((overlay) => overlay.presetId)));

  logDebug(
    `Export started for ${input.project.name}: resolution=${input.resolution}, assets=${relevantAssets.length}, overlays=${motionOverlays.length}.`
  );

  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.requestId, requestId);
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.project, JSON.stringify(input.project));
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.resolution, input.resolution);
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");

  relevantAssets.forEach((entry, index) => {
    const fileField = `asset_${index}`;
    assetDescriptors.push({
      asset: serializeAssetRecord(entry.asset),
      fileField,
    });
    formData.set(fileField, entry.file, entry.file.name);
  });
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.assets, JSON.stringify(assetDescriptors));
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, "[]");

  if (motionOverlays.length > 0) {
    const overlayStartedAt = performance.now();
    const reactiveOverlayExportFps = resolveMotionOverlayExportFps(motionOverlays);
    logDebug(
      `Preparing motion overlays: count=${motionOverlays.length}, fps=${reactiveOverlayExportFps}, reactive=${audioReactiveOverlayCount}, autonomous=${autonomousOverlayCount}.`
    );
    const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
    const analysisRequired = motionOverlays.some((overlay) => overlay.behavior === "audio_reactive");
    if (
      analysisRequired &&
      !relevantAssets.some(
        (entry) => entry.asset.kind === "audio" || (entry.asset.kind === "video" && entry.asset.hasAudio)
      )
    ) {
      throw new Error("Audio-reactive motion overlays need at least one audio-capable asset in the timeline.");
    }
    const analysis =
      !analysisRequired
        ? null
        : input.reactiveOverlayAnalysis ??
          (await buildProjectReactiveOverlayAudioAnalysisFromResolvedAssets({
            project: input.project,
            resolvedAssets: relevantAssets,
            signal: input.signal,
          }));
    const overlaySequences =
      input.reactiveOverlaySequences ??
      (await renderMotionOverlayFrameSequence({
        overlayItems: motionOverlays,
        analysis,
        outputWidth: width,
        outputHeight: height,
        projectDuration: Math.max(
          ...motionOverlays.map((overlay) => overlay.startOffsetSeconds + Math.max(0.25, overlay.durationSeconds)),
          0.25
        ),
        fps: reactiveOverlayExportFps,
        signal: input.signal,
      }));
    if (!input.reactiveOverlaySequences) {
      input.onReactiveOverlaySequencesPrepared?.(overlaySequences);
    }
    const sequenceDescriptors: EditorSystemExportOverlaySequenceDescriptor[] = [];
    overlaySequences.forEach((sequence, index) => {
      const fileFieldPrefix = `overlay_seq_${index}`;
      localOverlayRasterPixelArea += sequence.width * sequence.height * sequence.frames.length;
      sequenceDescriptors.push({
        fps: sequence.fps,
        frameCount: sequence.frames.length,
        fileFieldPrefix,
        start: sequence.start,
        end: sequence.end,
        x: sequence.x,
        y: sequence.y,
        width: sequence.width,
        height: sequence.height,
        mimeType: sequence.mimeType,
      });
      sequence.frames.forEach((frame, frameIndex) => {
        const fieldName = `${fileFieldPrefix}_${frameIndex}`;
        formData.set(fieldName, new File([frame.bytes as any], frame.filename, { type: sequence.mimeType }), frame.filename);
      });
    });
    localOverlaySequenceCount = overlaySequences.length;
    formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.overlaySequences, JSON.stringify(sequenceDescriptors));
    localOverlayPreparationMs = Math.round(performance.now() - overlayStartedAt);
    const overlayPrepMessage = `Motion overlays prepared in ${localOverlayPreparationMs}ms: overlayCount=${motionOverlays.length}, sequences=${overlaySequences.length}, fps=${reactiveOverlayExportFps}, reactive=${audioReactiveOverlayCount}, autonomous=${autonomousOverlayCount}, overlayRasterPixelArea=${localOverlayRasterPixelArea}px.`;
    localDebugNotes.push(overlayPrepMessage);
    logDebug(overlayPrepMessage);
  }

  let pollCursor = -1;
  let pollingActive = true;
  let pollingFailureLogged = false;
  const pollProgress = async () => {
    while (pollingActive && !input.signal?.aborted) {
      try {
        const url = new URL("/api/editor/exports/render", window.location.origin);
        url.searchParams.set("requestId", requestId);
        url.searchParams.set("cursor", String(pollCursor));
        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: input.signal,
        });
        if (response.ok) {
          const snapshot = (await response.json()) as EditorExportProgressPollSnapshot;
          pollCursor = snapshot.cursor;
          for (const event of snapshot.events) {
            logDebug(formatServerProgressLog(event));
            if (typeof event.progressPct === "number" && Number.isFinite(event.progressPct)) {
              input.onServerProgress?.(event.progressPct);
            }
          }
          if (typeof snapshot.progressPct === "number" && Number.isFinite(snapshot.progressPct)) {
            input.onServerProgress?.(snapshot.progressPct);
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
          if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "canceled") {
            return;
          }
        }
      } catch {
        if (input.signal?.aborted) {
          return;
        }
        if (!pollingFailureLogged) {
          pollingFailureLogged = true;
          logDebug("Server progress polling temporarily unavailable.");
        }
      }

      const shouldContinue = await waitForDelayOrAbort(650, input.signal);
      if (!shouldContinue) return;
    }
  };
  const pollPromise = pollProgress();

  logDebug("POST /api/editor/exports/render started.");
  const uploadStartedAt = performance.now();
  const response = await fetch("/api/editor/exports/render", {
    method: "POST",
    body: formData,
    signal: input.signal,
  });
  const uploadFinishedAt = performance.now();
  pollingActive = false;
  await pollPromise.catch(() => undefined);

  if (!response.ok) {
    let message = "System export failed.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      const fallbackText = await response.text().catch(() => "");
      if (fallbackText.trim()) {
        message = fallbackText.trim();
      }
    }

    logDebug(`Export failed: ${message}`);
    throw new Error(message);
  }

  const fallbackFilename = buildEditorExportFilename(
    input.project.name,
    input.project.aspectRatio,
    input.resolution
  );
  const metadata = parseEditorSystemExportResponseHeaders(response.headers, {
    filename: fallbackFilename,
    resolution: input.resolution,
  });
  const arrayBuffer = await response.arrayBuffer();
  const file = new File([arrayBuffer], metadata.filename, {
    type: response.headers.get("content-type") || "video/mp4",
  });
  input.onServerProgress?.(100);
  logDebug(
    `Render complete: ${metadata.filename}, ${metadata.sizeBytes || file.size}B, ${metadata.width}x${metadata.height}, duration=${metadata.durationSeconds.toFixed(2)}s.`
  );
  const serverFfmpegMs = metadata.timingsMs?.serverFfmpeg ?? 0;
  const totalMs = Number((performance.now() - totalStartedAt).toFixed(2));
  const uploadMs = Number(Math.max(0, uploadFinishedAt - uploadStartedAt - serverFfmpegMs).toFixed(2));

  return {
    file,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: metadata.sizeBytes || file.size,
    durationSeconds: metadata.durationSeconds,
    warnings: metadata.warnings,
    debugNotes: [...localDebugNotes, ...metadata.debugNotes],
    debugFfmpegCommand: metadata.debugFfmpegCommand,
    encoderUsed: metadata.encoderUsed,
    hardwareAccelerated: metadata.hardwareAccelerated,
    timingsMs: {
      analysisReuseWait: input.analysisReuseWaitMs ? Number(input.analysisReuseWaitMs.toFixed(2)) : undefined,
      overlayPreparation: localOverlayPreparationMs || undefined,
      upload: uploadMs || undefined,
      serverFfmpeg: metadata.timingsMs?.serverFfmpeg,
      total: totalMs,
    },
    counts: {
      overlayCount: motionOverlays.length,
      motionOverlayCount: motionOverlays.length,
      motionOverlaySequenceCount: localOverlaySequenceCount || metadata.counts?.motionOverlaySequenceCount,
      motionOverlayPresetIds,
      audioReactiveOverlayCount,
      autonomousOverlayCount,
      atlasCount: metadata.counts?.atlasCount,
      sequenceCount: localOverlaySequenceCount || metadata.counts?.sequenceCount,
      overlayRasterPixelArea: localOverlayRasterPixelArea || metadata.counts?.overlayRasterPixelArea,
    },
  };
}
