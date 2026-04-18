import {
  MOTION_OVERLAY_ANALYSIS_HZ,
  MOTION_OVERLAY_PRESETS,
  createDefaultMotionOverlayItem,
  getMotionOverlayPresetLabel,
  getMotionOverlayRasterPixelArea,
  isAudioReactiveMotionOverlayItem,
  normalizeMotionOverlayItem,
  renderMotionOverlayFrameSequence,
  resolveMotionOverlayExportFps,
  resolveMotionOverlayFrame,
  resolveMotionOverlayRect,
  type AudioReactiveMotionOverlayItem,
  type AudioReactiveMotionOverlayPresetId,
  type MotionOverlayAudioAnalysisTrack,
  type MotionOverlayFrameSequence,
  type ResolvedMotionOverlayFrame,
} from "../motion-overlays";
import type { CreatorReactiveOverlayItem, CreatorReactiveOverlayPresetId } from "./types";

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

export type CreatorReactiveAudioAnalysisTrack = MotionOverlayAudioAnalysisTrack;
export type CreatorReactiveOverlayFrame = ResolvedMotionOverlayFrame;
export type CreatorReactiveOverlayFrameSequence = MotionOverlayFrameSequence;

export const CREATOR_REACTIVE_OVERLAY_PRESETS = MOTION_OVERLAY_PRESETS.filter(
  (preset): preset is (typeof MOTION_OVERLAY_PRESETS)[number] & { id: AudioReactiveMotionOverlayPresetId } =>
    preset.behavior === "audio_reactive"
);
export const REACTIVE_OVERLAY_ANALYSIS_HZ = MOTION_OVERLAY_ANALYSIS_HZ;

export function getCreatorReactiveOverlayPresetLabel(presetId: CreatorReactiveOverlayPresetId) {
  return getMotionOverlayPresetLabel(presetId);
}

export function createDefaultCreatorReactiveOverlay(input: {
  id: string;
  presetId: CreatorReactiveOverlayPresetId;
  startOffsetSeconds?: number;
  durationSeconds?: number;
}): CreatorReactiveOverlayItem {
  return createDefaultMotionOverlayItem({
    id: input.id,
    presetId: input.presetId,
    startOffsetSeconds: input.startOffsetSeconds,
    durationSeconds: input.durationSeconds,
  }) as AudioReactiveMotionOverlayItem;
}

export function normalizeCreatorReactiveOverlayItem(input: unknown): CreatorReactiveOverlayItem | null {
  const overlay = normalizeMotionOverlayItem(input);
  return isAudioReactiveMotionOverlayItem(overlay) ? overlay : null;
}

export function buildCreatorReactiveOverlayAudioAnalysis(input: {
  clipStartSeconds: number;
  clipDurationSeconds: number;
  decodedSamples: Float32Array;
  sampleRate?: number;
  sampleRateHz?: number;
}): CreatorReactiveAudioAnalysisTrack {
  const sampleRate = input.sampleRate ?? 16000;
  const sampleRateHz = input.sampleRateHz ?? REACTIVE_OVERLAY_ANALYSIS_HZ;
  const clipDurationSeconds = Math.max(0.25, input.clipDurationSeconds);
  const frameCount = Math.max(1, Math.ceil(clipDurationSeconds * sampleRateHz));
  const values = new Float32Array(frameCount);
  const binDurationSeconds = 1 / sampleRateHz;

  for (let binIndex = 0; binIndex < frameCount; binIndex += 1) {
    const localStart = binIndex * binDurationSeconds;
    const localEnd = Math.min(clipDurationSeconds, localStart + binDurationSeconds);
    values[binIndex] = measureAudioWindowEnergy(
      input.decodedSamples,
      sampleRate,
      input.clipStartSeconds + localStart,
      input.clipStartSeconds + localEnd
    );
  }

  return {
    durationSeconds: round3(clipDurationSeconds),
    sampleRateHz,
    values: normalizeAnalysisValues(values),
  };
}

export function resolveCreatorReactiveOverlayExportFps(
  overlays: readonly Pick<CreatorReactiveOverlayItem, "durationSeconds" | "presetId" | "behavior">[]
) {
  return resolveMotionOverlayExportFps(overlays);
}

export function resolveCreatorReactiveOverlayRect(input: {
  overlay: CreatorReactiveOverlayItem;
  frameWidth: number;
  frameHeight: number;
}) {
  return resolveMotionOverlayRect(input);
}

export function resolveCreatorReactiveOverlayFrame(input: {
  overlay: CreatorReactiveOverlayItem;
  rect: { x: number; y: number; width: number; height: number };
  analysis: CreatorReactiveAudioAnalysisTrack;
  projectTimeSeconds: number;
  localTimeSeconds: number;
}) {
  return resolveMotionOverlayFrame(input);
}

export async function renderCreatorReactiveOverlayFrameSequence(input: {
  overlays: readonly CreatorReactiveOverlayItem[];
  analysis: CreatorReactiveAudioAnalysisTrack;
  frameWidth: number;
  frameHeight: number;
  fps?: number;
  signal?: AbortSignal;
}): Promise<CreatorReactiveOverlayFrameSequence[]> {
  return renderMotionOverlayFrameSequence({
    overlayItems: input.overlays,
    analysis: input.analysis,
    outputWidth: input.frameWidth,
    outputHeight: input.frameHeight,
    fps: input.fps,
    signal: input.signal,
  });
}

export function getCreatorReactiveOverlayRasterPixelArea(input: {
  width?: number;
  height?: number;
  framesLength?: number;
}) {
  return getMotionOverlayRasterPixelArea(input);
}
