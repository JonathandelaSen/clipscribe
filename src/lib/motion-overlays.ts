export const MOTION_OVERLAY_ANALYSIS_HZ = 60;
export const MOTION_OVERLAY_EXPORT_FPS = 30;

export type AudioReactiveMotionOverlayPresetId = "waveform_line" | "equalizer_bars" | "pulse_ring";
export type AutonomousMotionOverlayPresetId = "emoji_bounce" | "emoji_orbit" | "sparkle_drift";
export type MotionOverlayPresetId = AudioReactiveMotionOverlayPresetId | AutonomousMotionOverlayPresetId;
export type MotionOverlayBehavior = "audio_reactive" | "autonomous";

export interface MotionOverlayPresetDefinition {
  id: MotionOverlayPresetId;
  label: string;
  description: string;
  behavior: MotionOverlayBehavior;
  supportsEmoji?: boolean;
}

interface MotionOverlayItemBase {
  id: string;
  presetId: MotionOverlayPresetId;
  behavior: MotionOverlayBehavior;
  startOffsetSeconds: number;
  durationSeconds: number;
  positionXPercent: number;
  positionYPercent: number;
  widthPercent: number;
  heightPercent: number;
  scale: number;
  opacity: number;
  tintHex: string;
}

export interface AudioReactiveMotionOverlayItem extends MotionOverlayItemBase {
  behavior: "audio_reactive";
  presetId: AudioReactiveMotionOverlayPresetId;
  sensitivity: number;
  smoothing: number;
}

export interface AutonomousMotionOverlayItem extends MotionOverlayItemBase {
  behavior: "autonomous";
  presetId: AutonomousMotionOverlayPresetId;
  loopDurationSeconds: number;
  motionAmount: number;
  seed: number;
  emoji?: string;
}

export type MotionOverlayItem = AudioReactiveMotionOverlayItem | AutonomousMotionOverlayItem;

export interface MotionOverlayAudioAnalysisTrack {
  durationSeconds: number;
  sampleRateHz: number;
  values: Float32Array;
}

export interface MotionOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MotionOverlayBar {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface MotionOverlaySparkleParticle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotationDeg: number;
  glyph: "✦" | "✧";
  color: string;
}

export type ResolvedMotionOverlayFrame =
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
      bars: MotionOverlayBar[];
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
    }
  | {
      kind: "emoji_bounce";
      width: number;
      height: number;
      opacity: number;
      emoji: string;
      centerX: number;
      centerY: number;
      fontSize: number;
      rotationDeg: number;
      glyphScale: number;
      glowColor: string;
    }
  | {
      kind: "emoji_orbit";
      width: number;
      height: number;
      opacity: number;
      emoji: string;
      centerX: number;
      centerY: number;
      fontSize: number;
      rotationDeg: number;
      glyphScale: number;
      glowColor: string;
      orbitRadius: number;
      trailOpacity: number;
    }
  | {
      kind: "sparkle_drift";
      width: number;
      height: number;
      opacity: number;
      particles: MotionOverlaySparkleParticle[];
    };

export interface MotionOverlayFrameSequence {
  frames: Array<{ bytes: Uint8Array; filename: string }>;
  fps: number;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  presetId: MotionOverlayPresetId;
  behavior: MotionOverlayBehavior;
  mimeType: "image/png" | "image/webp";
}

export const MOTION_OVERLAY_PRESETS: readonly MotionOverlayPresetDefinition[] = [
  {
    id: "waveform_line",
    label: "Waveform Line",
    description: "A flowing line that ripples with the final mix.",
    behavior: "audio_reactive",
  },
  {
    id: "equalizer_bars",
    label: "Equalizer Bars",
    description: "Stacked bars that bounce to the audible energy.",
    behavior: "audio_reactive",
  },
  {
    id: "pulse_ring",
    label: "Pulse Ring",
    description: "A circular pulse that expands and contracts with the beat.",
    behavior: "audio_reactive",
  },
  {
    id: "emoji_bounce",
    label: "Emoji Bounce",
    description: "A single emoji that punches upward in a looping bounce.",
    behavior: "autonomous",
    supportsEmoji: true,
  },
  {
    id: "emoji_orbit",
    label: "Emoji Orbit",
    description: "An emoji that circles a focal point with a soft trail.",
    behavior: "autonomous",
    supportsEmoji: true,
  },
  {
    id: "sparkle_drift",
    label: "Sparkle Drift",
    description: "A drifting cluster of sparkles that loops independently from audio.",
    behavior: "autonomous",
  },
] as const;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number) {
  return Number(value.toFixed(3));
}

function hashStringToSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number, salt: number) {
  const hashed = Math.imul(seed ^ salt, 1597334677) >>> 0;
  return hashed / 0xffffffff;
}

function createSeededPhase(seed: number) {
  return seededUnit(seed, 97) * Math.PI * 2;
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
    throw new Error("Motion overlay rendering requires a browser canvas.");
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
                reject(new Error("Failed to rasterize motion overlay frame."));
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
    const error = new Error("Motion overlay rendering canceled.");
    error.name = "AbortError";
    throw error;
  }
}

function normalizeEmoji(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getPresetBehavior(presetId: MotionOverlayPresetId): MotionOverlayBehavior {
  return MOTION_OVERLAY_PRESETS.find((preset) => preset.id === presetId)?.behavior ?? "audio_reactive";
}

function getDefaultEmoji(presetId: AutonomousMotionOverlayPresetId) {
  if (presetId === "emoji_orbit") return "✨";
  return "🔥";
}

export function isAudioReactiveMotionOverlayItem(
  overlay: MotionOverlayItem | null | undefined
): overlay is AudioReactiveMotionOverlayItem {
  return Boolean(overlay && overlay.behavior === "audio_reactive");
}

export function isAutonomousMotionOverlayItem(
  overlay: MotionOverlayItem | null | undefined
): overlay is AutonomousMotionOverlayItem {
  return Boolean(overlay && overlay.behavior === "autonomous");
}

export function createDefaultMotionOverlayItem(input: {
  id: string;
  presetId: MotionOverlayPresetId;
  startOffsetSeconds?: number;
  durationSeconds?: number;
}): MotionOverlayItem {
  const common = {
    id: input.id,
    startOffsetSeconds: round3(Math.max(0, input.startOffsetSeconds ?? 0)),
    durationSeconds: round3(Math.max(0.4, input.durationSeconds ?? 3)),
    positionXPercent: 50,
    positionYPercent: 72,
    widthPercent: 72,
    heightPercent: 18,
    scale: 1,
    opacity: 0.95,
    tintHex: "#7CE7FF",
  } as const;

  if (input.presetId === "pulse_ring") {
    return {
      ...common,
      presetId: "pulse_ring",
      behavior: "audio_reactive",
      positionYPercent: 28,
      widthPercent: 24,
      heightPercent: 24,
      tintHex: "#FDE68A",
      sensitivity: 1,
      smoothing: 0.72,
    };
  }

  if (input.presetId === "equalizer_bars") {
    return {
      ...common,
      presetId: "equalizer_bars",
      behavior: "audio_reactive",
      widthPercent: 56,
      heightPercent: 18,
      tintHex: "#A5F3FC",
      sensitivity: 1,
      smoothing: 0.62,
    };
  }

  if (input.presetId === "emoji_bounce") {
    return {
      ...common,
      presetId: "emoji_bounce",
      behavior: "autonomous",
      positionYPercent: 28,
      widthPercent: 24,
      heightPercent: 24,
      tintHex: "#FDBA74",
      loopDurationSeconds: 1.8,
      motionAmount: 0.82,
      seed: hashStringToSeed(`${input.id}:${input.presetId}`),
      emoji: getDefaultEmoji(input.presetId),
    };
  }

  if (input.presetId === "emoji_orbit") {
    return {
      ...common,
      presetId: "emoji_orbit",
      behavior: "autonomous",
      positionYPercent: 32,
      widthPercent: 26,
      heightPercent: 26,
      tintHex: "#C4B5FD",
      loopDurationSeconds: 2.8,
      motionAmount: 0.74,
      seed: hashStringToSeed(`${input.id}:${input.presetId}`),
      emoji: getDefaultEmoji(input.presetId),
    };
  }

  if (input.presetId === "sparkle_drift") {
    return {
      ...common,
      presetId: "sparkle_drift",
      behavior: "autonomous",
      positionXPercent: 56,
      positionYPercent: 38,
      widthPercent: 34,
      heightPercent: 20,
      tintHex: "#F9A8D4",
      loopDurationSeconds: 3.4,
      motionAmount: 0.66,
      seed: hashStringToSeed(`${input.id}:${input.presetId}`),
    };
  }

  return {
    ...common,
    presetId: "waveform_line",
    behavior: "audio_reactive",
    sensitivity: 1,
    smoothing: 0.62,
  };
}

export function normalizeMotionOverlayItem(input: unknown): MotionOverlayItem | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const presetId =
    record.presetId === "waveform_line" ||
    record.presetId === "equalizer_bars" ||
    record.presetId === "pulse_ring" ||
    record.presetId === "emoji_bounce" ||
    record.presetId === "emoji_orbit" ||
    record.presetId === "sparkle_drift"
      ? record.presetId
      : null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  if (!presetId || !id) return null;

  const fallback = createDefaultMotionOverlayItem({ id, presetId });
  const behavior =
    record.behavior === "audio_reactive" || record.behavior === "autonomous"
      ? record.behavior
      : fallback.behavior;

  const common = {
    ...fallback,
    id,
    presetId,
    behavior,
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
        ? record.tintHex.trim().toUpperCase()
        : fallback.tintHex,
  };

  if (behavior === "autonomous" && (presetId === "emoji_bounce" || presetId === "emoji_orbit" || presetId === "sparkle_drift")) {
    const autonomousFallback = fallback as AutonomousMotionOverlayItem;
    return {
      ...common,
      behavior: "autonomous",
      presetId,
      loopDurationSeconds: round3(clampNumber(Number(record.loopDurationSeconds ?? autonomousFallback.loopDurationSeconds), 0.4, 20)),
      motionAmount: clampNumber(Number(record.motionAmount ?? autonomousFallback.motionAmount), 0.1, 1.5),
      seed: Math.max(0, Math.floor(Number(record.seed ?? autonomousFallback.seed) || autonomousFallback.seed)),
      emoji:
        presetId === "emoji_bounce" || presetId === "emoji_orbit"
          ? normalizeEmoji(record.emoji, autonomousFallback.emoji ?? getDefaultEmoji(presetId))
          : undefined,
    };
  }

  const reactiveFallback = fallback as AudioReactiveMotionOverlayItem;
  return {
    ...common,
    behavior: "audio_reactive",
    presetId: presetId as AudioReactiveMotionOverlayPresetId,
    sensitivity: clampNumber(Number(record.sensitivity ?? reactiveFallback.sensitivity), 0.2, 3),
    smoothing: clampNumber(Number(record.smoothing ?? reactiveFallback.smoothing), 0, 0.95),
  };
}

export function resolveMotionOverlayRect(input: {
  overlay: MotionOverlayItem;
  frameWidth: number;
  frameHeight: number;
}): MotionOverlayRect {
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

export function getMotionOverlayAnalysisValueAtTime(
  analysis: MotionOverlayAudioAnalysisTrack,
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

export function getMotionOverlayEnergyAtTime(input: {
  analysis: MotionOverlayAudioAnalysisTrack;
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

function resolveAutonomousPhase(overlay: AutonomousMotionOverlayItem, localTimeSeconds: number) {
  const loop = Math.max(0.4, overlay.loopDurationSeconds);
  return ((localTimeSeconds % loop) / loop) * Math.PI * 2 + createSeededPhase(overlay.seed);
}

export function resolveMotionOverlayFrame(input: {
  overlay: MotionOverlayItem;
  rect: Pick<MotionOverlayRect, "width" | "height">;
  analysis?: MotionOverlayAudioAnalysisTrack | null;
  projectTimeSeconds: number;
  localTimeSeconds: number;
}): ResolvedMotionOverlayFrame {
  const width = Math.max(1, input.rect.width);
  const height = Math.max(1, input.rect.height);
  const opacity = clampNumber(input.overlay.opacity, 0.05, 1);

  if (input.overlay.behavior === "autonomous") {
    const overlay = input.overlay;
    const phase = resolveAutonomousPhase(overlay, input.localTimeSeconds);
    const motionAmount = clampNumber(overlay.motionAmount, 0.1, 1.5);
    const seedPhase = createSeededPhase(overlay.seed);

    if (overlay.presetId === "emoji_bounce") {
      const bounce = Math.abs(Math.sin(phase));
      return {
        kind: "emoji_bounce",
        width,
        height,
        opacity,
        emoji: overlay.emoji ?? getDefaultEmoji("emoji_bounce"),
        centerX: width / 2,
        centerY: height * (0.78 - bounce * 0.38 * motionAmount),
        fontSize: Math.max(24, Math.min(width, height) * 0.8),
        rotationDeg: Math.sin(phase * 2) * 12 * motionAmount,
        glyphScale: 0.92 + bounce * 0.2 * motionAmount,
        glowColor: rgba(overlay.tintHex, 0.28 + bounce * 0.16),
      };
    }

    if (overlay.presetId === "emoji_orbit") {
      const orbitRadius = Math.min(width, height) * (0.12 + 0.18 * motionAmount);
      const orbitAngle = phase + seedPhase * 0.35;
      return {
        kind: "emoji_orbit",
        width,
        height,
        opacity,
        emoji: overlay.emoji ?? getDefaultEmoji("emoji_orbit"),
        centerX: width / 2 + Math.cos(orbitAngle) * orbitRadius,
        centerY: height / 2 + Math.sin(orbitAngle * 1.2) * orbitRadius * 0.72,
        fontSize: Math.max(22, Math.min(width, height) * 0.56),
        rotationDeg: Math.sin(orbitAngle) * 16 * motionAmount,
        glyphScale: 0.9 + Math.sin(orbitAngle + seedPhase) * 0.12,
        glowColor: rgba(overlay.tintHex, 0.24),
        orbitRadius,
        trailOpacity: 0.14 + 0.1 * motionAmount,
      };
    }

    const particles: MotionOverlaySparkleParticle[] = Array.from({ length: 8 }, (_unused, index) => {
      const particleSeed = overlay.seed + index * 9973;
      const progress = ((input.localTimeSeconds / Math.max(0.4, overlay.loopDurationSeconds)) + seededUnit(particleSeed, 13)) % 1;
      const x = width * (0.12 + 0.76 * seededUnit(particleSeed, 23));
      const y = height * ((1.08 - progress * (1.1 + 0.2 * motionAmount) + seededUnit(particleSeed, 31) * 0.18) % 1);
      const size = Math.max(12, Math.min(width, height) * (0.08 + 0.12 * seededUnit(particleSeed, 41)));
      return {
        x,
        y,
        size,
        opacity: clampNumber(0.18 + (1 - progress) * 0.62, 0.12, 0.88),
        rotationDeg: seededUnit(particleSeed, 53) * 180 - 90,
        glyph: index % 2 === 0 ? "✦" : "✧",
        color: rgba(overlay.tintHex, 0.3 + seededUnit(particleSeed, 61) * 0.55),
      };
    });
    return {
      kind: "sparkle_drift",
      width,
      height,
      opacity,
      particles,
    };
  }

  const analysis = input.analysis;
  const overlay = input.overlay;
  const energy = analysis
    ? getMotionOverlayEnergyAtTime({
        analysis,
        timeSeconds: input.projectTimeSeconds,
        smoothing: overlay.smoothing,
        sensitivity: overlay.sensitivity,
      })
    : 0;

  if (overlay.presetId === "pulse_ring") {
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
      stroke: rgba(overlay.tintHex, 0.96),
      glowFill: rgba(overlay.tintHex, 0.18 + energy * 0.22),
      centerX,
      centerY,
      radius,
      innerRadius,
      strokeWidth: Math.max(2, Math.round(Math.min(width, height) * (0.03 + energy * 0.015))),
      glowRadius: radius + Math.min(width, height) * (0.08 + energy * 0.08),
    };
  }

  if (overlay.presetId === "equalizer_bars") {
    const barCount = 22;
    const gap = width * 0.018;
    const barWidth = (width - gap * (barCount - 1)) / barCount;
    const bars: MotionOverlayBar[] = [];
    for (let index = 0; index < barCount; index += 1) {
      const bandTime = input.projectTimeSeconds - 0.18 + index * 0.012;
      const bandEnergy = analysis
        ? getMotionOverlayEnergyAtTime({
            analysis,
            timeSeconds: bandTime,
            smoothing: overlay.smoothing,
            sensitivity: overlay.sensitivity,
          })
        : 0;
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
      fill: rgba(overlay.tintHex, 0.88),
      glowFill: rgba(overlay.tintHex, 0.22),
      bars,
    };
  }

  const pointCount = 48;
  const historyWindowSeconds = 1.4;
  const midY = height / 2;
  const points = Array.from({ length: pointCount }, (_value, index) => {
    const ratio = index / Math.max(1, pointCount - 1);
    const sampleTime = input.projectTimeSeconds - historyWindowSeconds + historyWindowSeconds * ratio;
    const sampleEnergy = analysis
        ? getMotionOverlayEnergyAtTime({
            analysis,
            timeSeconds: sampleTime,
            smoothing: overlay.smoothing,
            sensitivity: overlay.sensitivity,
          })
        : 0;
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
    stroke: rgba(overlay.tintHex, 0.94),
    strokeWidth: Math.max(2, Math.round(height * 0.06)),
    path: buildWavePath(points),
    glowPath: buildWavePath(points),
  };
}

function drawRoundedRect(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  bar: MotionOverlayBar
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

function drawEmojiOverlayFrame(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: Extract<ResolvedMotionOverlayFrame, { kind: "emoji_bounce" | "emoji_orbit" }>
) {
  if (frame.kind === "emoji_orbit") {
    ctx.save();
    ctx.globalAlpha = Math.max(0.08, frame.trailOpacity);
    ctx.strokeStyle = frame.glowColor;
    ctx.lineWidth = Math.max(1, frame.fontSize * 0.07);
    ctx.beginPath();
    ctx.arc(frame.width / 2, frame.height / 2, frame.orbitRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(frame.centerX, frame.centerY);
  ctx.rotate((frame.rotationDeg * Math.PI) / 180);
  ctx.scale(frame.glyphScale, frame.glyphScale);
  ctx.font = `${Math.round(frame.fontSize)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = frame.glowColor;
  ctx.shadowBlur = Math.max(8, frame.fontSize * 0.16);
  ctx.fillText(frame.emoji, 0, 0);
  ctx.restore();
}

export function drawMotionOverlayFrameToContext(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  frame: ResolvedMotionOverlayFrame
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

  if (frame.kind === "emoji_bounce" || frame.kind === "emoji_orbit") {
    drawEmojiOverlayFrame(ctx, frame);
    return;
  }

  if (frame.kind === "sparkle_drift") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const particle of frame.particles) {
      ctx.save();
      ctx.translate(particle.x, particle.y);
      ctx.rotate((particle.rotationDeg * Math.PI) / 180);
      ctx.font = `${Math.round(particle.size)}px "Apple Color Emoji","Segoe UI Symbol","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = frame.opacity * particle.opacity;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = Math.max(4, particle.size * 0.12);
      ctx.fillText(particle.glyph, 0, 0);
      ctx.restore();
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

export function resolveMotionOverlayExportFps(
  overlays: readonly Pick<MotionOverlayItem, "presetId" | "durationSeconds" | "behavior">[]
) {
  const resolveOverlayFps = (overlay: Pick<MotionOverlayItem, "presetId" | "durationSeconds" | "behavior">) => {
    const durationSeconds = Math.max(0, overlay.durationSeconds);

    if (overlay.behavior === "autonomous") {
      if (durationSeconds >= 120) return 6;
      if (durationSeconds >= 45) return 8;
      if (durationSeconds >= 20) return 10;
      return 12;
    }

    if (overlay.presetId === "equalizer_bars") {
      if (durationSeconds >= 300) return 3;
      if (durationSeconds >= 120) return 4;
      if (durationSeconds >= 60) return 5;
      if (durationSeconds >= 30) return 6;
      if (durationSeconds >= 20) return 8;
      if (durationSeconds >= 10) return 10;
      if (durationSeconds >= 5) return 12;
      return 15;
    }

    if (overlay.presetId === "pulse_ring") {
      if (durationSeconds >= 300) return 2;
      if (durationSeconds >= 120) return 3;
      if (durationSeconds >= 60) return 4;
      if (durationSeconds >= 30) return 6;
      if (durationSeconds >= 20) return 8;
      if (durationSeconds >= 10) return 10;
      if (durationSeconds >= 5) return 12;
      return 15;
    }

    if (durationSeconds >= 300) return 1;
    if (durationSeconds >= 120) return 2;
    if (durationSeconds >= 60) return 4;
    if (durationSeconds >= 30) return 6;
    if (durationSeconds >= 20) return 8;
    if (durationSeconds >= 10) return 10;
    if (durationSeconds >= 5) return 12;
    return 15;
  };

  return overlays.reduce((max, overlay) => Math.max(max, resolveOverlayFps(overlay)), 1);
}

export async function renderMotionOverlayFrameSequence(input: {
  overlayItems: readonly MotionOverlayItem[];
  analysis?: MotionOverlayAudioAnalysisTrack | null;
  outputWidth: number;
  outputHeight: number;
  projectDuration?: number;
  fps?: number;
  signal?: AbortSignal;
}): Promise<MotionOverlayFrameSequence[]> {
  const fps = input.fps ?? MOTION_OVERLAY_EXPORT_FPS;
  const sequences: MotionOverlayFrameSequence[] = [];
  const projectDuration = Math.max(
    input.projectDuration ?? 0,
    0.25,
    ...input.overlayItems.map((overlay) => overlay.startOffsetSeconds + Math.max(0.25, overlay.durationSeconds))
  );
  const preferredMimeType = "image/webp";
  const quality = 0.85;

  for (const overlay of input.overlayItems) {
    throwIfAborted(input.signal);
    const rect = resolveMotionOverlayRect({
      overlay,
      frameWidth: input.outputWidth,
      frameHeight: input.outputHeight,
    });
    const overlayStart = Math.max(0, overlay.startOffsetSeconds);
    const overlayEnd = Math.min(projectDuration, overlay.startOffsetSeconds + Math.max(0.25, overlay.durationSeconds));
    const frameCount = Math.max(1, Math.ceil((overlayEnd - overlayStart) * fps));
    const frameCanvas = createRasterCanvas(rect.width, rect.height);
    const frameCtx = frameCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!frameCtx) {
      throw new Error("Failed to create motion overlay sequence context.");
    }

    let actualMimeType: "image/png" | "image/webp" = preferredMimeType;
    const frames: Array<{ bytes: Uint8Array; filename: string }> = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      throwIfAborted(input.signal);
      const frameStart = overlayStart + frameIndex / fps;
      const resolved = resolveMotionOverlayFrame({
        overlay,
        rect,
        analysis: overlay.behavior === "audio_reactive" ? input.analysis : null,
        projectTimeSeconds: frameStart,
        localTimeSeconds: Math.max(0, frameStart - overlayStart),
      });
      drawMotionOverlayFrameToContext(frameCtx, resolved);

      let bytes: Uint8Array;
      try {
        bytes = await canvasToImageBytes(frameCanvas, actualMimeType, quality);
      } catch {
        if (actualMimeType === "image/webp") {
          actualMimeType = "image/png";
          bytes = await canvasToImageBytes(frameCanvas, actualMimeType, quality);
        } else {
          throw new Error("Failed to rasterize motion overlay frame.");
        }
      }

      const extension = actualMimeType === "image/webp" ? "webp" : "png";
      frames.push({
        bytes,
        filename: `frame_${String(frameIndex + 1).padStart(5, "0")}.${extension}`,
      });
    }

    sequences.push({
      frames,
      fps,
      start: overlayStart,
      end: overlayEnd,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      presetId: overlay.presetId,
      behavior: overlay.behavior,
      mimeType: actualMimeType,
    });
  }

  return sequences;
}

export function getMotionOverlayRasterPixelArea(input: {
  width?: number;
  height?: number;
  framesLength?: number;
}) {
  return Math.max(1, input.width ?? 1) * Math.max(1, input.height ?? 1) * Math.max(1, input.framesLength ?? 1);
}

export function getMotionOverlayPresetLabel(presetId: MotionOverlayPresetId) {
  return MOTION_OVERLAY_PRESETS.find((preset) => preset.id === presetId)?.label ?? "Motion Overlay";
}
