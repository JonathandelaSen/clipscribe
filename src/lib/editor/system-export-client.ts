import { buildEditorExportFilename } from "./export-output";
import { filterEditorAssetsForExport } from "./export-capabilities";
import {
  buildProjectReactiveOverlayAudioAnalysisFromResolvedAssets,
  getReactiveOverlayRasterPixelArea,
  renderReactiveOverlayAtlases,
} from "./reactive-overlays";
import {
  EDITOR_SYSTEM_EXPORT_FORM_FIELDS,
  parseEditorSystemExportResponseHeaders,
  type EditorSystemExportAssetDescriptor,
  type EditorSystemExportOverlayDescriptor,
  type SystemEditorExportAssetRecord,
} from "./system-export-contract";
import type { EditorProjectRecord, EditorResolution, ResolvedEditorAsset } from "./types";
import { getEditorOutputDimensions } from "./core/aspect-ratio";

export interface SystemEditorExportClientResult {
  file: File;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  warnings: string[];
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

interface EditorExportProgressPollSnapshot {
  exists: boolean;
  requestId: string;
  status?: "pending" | "running" | "completed" | "failed" | "canceled";
  progressPct?: number;
  errorMessage?: string;
  cursor: number;
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
  signal?: AbortSignal;
  onServerProgress?: (progressPct: number) => void;
}): Promise<SystemEditorExportClientResult> {
  const relevantAssets = filterEditorAssetsForExport(input.project, input.resolvedAssets).filter(
    (entry): entry is ResolvedEditorAsset & { file: File } => Boolean(entry.file)
  );
  const assetDescriptors: EditorSystemExportAssetDescriptor[] = [];
  const overlayDescriptors: EditorSystemExportOverlayDescriptor[] = [];
  const formData = new FormData();
  const requestId = createRenderRequestId();
  const localDebugNotes: string[] = [];

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

  if (input.project.timeline.overlayItems.length > 0) {
    const overlayStartedAt = performance.now();
    const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
    const analysis = await buildProjectReactiveOverlayAudioAnalysisFromResolvedAssets({
      project: input.project,
      resolvedAssets: relevantAssets,
      signal: input.signal,
    });
    const overlayAtlases = await renderReactiveOverlayAtlases({
      project: input.project,
      overlayItems: input.project.timeline.overlayItems,
      analysis,
      outputWidth: width,
      outputHeight: height,
      signal: input.signal,
    });
    let overlayRasterPixelArea = 0;
    overlayAtlases.forEach((atlas, index) => {
      const fileField = `overlay_${index}`;
      const filename = `${String(index).padStart(3, "0")}.png`;
      const pngBytes = new Uint8Array(atlas.pngBytes);
      overlayRasterPixelArea += getReactiveOverlayRasterPixelArea(atlas);
      overlayDescriptors.push({
        start: atlas.start,
        end: atlas.end,
        fileField,
        filename,
        x: atlas.x,
        y: atlas.y,
        width: atlas.width,
        height: atlas.height,
        cropExpression: atlas.cropExpression,
      });
      formData.set(fileField, new File([pngBytes], filename, { type: "image/png" }), filename);
    });
    formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.overlays, JSON.stringify(overlayDescriptors));
    localDebugNotes.push(
      `Reactive overlays prepared in ${Math.round(performance.now() - overlayStartedAt)}ms: overlayCount=${input.project.timeline.overlayItems.length}, atlases=${overlayAtlases.length}, analysisSource=final_mix, overlayRasterPixelArea=${overlayRasterPixelArea}px.`
    );
  }

  let pollCursor = -1;
  let pollingActive = true;
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
          if (typeof snapshot.progressPct === "number" && Number.isFinite(snapshot.progressPct)) {
            input.onServerProgress?.(snapshot.progressPct);
          }
          if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "canceled") {
            return;
          }
        }
      } catch {
        if (input.signal?.aborted) {
          return;
        }
      }

      const shouldContinue = await waitForDelayOrAbort(650, input.signal);
      if (!shouldContinue) return;
    }
  };
  const pollPromise = pollProgress();

  const response = await fetch("/api/editor/exports/render", {
    method: "POST",
    body: formData,
    signal: input.signal,
  });
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

  return {
    file,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: metadata.sizeBytes || file.size,
    durationSeconds: metadata.durationSeconds,
    warnings: metadata.warnings,
    debugNotes: [...localDebugNotes, ...metadata.debugNotes],
    debugFfmpegCommand: metadata.debugFfmpegCommand,
  };
}
