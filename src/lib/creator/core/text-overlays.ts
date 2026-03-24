import type {
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorSuggestedShort,
  CreatorTextOverlayPreset,
  CreatorTextOverlayState,
} from "@/lib/creator/types";
import type { CreatorShortProjectOrigin } from "@/lib/creator/storage";

export type CreatorTextOverlaySlot = "intro" | "outro";

interface HydrateTextOverlayOptions {
  origin?: CreatorShortProjectOrigin;
  short?: CreatorSuggestedShort;
  plan?: CreatorShortPlan;
  clipDurationSeconds?: number;
}

export interface CreatorResolvedTextOverlayWindow {
  enabled: boolean;
  text: string;
  startOffsetSeconds: number;
  durationSeconds: number;
  endOffsetSeconds: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function getSafeClipDuration(clipDurationSeconds?: number): number {
  if (typeof clipDurationSeconds === "number" && Number.isFinite(clipDurationSeconds) && clipDurationSeconds > 0) {
    return clipDurationSeconds;
  }
  return 60;
}

export function getCreatorTextOverlayFallbackPreset(slot: CreatorTextOverlaySlot): CreatorTextOverlayPreset {
  return slot === "intro" ? "headline_bold" : "glass_card";
}

export function getCreatorTextOverlayFontSize(
  slot: CreatorTextOverlaySlot,
  scale: number
): number {
  const base = slot === "intro" ? 94 : 74;
  return Math.round(clampNumber(base * scale, 36, slot === "intro" ? 160 : 132));
}

function getDefaultOverlayText(
  slot: CreatorTextOverlaySlot,
  origin: CreatorShortProjectOrigin,
  short?: CreatorSuggestedShort,
  plan?: CreatorShortPlan
): string {
  if (origin !== "ai_suggestion") return "";
  const introText = short?.openingText ?? plan?.openingText ?? "";
  const outroText = short?.endCardText ?? plan?.endCardText ?? "";
  return slot === "intro" ? introText : outroText;
}

export function getDefaultCreatorTextOverlayState(
  slot: CreatorTextOverlaySlot,
  options: HydrateTextOverlayOptions = {}
): CreatorTextOverlayState {
  const origin = options.origin ?? "manual";
  const clipDurationSeconds = getSafeClipDuration(options.clipDurationSeconds);
  const defaultEnabled = origin === "ai_suggestion";

  if (slot === "intro") {
    return {
      enabled: defaultEnabled,
      text: getDefaultOverlayText(slot, origin, options.short, options.plan),
      startOffsetSeconds: 0,
      durationSeconds: round2(Math.min(3.2, clipDurationSeconds)),
      positionXPercent: 50,
      positionYPercent: 24,
      scale: 1,
      maxWidthPct: 78,
      style: {
        preset: getCreatorTextOverlayFallbackPreset(slot),
      },
    };
  }

  return {
    enabled: defaultEnabled,
    text: getDefaultOverlayText(slot, origin, options.short, options.plan),
    startOffsetSeconds: round2(Math.max(0, clipDurationSeconds - 2.6)),
    durationSeconds: round2(Math.min(2.6, clipDurationSeconds)),
    positionXPercent: 50,
    positionYPercent: 34,
    scale: 0.9,
    maxWidthPct: 72,
    style: {
      preset: getCreatorTextOverlayFallbackPreset(slot),
    },
  };
}

export function hydrateCreatorTextOverlayState(
  slot: CreatorTextOverlaySlot,
  input: CreatorTextOverlayState | undefined,
  options: HydrateTextOverlayOptions = {}
): CreatorTextOverlayState {
  const defaults = getDefaultCreatorTextOverlayState(slot, options);

  return {
    enabled: typeof input?.enabled === "boolean" ? input.enabled : defaults.enabled,
    text: typeof input?.text === "string" ? input.text : defaults.text,
    startOffsetSeconds:
      typeof input?.startOffsetSeconds === "number" && Number.isFinite(input.startOffsetSeconds)
        ? input.startOffsetSeconds
        : defaults.startOffsetSeconds,
    durationSeconds:
      typeof input?.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
        ? input.durationSeconds
        : defaults.durationSeconds,
    positionXPercent:
      typeof input?.positionXPercent === "number" && Number.isFinite(input.positionXPercent)
        ? clampNumber(input.positionXPercent, 5, 95)
        : defaults.positionXPercent,
    positionYPercent:
      typeof input?.positionYPercent === "number" && Number.isFinite(input.positionYPercent)
        ? clampNumber(input.positionYPercent, 5, 95)
        : defaults.positionYPercent,
    scale:
      typeof input?.scale === "number" && Number.isFinite(input.scale)
        ? clampNumber(input.scale, 0.5, 2.5)
        : defaults.scale,
    maxWidthPct:
      typeof input?.maxWidthPct === "number" && Number.isFinite(input.maxWidthPct)
        ? clampNumber(input.maxWidthPct, 20, 95)
        : defaults.maxWidthPct,
    style:
      input?.style && typeof input.style === "object"
        ? { ...defaults.style, ...input.style }
        : defaults.style,
  };
}

export function hydrateCreatorShortEditorState(
  input: Partial<CreatorShortEditorState> | undefined,
  options: HydrateTextOverlayOptions = {}
): CreatorShortEditorState {
  return {
    zoom:
      typeof input?.zoom === "number" && Number.isFinite(input.zoom)
        ? input.zoom
        : 1.15,
    panX:
      typeof input?.panX === "number" && Number.isFinite(input.panX)
        ? input.panX
        : 0,
    panY:
      typeof input?.panY === "number" && Number.isFinite(input.panY)
        ? input.panY
        : 0,
    subtitleScale:
      typeof input?.subtitleScale === "number" && Number.isFinite(input.subtitleScale)
        ? input.subtitleScale
        : 1,
    subtitleXPositionPct:
      typeof input?.subtitleXPositionPct === "number" && Number.isFinite(input.subtitleXPositionPct)
        ? input.subtitleXPositionPct
        : 50,
    subtitleYOffsetPct:
      typeof input?.subtitleYOffsetPct === "number" && Number.isFinite(input.subtitleYOffsetPct)
        ? input.subtitleYOffsetPct
        : 78,
    showSubtitles: input?.showSubtitles ?? true,
    showSafeZones: input?.showSafeZones ?? true,
    subtitleStyle:
      input?.subtitleStyle && typeof input.subtitleStyle === "object" ? input.subtitleStyle : {},
    introOverlay: hydrateCreatorTextOverlayState("intro", input?.introOverlay, options),
    outroOverlay: hydrateCreatorTextOverlayState("outro", input?.outroOverlay, options),
  };
}

export function resolveCreatorTextOverlayWindow(
  overlay: CreatorTextOverlayState,
  clipDurationSeconds: number
): CreatorResolvedTextOverlayWindow {
  const safeClipDuration = getSafeClipDuration(clipDurationSeconds);
  const trimmedText = overlay.text.trim();
  if (!overlay.enabled || !trimmedText) {
    return {
      enabled: false,
      text: trimmedText,
      startOffsetSeconds: 0,
      durationSeconds: 0,
      endOffsetSeconds: 0,
    };
  }

  const startOffsetSeconds = clampNumber(overlay.startOffsetSeconds, 0, safeClipDuration);
  const maxDuration = Math.max(0, safeClipDuration - startOffsetSeconds);
  const durationSeconds = clampNumber(overlay.durationSeconds, 0, maxDuration);

  if (durationSeconds <= 0) {
    return {
      enabled: false,
      text: trimmedText,
      startOffsetSeconds,
      durationSeconds: 0,
      endOffsetSeconds: startOffsetSeconds,
    };
  }

  return {
    enabled: true,
    text: trimmedText,
    startOffsetSeconds: round2(startOffsetSeconds),
    durationSeconds: round2(durationSeconds),
    endOffsetSeconds: round2(startOffsetSeconds + durationSeconds),
  };
}
