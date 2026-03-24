import { cssRgbaFromHex } from "@/lib/creator/subtitle-style";
import type {
  CreatorTextOverlayPreset,
  CreatorTextOverlayStyleSettings,
  CreatorTextOverlayTextCase,
} from "@/lib/creator/types";

const HEX_COLOR_RE = /^#?([a-fA-F0-9]{6})$/;

export const CREATOR_TEXT_OVERLAY_STYLE_LABELS: Record<CreatorTextOverlayPreset, string> = {
  headline_bold: "Headline Bold",
  glass_card: "Glass Card",
  neon_punch: "Neon Punch",
};

export interface CreatorTextOverlayQuickStylePreset {
  id: string;
  name: string;
  description: string;
  style: CreatorTextOverlayStyleSettings;
}

const DEFAULT_TEXT_OVERLAY_STYLE_BY_PRESET: Record<
  CreatorTextOverlayPreset,
  Omit<CreatorTextOverlayStyleSettings, "preset">
> = {
  headline_bold: {
    textColor: "#FFF8E7",
    borderColor: "#111111",
    borderWidth: 3.8,
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowDistance: 4.2,
    textCase: "uppercase",
    backgroundEnabled: true,
    backgroundColor: "#111111",
    backgroundOpacity: 0.48,
    backgroundRadius: 34,
    backgroundPaddingX: 34,
    backgroundPaddingY: 18,
  },
  glass_card: {
    textColor: "#FFFFFF",
    borderColor: "#DCE8F4",
    borderWidth: 1.2,
    shadowColor: "#031129",
    shadowOpacity: 0.2,
    shadowDistance: 3.2,
    textCase: "original",
    backgroundEnabled: true,
    backgroundColor: "#0B1220",
    backgroundOpacity: 0.58,
    backgroundRadius: 40,
    backgroundPaddingX: 30,
    backgroundPaddingY: 18,
  },
  neon_punch: {
    textColor: "#F4FBFF",
    borderColor: "#133B74",
    borderWidth: 3,
    shadowColor: "#030712",
    shadowOpacity: 0.42,
    shadowDistance: 4.6,
    textCase: "uppercase",
    backgroundEnabled: true,
    backgroundColor: "#07111E",
    backgroundOpacity: 0.5,
    backgroundRadius: 30,
    backgroundPaddingX: 32,
    backgroundPaddingY: 17,
  },
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(input: string | undefined, fallback: string): string {
  const match = String(input ?? "").trim().match(HEX_COLOR_RE);
  if (!match) return fallback;
  return `#${match[1].toUpperCase()}`;
}

function normalizeTextCase(input: unknown, fallback: CreatorTextOverlayTextCase): CreatorTextOverlayTextCase {
  return input === "uppercase" || input === "original" ? input : fallback;
}

function normalizeBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function pickFiniteNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function getDefaultCreatorTextOverlayStyle(
  preset: CreatorTextOverlayPreset
): CreatorTextOverlayStyleSettings {
  return {
    preset,
    ...DEFAULT_TEXT_OVERLAY_STYLE_BY_PRESET[preset],
  };
}

export function resolveCreatorTextOverlayStyle(
  fallbackPreset: CreatorTextOverlayPreset,
  input?: Partial<CreatorTextOverlayStyleSettings>
): CreatorTextOverlayStyleSettings {
  const preset =
    input?.preset === "headline_bold" || input?.preset === "glass_card" || input?.preset === "neon_punch"
      ? input.preset
      : fallbackPreset;
  const defaults = getDefaultCreatorTextOverlayStyle(preset);

  return {
    preset,
    textColor: normalizeHexColor(input?.textColor, defaults.textColor),
    borderColor: normalizeHexColor(input?.borderColor, defaults.borderColor),
    borderWidth: clampNumber(
      pickFiniteNumber(input?.borderWidth, defaults.borderWidth) ?? defaults.borderWidth,
      0,
      8
    ),
    shadowColor: normalizeHexColor(input?.shadowColor, defaults.shadowColor),
    shadowOpacity: clampNumber(
      pickFiniteNumber(input?.shadowOpacity, defaults.shadowOpacity) ?? defaults.shadowOpacity,
      0,
      1
    ),
    shadowDistance: clampNumber(
      pickFiniteNumber(input?.shadowDistance, defaults.shadowDistance) ?? defaults.shadowDistance,
      0,
      16
    ),
    textCase: normalizeTextCase(input?.textCase, defaults.textCase),
    backgroundEnabled: normalizeBoolean(input?.backgroundEnabled, defaults.backgroundEnabled),
    backgroundColor: normalizeHexColor(input?.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: clampNumber(
      pickFiniteNumber(input?.backgroundOpacity, defaults.backgroundOpacity) ?? defaults.backgroundOpacity,
      0,
      1
    ),
    backgroundRadius: clampNumber(
      pickFiniteNumber(input?.backgroundRadius, defaults.backgroundRadius) ?? defaults.backgroundRadius,
      0,
      80
    ),
    backgroundPaddingX: clampNumber(
      pickFiniteNumber(input?.backgroundPaddingX, defaults.backgroundPaddingX) ?? defaults.backgroundPaddingX,
      0,
      80
    ),
    backgroundPaddingY: clampNumber(
      pickFiniteNumber(input?.backgroundPaddingY, defaults.backgroundPaddingY) ?? defaults.backgroundPaddingY,
      0,
      48
    ),
  };
}

export function getCreatorTextOverlayMaxCharsPerLine(
  fontSize: number,
  maxWidthPct: number,
  canvasWidth = 1080
): number {
  const safeWidthPct = clampNumber(maxWidthPct, 20, 95) / 100;
  return Math.max(5, Math.round((canvasWidth * safeWidthPct) / (fontSize * 0.58)));
}

export function wrapCreatorTextOverlayLines(text: string, maxCharsPerLine: number): string[] {
  const paragraphs = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!paragraphs.length) return [];

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    let currentLine = "";
    for (const word of words) {
      if (currentLine && currentLine.length + 1 + word.length > maxCharsPerLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }

    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

export function cssTextShadowFromTextOverlayStyle(
  style: Pick<CreatorTextOverlayStyleSettings, "shadowColor" | "shadowOpacity" | "shadowDistance">,
  scale = 1
): string {
  if (style.shadowOpacity <= 0 || style.shadowDistance <= 0) return "none";
  const distance = clampNumber(style.shadowDistance * scale, 0, 48);
  return `${distance.toFixed(2)}px ${distance.toFixed(2)}px 0 ${cssRgbaFromHex(style.shadowColor, style.shadowOpacity)}`;
}

export const COMMON_TEXT_OVERLAY_STYLE_PRESETS: CreatorTextOverlayQuickStylePreset[] = [
  {
    id: "headline_flash",
    name: "Headline Flash",
    description: "Big uppercase headline with a warm card and heavy edge contrast.",
    style: {
      ...getDefaultCreatorTextOverlayStyle("headline_bold"),
      preset: "headline_bold",
    },
  },
  {
    id: "soft_glass",
    name: "Soft Glass",
    description: "Rounded translucent card with cleaner copy for calmer clips.",
    style: {
      ...getDefaultCreatorTextOverlayStyle("glass_card"),
      preset: "glass_card",
      borderWidth: 1,
      shadowOpacity: 0.16,
    },
  },
  {
    id: "neon_hook",
    name: "Neon Hook",
    description: "Sharper contrast and cooler energy for punchy hook text.",
    style: {
      ...getDefaultCreatorTextOverlayStyle("neon_punch"),
      preset: "neon_punch",
      backgroundOpacity: 0.58,
      borderWidth: 3.4,
    },
  },
];
