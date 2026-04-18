import {
  MOTION_OVERLAY_ANALYSIS_HZ,
  MOTION_OVERLAY_EXPORT_FPS,
  MOTION_OVERLAY_PRESETS,
  createDefaultMotionOverlayItem,
  drawMotionOverlayFrameToContext,
  getMotionOverlayPresetLabel,
  getMotionOverlayRasterPixelArea,
  isAudioReactiveMotionOverlayItem,
  renderMotionOverlayFrameSequence,
  resolveMotionOverlayExportFps,
  resolveMotionOverlayFrame,
  resolveMotionOverlayRect,
  type AudioReactiveMotionOverlayPresetId,
  type MotionOverlayAudioAnalysisTrack,
  type MotionOverlayBar,
  type MotionOverlayFrameSequence,
  type MotionOverlayRect,
  type MotionOverlayPresetDefinition,
  type ResolvedMotionOverlayFrame,
} from "../motion-overlays";
import {
  getProjectDuration,
  getTimelineAudioPlacements,
  getTimelineClipPlacements,
} from "./core/timeline";
import type {
  EditorProjectRecord,
  ResolvedEditorAsset,
  TimelineOverlayItem,
} from "./types";

const MAX_ATLAS_DIMENSION = 16000;

export const REACTIVE_OVERLAY_ANALYSIS_HZ = MOTION_OVERLAY_ANALYSIS_HZ;
export const REACTIVE_OVERLAY_EXPORT_FPS = MOTION_OVERLAY_EXPORT_FPS;

export interface EditorReactiveOverlayPresetDefinition extends MotionOverlayPresetDefinition {
  id: AudioReactiveMotionOverlayPresetId;
}

export const EDITOR_REACTIVE_OVERLAY_PRESETS: readonly EditorReactiveOverlayPresetDefinition[] = MOTION_OVERLAY_PRESETS.filter(
  (preset): preset is EditorReactiveOverlayPresetDefinition => preset.behavior === "audio_reactive"
);

export type EditorReactiveAudioAnalysisTrack = MotionOverlayAudioAnalysisTrack;
export type EditorReactiveOverlayRect = MotionOverlayRect;
export type EditorReactiveOverlayBar = MotionOverlayBar;
export type ReactiveOverlayFrameSequence = MotionOverlayFrameSequence;
export type ResolvedReactiveOverlayFrame = ResolvedMotionOverlayFrame;

export interface EditorReactiveOverlayAtlasFrame {
  pngBytes: Uint8Array;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cropExpression: string;
  presetId: AudioReactiveMotionOverlayPresetId;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number) {
  return Number(value.toFixed(3));
}

function normalizeAnalysisValues(values: Float32Array) {
  let maxValue = 0;
  for (const value of values) {
    if (value > maxValue) maxValue = value;
  }
  if (maxValue <= Number.EPSILON) {
    return values;
  }
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Number((values[index]! / maxValue).toFixed(4));
  }
  return values;
}

function createRasterCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === "undefined") {
    throw new Error("Reactive overlay rendering requires a browser canvas.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToImageBytes(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  mimeType: "image/png" | "image/webp",
  quality?: number
): Promise<Uint8Array> {
  const blob =
    typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: mimeType, quality })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(
            (result: Blob | null) => {
              if (!result) {
                reject(new Error("Failed to rasterize overlay frame."));
                return;
              }
              resolve(result);
            },
            mimeType,
            quality
          );
        });
  return new Uint8Array(await blob.arrayBuffer());
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("Reactive overlay rendering canceled.");
    error.name = "AbortError";
    throw error;
  }
}

function measureAudioWindowEnergy(
  samples: Float32Array,
  sampleRate: number,
  startSeconds: number,
  endSeconds: number
) {
  const safeEnd = Math.max(startSeconds, endSeconds);
  const sampleStart = clampNumber(Math.floor(startSeconds * sampleRate), 0, samples.length);
  const sampleEnd = clampNumber(Math.ceil(safeEnd * sampleRate), sampleStart + 1, samples.length);
  if (sampleEnd <= sampleStart) return 0;

  let sumSquares = 0;
  for (let index = sampleStart; index < sampleEnd; index += 1) {
    const sample = samples[index] ?? 0;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / Math.max(1, sampleEnd - sampleStart));
}

export function buildProjectReactiveOverlayAudioAnalysis(input: {
  project: Pick<EditorProjectRecord, "timeline">;
  decodedSamplesByAssetId: ReadonlyMap<string, Float32Array>;
  sampleRate?: number;
  sampleRateHz?: number;
}): EditorReactiveAudioAnalysisTrack {
  const sampleRate = input.sampleRate ?? 16000;
  const sampleRateHz = input.sampleRateHz ?? REACTIVE_OVERLAY_ANALYSIS_HZ;
  const projectDurationSeconds = Math.max(getProjectDuration(input.project), 0.25);
  const frameCount = Math.max(1, Math.ceil(projectDurationSeconds * sampleRateHz));
  const values = new Float32Array(frameCount);
  const binDurationSeconds = 1 / sampleRateHz;
  const clipPlacements = getTimelineClipPlacements(input.project.timeline.videoClips);
  const audioPlacements = getTimelineAudioPlacements(input.project.timeline.audioItems);

  for (let binIndex = 0; binIndex < frameCount; binIndex += 1) {
    const binStart = binIndex * binDurationSeconds;
    const binEnd = Math.min(projectDurationSeconds, binStart + binDurationSeconds);
    let energy = 0;

    for (const placement of clipPlacements) {
      const clip = placement.clip;
      if (clip.muted || clip.volume <= 0) continue;
      const samples = input.decodedSamplesByAssetId.get(clip.assetId);
      if (!samples) continue;
      const overlapStart = Math.max(binStart, placement.startSeconds);
      const overlapEnd = Math.min(binEnd, placement.endSeconds);
      if (overlapEnd <= overlapStart) continue;

      const sourceStartSeconds = clip.actions.reverse
        ? clip.trimEndSeconds - (overlapEnd - placement.startSeconds)
        : clip.trimStartSeconds + (overlapStart - placement.startSeconds);
      const sourceEndSeconds = clip.actions.reverse
        ? clip.trimEndSeconds - (overlapStart - placement.startSeconds)
        : clip.trimStartSeconds + (overlapEnd - placement.startSeconds);
      energy += measureAudioWindowEnergy(samples, sampleRate, sourceStartSeconds, sourceEndSeconds) * clip.volume;
    }

    for (const placement of audioPlacements) {
      const item = placement.item;
      if (item.muted || item.volume <= 0) continue;
      const samples = input.decodedSamplesByAssetId.get(item.assetId);
      if (!samples) continue;
      const overlapStart = Math.max(binStart, placement.startSeconds);
      const overlapEnd = Math.min(binEnd, placement.endSeconds);
      if (overlapEnd <= overlapStart) continue;

      const sourceStartSeconds = item.trimStartSeconds + (overlapStart - placement.startSeconds);
      const sourceEndSeconds = item.trimStartSeconds + (overlapEnd - placement.startSeconds);
      energy += measureAudioWindowEnergy(samples, sampleRate, sourceStartSeconds, sourceEndSeconds) * item.volume;
    }

    values[binIndex] = energy;
  }

  return {
    durationSeconds: round3(projectDurationSeconds),
    sampleRateHz,
    values: normalizeAnalysisValues(values),
  };
}

export function resolveReactiveOverlayExportFps(
  overlays: readonly Pick<TimelineOverlayItem, "presetId" | "durationSeconds" | "behavior">[]
) {
  return resolveMotionOverlayExportFps(overlays);
}

export async function buildProjectReactiveOverlayAudioAnalysisFromResolvedAssets(input: {
  project: Pick<EditorProjectRecord, "timeline">;
  resolvedAssets: readonly ResolvedEditorAsset[];
  signal?: AbortSignal;
}): Promise<EditorReactiveAudioAnalysisTrack> {
  const { decodeAudio } = await import("../audio");
  const decodedSamplesByAssetId = new Map<string, Float32Array>();
  const relevantAssets = input.resolvedAssets.filter(
    (entry) =>
      Boolean(entry.file) &&
      (entry.asset.kind === "audio" || (entry.asset.kind === "video" && entry.asset.hasAudio))
  );

  for (const entry of relevantAssets) {
    throwIfAborted(input.signal);
    if (!entry.file) continue;
    decodedSamplesByAssetId.set(entry.asset.id, await decodeAudio(entry.file));
  }

  return buildProjectReactiveOverlayAudioAnalysis({
    project: input.project,
    decodedSamplesByAssetId,
  });
}

export function resolveReactiveOverlayRect(input: {
  overlay: TimelineOverlayItem;
  frameWidth: number;
  frameHeight: number;
}) {
  return resolveMotionOverlayRect(input);
}

export function getReactiveOverlayAnalysisValueAtTime(
  analysis: EditorReactiveAudioAnalysisTrack,
  timeSeconds: number
) {
  if (analysis.values.length === 0) return 0;
  const clampedTime = clampNumber(timeSeconds, 0, Math.max(0, analysis.durationSeconds));
  const rawIndex = clampedTime * analysis.sampleRateHz;
  const leftIndex = clampNumber(Math.floor(rawIndex), 0, analysis.values.length - 1);
  const rightIndex = clampNumber(Math.ceil(rawIndex), 0, analysis.values.length - 1);
  const mix = rawIndex - leftIndex;
  const leftValue = analysis.values[leftIndex] ?? 0;
  const rightValue = analysis.values[rightIndex] ?? leftValue;
  return leftValue + (rightValue - leftValue) * mix;
}

export function getReactiveOverlayEnergyAtTime(input: {
  analysis: EditorReactiveAudioAnalysisTrack;
  timeSeconds: number;
  smoothing: number;
  sensitivity: number;
}) {
  const radiusBins = Math.round(clampNumber(input.smoothing, 0, 0.98) * 8);
  const centerIndex = clampNumber(
    Math.round(input.timeSeconds * input.analysis.sampleRateHz),
    0,
    Math.max(0, input.analysis.values.length - 1)
  );
  let weightedSum = 0;
  let totalWeight = 0;

  for (let index = centerIndex - radiusBins; index <= centerIndex + radiusBins; index += 1) {
    if (index < 0 || index >= input.analysis.values.length) continue;
    const distance = Math.abs(index - centerIndex);
    const weight = radiusBins === 0 ? 1 : 1 - distance / (radiusBins + 1);
    weightedSum += (input.analysis.values[index] ?? 0) * weight;
    totalWeight += weight;
  }

  const normalized = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return clampNumber(normalized * input.sensitivity, 0, 1);
}

export function resolveReactiveOverlayFrame(input: {
  overlay: TimelineOverlayItem;
  rect: Pick<EditorReactiveOverlayRect, "width" | "height">;
  analysis: EditorReactiveAudioAnalysisTrack;
  projectTimeSeconds: number;
  localTimeSeconds: number;
}) {
  return resolveMotionOverlayFrame(input);
}

export function drawReactiveOverlayFrameToContext(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ResolvedReactiveOverlayFrame
) {
  drawMotionOverlayFrameToContext(ctx, frame);
}

function buildAtlasCropExpression(
  frames: ReadonlyArray<{ start: number; end: number }>,
  frameHeight: number
) {
  if (frames.length === 0) return "0";
  return frames
    .map((frame, index) => `between(t,${frame.start.toFixed(3)},${frame.end.toFixed(3)})*${(index + 1) * frameHeight}`)
    .join("+");
}

export async function renderReactiveOverlayFrameSequence(input: {
  project: Pick<EditorProjectRecord, "timeline">;
  overlayItems: readonly TimelineOverlayItem[];
  analysis: EditorReactiveAudioAnalysisTrack;
  outputWidth: number;
  outputHeight: number;
  fps?: number;
  signal?: AbortSignal;
}): Promise<ReactiveOverlayFrameSequence[]> {
  return renderMotionOverlayFrameSequence({
    overlayItems: input.overlayItems.filter((overlay) => overlay.behavior === "audio_reactive"),
    analysis: input.analysis,
    outputWidth: input.outputWidth,
    outputHeight: input.outputHeight,
    projectDuration: getProjectDuration(input.project),
    fps: input.fps,
    signal: input.signal,
  });
}

export async function renderReactiveOverlayAtlases(input: {
  project: Pick<EditorProjectRecord, "timeline">;
  overlayItems: readonly TimelineOverlayItem[];
  analysis: EditorReactiveAudioAnalysisTrack;
  outputWidth: number;
  outputHeight: number;
  fps?: number;
  signal?: AbortSignal;
}): Promise<EditorReactiveOverlayAtlasFrame[]> {
  const fps = input.fps ?? REACTIVE_OVERLAY_EXPORT_FPS;
  const atlasFrames: EditorReactiveOverlayAtlasFrame[] = [];
  const projectDuration = Math.max(getProjectDuration(input.project), 0.25);

  for (const overlay of input.overlayItems.filter(isAudioReactiveMotionOverlayItem)) {
    throwIfAborted(input.signal);
    const rect = resolveReactiveOverlayRect({
      overlay,
      frameWidth: input.outputWidth,
      frameHeight: input.outputHeight,
    });
    const frameHeight = rect.height;
    const frameWidth = rect.width;
    const maxFramesPerAtlas = Math.max(1, Math.floor(MAX_ATLAS_DIMENSION / Math.max(frameHeight, 1)) - 1);
    const overlayStart = Math.max(0, overlay.startOffsetSeconds);
    const overlayEnd = Math.min(projectDuration, overlay.startOffsetSeconds + Math.max(0.25, overlay.durationSeconds));
    const frameCount = Math.max(1, Math.ceil((overlayEnd - overlayStart) * fps));

    for (let batchStart = 0; batchStart < frameCount; batchStart += maxFramesPerAtlas) {
      throwIfAborted(input.signal);
      const batchEnd = Math.min(frameCount, batchStart + maxFramesPerAtlas);
      const batchFrames: Array<{ start: number; end: number; resolved: ResolvedReactiveOverlayFrame }> = [];
      const atlasCanvas = createRasterCanvas(frameWidth, (batchEnd - batchStart + 1) * frameHeight);
      const atlasCtx = atlasCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (!atlasCtx) {
        throw new Error("Failed to create reactive overlay atlas context.");
      }

      atlasCtx.clearRect(0, 0, frameWidth, (batchEnd - batchStart + 1) * frameHeight);

      for (let frameIndex = batchStart; frameIndex < batchEnd; frameIndex += 1) {
        const frameStart = overlayStart + frameIndex / fps;
        const frameEnd = Math.min(overlayEnd, overlayStart + (frameIndex + 1) / fps);
        const resolved = resolveReactiveOverlayFrame({
          overlay,
          rect,
          analysis: input.analysis,
          projectTimeSeconds: frameStart,
          localTimeSeconds: Math.max(0, frameStart - overlayStart),
        });
        const rowIndex = frameIndex - batchStart + 1;
        atlasCtx.save();
        atlasCtx.translate(0, rowIndex * frameHeight);
        drawReactiveOverlayFrameToContext(atlasCtx, resolved);
        atlasCtx.restore();
        batchFrames.push({
          start: frameStart,
          end: frameEnd,
          resolved,
        });
      }

      atlasFrames.push({
        pngBytes: await canvasToImageBytes(atlasCanvas, "image/png"),
        start: batchFrames[0]?.start ?? overlayStart,
        end: batchFrames[batchFrames.length - 1]?.end ?? overlayEnd,
        x: rect.x,
        y: rect.y,
        width: frameWidth,
        height: frameHeight,
        cropExpression: buildAtlasCropExpression(batchFrames, frameHeight),
        presetId: overlay.presetId,
      });
    }
  }

  return atlasFrames;
}

export function getReactiveOverlayRasterPixelArea(
  frame: Pick<EditorReactiveOverlayAtlasFrame, "width" | "height">
) {
  return getMotionOverlayRasterPixelArea(frame);
}

export function getReactiveOverlayPresetLabel(presetId: AudioReactiveMotionOverlayPresetId) {
  return getMotionOverlayPresetLabel(presetId);
}

export function createDefaultReactiveOverlayItem(input: {
  id: string;
  presetId: AudioReactiveMotionOverlayPresetId;
  startOffsetSeconds?: number;
  durationSeconds?: number;
}) {
  return createDefaultMotionOverlayItem(input);
}
