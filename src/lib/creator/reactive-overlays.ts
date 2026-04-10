import {
  EDITOR_REACTIVE_OVERLAY_PRESETS,
  REACTIVE_OVERLAY_ANALYSIS_HZ,
  getReactiveOverlayPresetLabel,
  renderReactiveOverlayFrameSequence,
  resolveReactiveOverlayFrame,
  resolveReactiveOverlayRect,
  type EditorReactiveAudioAnalysisTrack,
  type ReactiveOverlayFrameSequence,
  type ResolvedReactiveOverlayFrame,
} from "../editor/reactive-overlays";
import type { CreatorReactiveOverlayItem, CreatorReactiveOverlayPresetId } from "./types";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
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

export type CreatorReactiveAudioAnalysisTrack = EditorReactiveAudioAnalysisTrack;
export type CreatorReactiveOverlayFrame = ResolvedReactiveOverlayFrame;
export type CreatorReactiveOverlayFrameSequence = ReactiveOverlayFrameSequence;

export const CREATOR_REACTIVE_OVERLAY_PRESETS = EDITOR_REACTIVE_OVERLAY_PRESETS;

export function getCreatorReactiveOverlayPresetLabel(presetId: CreatorReactiveOverlayPresetId): string {
  return getReactiveOverlayPresetLabel(presetId);
}

export function createDefaultCreatorReactiveOverlay(input: {
  id: string;
  presetId: CreatorReactiveOverlayPresetId;
  startOffsetSeconds?: number;
  durationSeconds?: number;
}): CreatorReactiveOverlayItem {
  const common = {
    id: input.id,
    startOffsetSeconds: round3(Math.max(0, input.startOffsetSeconds ?? 0)),
    durationSeconds: round3(Math.max(0.4, input.durationSeconds ?? 3)),
    positionXPercent: 50,
    scale: 1,
    opacity: 0.92,
    sensitivity: 1,
    smoothing: 0.62,
  };

  if (input.presetId === "pulse_ring") {
    return {
      ...common,
      presetId: input.presetId,
      positionYPercent: 28,
      widthPercent: 24,
      heightPercent: 24,
      tintHex: "#FDE68A",
      smoothing: 0.72,
    };
  }

  if (input.presetId === "equalizer_bars") {
    return {
      ...common,
      presetId: input.presetId,
      positionYPercent: 72,
      widthPercent: 56,
      heightPercent: 18,
      tintHex: "#A5F3FC",
    };
  }

  return {
    ...common,
    presetId: input.presetId,
    positionYPercent: 72,
    widthPercent: 72,
    heightPercent: 18,
    tintHex: "#7CE7FF",
  };
}

export function normalizeCreatorReactiveOverlayItem(input: unknown): CreatorReactiveOverlayItem | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const presetId =
    record.presetId === "waveform_line" ||
    record.presetId === "equalizer_bars" ||
    record.presetId === "pulse_ring"
      ? record.presetId
      : null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  if (!presetId || !id) return null;

  const fallback = createDefaultCreatorReactiveOverlay({ id, presetId });

  return {
    id,
    presetId,
    startOffsetSeconds: round3(clampNumber(Number(record.startOffsetSeconds ?? fallback.startOffsetSeconds), 0, 600)),
    durationSeconds: round3(clampNumber(Number(record.durationSeconds ?? fallback.durationSeconds), 0.2, 600)),
    positionXPercent: clampNumber(Number(record.positionXPercent ?? fallback.positionXPercent), 0, 100),
    positionYPercent: clampNumber(Number(record.positionYPercent ?? fallback.positionYPercent), 0, 100),
    widthPercent: clampNumber(Number(record.widthPercent ?? fallback.widthPercent), 4, 100),
    heightPercent: clampNumber(Number(record.heightPercent ?? fallback.heightPercent), 4, 100),
    scale: clampNumber(Number(record.scale ?? fallback.scale), 0.2, 3),
    opacity: clampNumber(Number(record.opacity ?? fallback.opacity), 0, 1),
    tintHex:
      typeof record.tintHex === "string" && /^#[0-9a-f]{6}$/i.test(record.tintHex.trim())
        ? record.tintHex.trim()
        : fallback.tintHex,
    sensitivity: clampNumber(Number(record.sensitivity ?? fallback.sensitivity), 0.2, 3),
    smoothing: clampNumber(Number(record.smoothing ?? fallback.smoothing), 0, 0.95),
  };
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
  overlays: readonly Pick<CreatorReactiveOverlayItem, "durationSeconds">[]
) {
  const longestDurationSeconds = overlays.reduce(
    (max, overlay) => Math.max(max, Math.max(0, overlay.durationSeconds)),
    0
  );
  if (longestDurationSeconds >= 30) return 6;
  if (longestDurationSeconds >= 20) return 8;
  if (longestDurationSeconds >= 10) return 10;
  if (longestDurationSeconds >= 5) return 12;
  return 15;
}

export function resolveCreatorReactiveOverlayRect(input: {
  overlay: CreatorReactiveOverlayItem;
  frameWidth: number;
  frameHeight: number;
}) {
  return resolveReactiveOverlayRect({
    overlay: input.overlay,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
  });
}

export function resolveCreatorReactiveOverlayFrame(input: {
  overlay: CreatorReactiveOverlayItem;
  rect: { x: number; y: number; width: number; height: number };
  analysis: CreatorReactiveAudioAnalysisTrack;
  projectTimeSeconds: number;
  localTimeSeconds: number;
}): CreatorReactiveOverlayFrame {
  return resolveReactiveOverlayFrame({
    overlay: input.overlay,
    rect: input.rect,
    analysis: input.analysis,
    projectTimeSeconds: input.projectTimeSeconds,
    localTimeSeconds: input.localTimeSeconds,
  });
}

export async function renderCreatorReactiveOverlayFrameSequence(input: {
  overlays: readonly CreatorReactiveOverlayItem[];
  analysis: CreatorReactiveAudioAnalysisTrack;
  frameWidth: number;
  frameHeight: number;
  fps?: number;
  signal?: AbortSignal;
}): Promise<CreatorReactiveOverlayFrameSequence[]> {
  const projectDurationSeconds = Math.max(
    0.25,
    ...input.overlays.map((overlay) => overlay.startOffsetSeconds + Math.max(0.25, overlay.durationSeconds))
  );
  return renderReactiveOverlayFrameSequence({
    project: {
      timeline: {
        videoClips: [
          {
            id: "creator_reactive_overlay_probe",
            assetId: "creator_reactive_overlay_probe",
            label: "Creator Reactive Overlay Probe",
            trimStartSeconds: 0,
            trimEndSeconds: projectDurationSeconds,
            canvas: {
              zoom: 1,
              panX: 0,
              panY: 0,
            },
            volume: 1,
            muted: false,
            actions: {
              reverse: false,
            },
          },
        ],
        videoClipGroups: [],
        audioItems: [],
        imageItems: [],
        overlayItems: [...input.overlays],
        playheadSeconds: 0,
        zoomLevel: 1,
      },
    },
    overlayItems: input.overlays,
    analysis: input.analysis,
    outputWidth: input.frameWidth,
    outputHeight: input.frameHeight,
    fps: input.fps,
    signal: input.signal,
  });
}

export function getCreatorReactiveOverlayRasterPixelArea(input: {
  width: number;
  height: number;
  framesLength: number;
}) {
  return Math.max(1, input.width) * Math.max(1, input.height) * Math.max(1, input.framesLength);
}
