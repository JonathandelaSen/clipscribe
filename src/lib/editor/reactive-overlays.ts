import {
  getProjectDuration,
  getTimelineAudioPlacements,
  getTimelineClipPlacements,
} from "./core/timeline";
import type {
  EditorProjectRecord,
  EditorReactiveOverlayPresetId,
  ResolvedEditorAsset,
  TimelineOverlayItem,
} from "./types";

export const REACTIVE_OVERLAY_ANALYSIS_HZ = 60;
export const REACTIVE_OVERLAY_EXPORT_FPS = 30;
const MAX_ATLAS_DIMENSION = 16000;

export interface EditorReactiveOverlayPresetDefinition {
  id: EditorReactiveOverlayPresetId;
  label: string;
  description: string;
}

export const EDITOR_REACTIVE_OVERLAY_PRESETS: readonly EditorReactiveOverlayPresetDefinition[] = [
  {
    id: "waveform_line",
    label: "Waveform Line",
    description: "A flowing line that ripples with the final mix.",
  },
  {
    id: "equalizer_bars",
    label: "Equalizer Bars",
    description: "Stacked bars that bounce to the audible energy.",
  },
  {
    id: "pulse_ring",
    label: "Pulse Ring",
    description: "A circular pulse that expands and contracts with the beat.",
  },
] as const;

export interface EditorReactiveAudioAnalysisTrack {
  durationSeconds: number;
  sampleRateHz: number;
  values: Float32Array;
}

export interface EditorReactiveOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorReactiveOverlayBar {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export type ResolvedReactiveOverlayFrame =
  | {
      kind: "waveform_line";
      width: number;
      height: number;
      opacity: number;
      stroke: string;
      strokeWidth: number;
      path: string;
      glowPath: string;
    }
  | {
      kind: "equalizer_bars";
      width: number;
      height: number;
      opacity: number;
      fill: string;
      glowFill: string;
      bars: EditorReactiveOverlayBar[];
    }
  | {
      kind: "pulse_ring";
      width: number;
      height: number;
      opacity: number;
      stroke: string;
      glowFill: string;
      centerX: number;
      centerY: number;
      radius: number;
      strokeWidth: number;
      innerRadius: number;
      glowRadius: number;
    };

export interface EditorReactiveOverlayAtlasFrame {
  pngBytes: Uint8Array;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cropExpression: string;
  presetId: EditorReactiveOverlayPresetId;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clampNumber(alpha, 0, 1).toFixed(3)})`;
}

function buildWavePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
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

async function canvasToPngBytes(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  const blob =
    typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob((result: Blob | null) => {
            if (!result) {
              reject(new Error("Failed to rasterize overlay frame."));
              return;
            }
            resolve(result);
          }, "image/png");
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
}): EditorReactiveOverlayRect {
  const width = clampNumber(
    Math.round((input.frameWidth * input.overlay.widthPercent * input.overlay.scale) / 100),
    12,
    input.frameWidth
  );
  const height = clampNumber(
    Math.round((input.frameHeight * input.overlay.heightPercent * input.overlay.scale) / 100),
    12,
    input.frameHeight
  );
  const centerX = (input.frameWidth * input.overlay.positionXPercent) / 100;
  const centerY = (input.frameHeight * input.overlay.positionYPercent) / 100;
  return {
    width,
    height,
    x: clampNumber(Math.round(centerX - width / 2), 0, Math.max(0, input.frameWidth - width)),
    y: clampNumber(Math.round(centerY - height / 2), 0, Math.max(0, input.frameHeight - height)),
  };
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
}): ResolvedReactiveOverlayFrame {
  const width = Math.max(1, input.rect.width);
  const height = Math.max(1, input.rect.height);
  const energy = getReactiveOverlayEnergyAtTime({
    analysis: input.analysis,
    timeSeconds: input.projectTimeSeconds,
    smoothing: input.overlay.smoothing,
    sensitivity: input.overlay.sensitivity,
  });
  const opacity = clampNumber(input.overlay.opacity, 0.05, 1);

  if (input.overlay.presetId === "pulse_ring") {
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = Math.min(width, height) * 0.18;
    const radius = baseRadius + energy * Math.min(width, height) * 0.16;
    const innerRadius = baseRadius * (0.35 + energy * 0.55);
    return {
      kind: "pulse_ring",
      width,
      height,
      opacity,
      stroke: rgba(input.overlay.tintHex, 0.96),
      glowFill: rgba(input.overlay.tintHex, 0.18 + energy * 0.22),
      centerX,
      centerY,
      radius,
      innerRadius,
      strokeWidth: Math.max(2, Math.round(Math.min(width, height) * (0.03 + energy * 0.015))),
      glowRadius: radius + Math.min(width, height) * (0.08 + energy * 0.08),
    };
  }

  if (input.overlay.presetId === "equalizer_bars") {
    const barCount = 22;
    const gap = width * 0.018;
    const barWidth = (width - gap * (barCount - 1)) / barCount;
    const bars: EditorReactiveOverlayBar[] = [];
    for (let index = 0; index < barCount; index += 1) {
      const bandTime = input.projectTimeSeconds - 0.18 + index * 0.012;
      const bandEnergy = getReactiveOverlayEnergyAtTime({
        analysis: input.analysis,
        timeSeconds: bandTime,
        smoothing: input.overlay.smoothing,
        sensitivity: input.overlay.sensitivity,
      });
      const sway = 0.62 + 0.38 * Math.sin(input.localTimeSeconds * 7.5 + index * 0.8);
      const barHeight = Math.max(height * 0.12, height * clampNumber(bandEnergy * sway, 0.08, 1));
      bars.push({
        x: index * (barWidth + gap),
        y: height - barHeight,
        width: barWidth,
        height: barHeight,
        radius: Math.min(barWidth / 2, 8),
      });
    }

    return {
      kind: "equalizer_bars",
      width,
      height,
      opacity,
      fill: rgba(input.overlay.tintHex, 0.88),
      glowFill: rgba(input.overlay.tintHex, 0.22),
      bars,
    };
  }

  const pointCount = 48;
  const historyWindowSeconds = 1.4;
  const midY = height / 2;
  const points = Array.from({ length: pointCount }, (_value, index) => {
    const ratio = index / Math.max(1, pointCount - 1);
    const sampleTime = input.projectTimeSeconds - historyWindowSeconds + historyWindowSeconds * ratio;
    const sampleEnergy = getReactiveOverlayEnergyAtTime({
      analysis: input.analysis,
      timeSeconds: sampleTime,
      smoothing: input.overlay.smoothing,
      sensitivity: input.overlay.sensitivity,
    });
    const oscillation = Math.sin(sampleTime * 12 + index * 0.52);
    const offset = sampleEnergy * oscillation * height * 0.38;
    return {
      x: ratio * width,
      y: midY - offset,
    };
  });

  return {
    kind: "waveform_line",
    width,
    height,
    opacity,
    stroke: rgba(input.overlay.tintHex, 0.94),
    strokeWidth: Math.max(2, Math.round(height * 0.06)),
    path: buildWavePath(points),
    glowPath: buildWavePath(points),
  };
}

function drawRoundedRect(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  bar: EditorReactiveOverlayBar
) {
  ctx.beginPath();
  const radius = Math.min(bar.radius, bar.width / 2, bar.height / 2);
  ctx.moveTo(bar.x + radius, bar.y);
  ctx.lineTo(bar.x + bar.width - radius, bar.y);
  ctx.quadraticCurveTo(bar.x + bar.width, bar.y, bar.x + bar.width, bar.y + radius);
  ctx.lineTo(bar.x + bar.width, bar.y + bar.height - radius);
  ctx.quadraticCurveTo(bar.x + bar.width, bar.y + bar.height, bar.x + bar.width - radius, bar.y + bar.height);
  ctx.lineTo(bar.x + radius, bar.y + bar.height);
  ctx.quadraticCurveTo(bar.x, bar.y + bar.height, bar.x, bar.y + bar.height - radius);
  ctx.lineTo(bar.x, bar.y + radius);
  ctx.quadraticCurveTo(bar.x, bar.y, bar.x + radius, bar.y);
  ctx.closePath();
}

export function drawReactiveOverlayFrameToContext(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ResolvedReactiveOverlayFrame
) {
  ctx.clearRect(0, 0, frame.width, frame.height);
  ctx.globalAlpha = frame.opacity;

  if (frame.kind === "pulse_ring") {
    ctx.fillStyle = frame.glowFill;
    ctx.beginPath();
    ctx.arc(frame.centerX, frame.centerY, frame.glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = frame.stroke;
    ctx.lineWidth = frame.strokeWidth;
    ctx.beginPath();
    ctx.arc(frame.centerX, frame.centerY, frame.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = frame.stroke;
    ctx.beginPath();
    ctx.arc(frame.centerX, frame.centerY, frame.innerRadius, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (frame.kind === "equalizer_bars") {
    ctx.fillStyle = frame.glowFill;
    for (const bar of frame.bars) {
      drawRoundedRect(ctx, {
        ...bar,
        y: Math.max(0, bar.y - 6),
        height: Math.min(frame.height, bar.height + 6),
      });
      ctx.fill();
    }
    ctx.fillStyle = frame.fill;
    for (const bar of frame.bars) {
      drawRoundedRect(ctx, bar);
      ctx.fill();
    }
    return;
  }

  ctx.save();
  ctx.strokeStyle = frame.stroke;
  ctx.globalAlpha = frame.opacity * 0.32;
  ctx.lineWidth = frame.strokeWidth * 2.25;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const glowPath = new Path2D(frame.glowPath);
  ctx.stroke(glowPath);
  ctx.restore();

  ctx.strokeStyle = frame.stroke;
  ctx.globalAlpha = frame.opacity;
  ctx.lineWidth = frame.strokeWidth;
  const path = new Path2D(frame.path);
  ctx.stroke(path);
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

  for (const overlay of input.overlayItems) {
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
        pngBytes: await canvasToPngBytes(atlasCanvas),
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
  return Math.max(1, frame.width) * Math.max(1, frame.height);
}

export function getReactiveOverlayPresetLabel(presetId: EditorReactiveOverlayPresetId) {
  return EDITOR_REACTIVE_OVERLAY_PRESETS.find((preset) => preset.id === presetId)?.label ?? "Reactive Overlay";
}
