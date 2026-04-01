import type {
  CreatorSubtitleStyleSettings,
  CreatorSubtitleTextCase,
  CreatorVerticalEditorPreset,
} from "@/lib/creator/types";

type SubtitleStylePreset = CreatorVerticalEditorPreset["subtitleStyle"];
export const CREATOR_SUBTITLE_MAX_LETTER_WIDTH = 1.5;
export const CREATOR_SUBTITLE_MAX_BORDER_WIDTH = 32;

const HEX_COLOR_RE = /^#?([a-fA-F0-9]{6})$/;

export const CREATOR_SUBTITLE_STYLE_LABELS: Record<SubtitleStylePreset, string> = {
  bold_pop: "Bold Pop",
  clean_caption: "Clean Caption",
  creator_neon: "Creator Neon",
};

export interface CreatorSubtitleQuickStylePreset {
  id: string;
  name: string;
  description: string;
  style: CreatorSubtitleStyleSettings;
}

type LegacySubtitleStyleInput = Partial<CreatorSubtitleStyleSettings> & {
  outlineColor?: string;
  outlineWidth?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundRadius?: number;
  backgroundPadding?: number;
};

const DEFAULT_SUBTITLE_STYLE_BY_PRESET: Record<SubtitleStylePreset, Omit<CreatorSubtitleStyleSettings, "preset">> = {
  bold_pop: {
    textColor: "#FFFFFF",
    letterWidth: 1.08,
    borderColor: "#0A0A0A",
    borderWidth: 3.8,
    shadowColor: "#000000",
    shadowOpacity: 0.44,
    shadowDistance: 3.2,
    textCase: "uppercase",
    backgroundEnabled: false,
    backgroundColor: "#111111",
    backgroundOpacity: 0.8,
    backgroundRadius: 28,
    backgroundPaddingX: 26,
    backgroundPaddingY: 14,
  },
  clean_caption: {
    textColor: "#FFFFFF",
    letterWidth: 1.04,
    borderColor: "#2A2A2A",
    borderWidth: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.32,
    shadowDistance: 2.2,
    textCase: "original",
    backgroundEnabled: false,
    backgroundColor: "#111111",
    backgroundOpacity: 0.72,
    backgroundRadius: 22,
    backgroundPaddingX: 22,
    backgroundPaddingY: 11,
  },
  creator_neon: {
    textColor: "#E8F7FF",
    letterWidth: 1.06,
    borderColor: "#0B2A66",
    borderWidth: 3.4,
    shadowColor: "#031129",
    shadowOpacity: 0.48,
    shadowDistance: 2.8,
    textCase: "original",
    backgroundEnabled: false,
    backgroundColor: "#08111F",
    backgroundOpacity: 0.74,
    backgroundRadius: 24,
    backgroundPaddingX: 24,
    backgroundPaddingY: 12,
  },
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampCreatorSubtitleLetterWidth(value: number): number {
  return clampNumber(value, 1, CREATOR_SUBTITLE_MAX_LETTER_WIDTH);
}

function roundPx(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeHexColor(input: string | undefined, fallback: string): string {
  const match = String(input ?? "").trim().match(HEX_COLOR_RE);
  if (!match) return fallback;
  return `#${match[1].toUpperCase()}`;
}

function normalizeTextCase(input: unknown, fallback: CreatorSubtitleTextCase): CreatorSubtitleTextCase {
  return input === "uppercase" || input === "original" ? input : fallback;
}

function normalizeBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function resolvePreset(input: unknown, fallback: SubtitleStylePreset): SubtitleStylePreset {
  return input === "bold_pop" || input === "clean_caption" || input === "creator_neon" ? input : fallback;
}

function toRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, "#000000");
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function pickFiniteNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function getDefaultCreatorSubtitleStyle(preset: SubtitleStylePreset): CreatorSubtitleStyleSettings {
  return {
    preset,
    ...DEFAULT_SUBTITLE_STYLE_BY_PRESET[preset],
  };
}

export function resolveCreatorSubtitleStyle(
  fallbackPreset: SubtitleStylePreset,
  input?: LegacySubtitleStyleInput
): CreatorSubtitleStyleSettings {
  const preset = resolvePreset(input?.preset, fallbackPreset);
  const defaults = getDefaultCreatorSubtitleStyle(preset);
  const hasLegacyBackgroundConfig =
    typeof input?.backgroundColor === "string" ||
    typeof input?.backgroundOpacity === "number" ||
    typeof input?.backgroundRadius === "number" ||
    typeof input?.backgroundPadding === "number" ||
    typeof input?.backgroundPaddingX === "number" ||
    typeof input?.backgroundPaddingY === "number";

  return {
    preset,
    textColor: normalizeHexColor(input?.textColor, defaults.textColor),
    letterWidth: clampCreatorSubtitleLetterWidth(
      pickFiniteNumber(input?.letterWidth, defaults.letterWidth) ?? defaults.letterWidth
    ),
    borderColor: normalizeHexColor(input?.borderColor ?? input?.outlineColor, defaults.borderColor),
    borderWidth: clampNumber(
      pickFiniteNumber(input?.borderWidth, input?.outlineWidth, defaults.borderWidth) ?? defaults.borderWidth,
      0,
      CREATOR_SUBTITLE_MAX_BORDER_WIDTH
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
      12
    ),
    textCase: normalizeTextCase(input?.textCase, defaults.textCase),
    backgroundEnabled: normalizeBoolean(
      input?.backgroundEnabled,
      hasLegacyBackgroundConfig ? true : defaults.backgroundEnabled
    ),
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
      pickFiniteNumber(input?.backgroundPaddingX, input?.backgroundPadding, defaults.backgroundPaddingX) ??
        defaults.backgroundPaddingX,
      0,
      80
    ),
    backgroundPaddingY: clampNumber(
      pickFiniteNumber(input?.backgroundPaddingY, input?.backgroundPadding, defaults.backgroundPaddingY) ??
        defaults.backgroundPaddingY,
      0,
      48
    ),
  };
}

export function cssRgbaFromHex(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  const clampedAlpha = clampNumber(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha.toFixed(3)})`;
}

export function ffmpegHexColorFromCss(hex: string): string {
  const normalized = normalizeHexColor(hex, "#000000");
  return `0x${normalized.slice(1)}`;
}

export function ffmpegColorWithAlpha(hex: string, alpha: number): string {
  const clampedAlpha = clampNumber(alpha, 0, 1);
  return `${ffmpegHexColorFromCss(hex)}@${clampedAlpha.toFixed(3)}`;
}

export function cssTextShadowFromStyle(
  style: Pick<CreatorSubtitleStyleSettings, "shadowColor" | "shadowOpacity" | "shadowDistance">,
  scale = 1
): string {
  if (style.shadowOpacity <= 0 || style.shadowDistance <= 0) return "none";
  const distance = clampNumber(style.shadowDistance * scale, 0, 40);
  return `${distance.toFixed(2)}px ${distance.toFixed(2)}px 0 ${cssRgbaFromHex(style.shadowColor, style.shadowOpacity)}`;
}

export function getSubtitleWeightBoostOffsets(fontSize: number): number[] {
  const weightBoostPx = clampNumber(fontSize * 0.012, 0.45, 1.1);
  return [roundPx(-(weightBoostPx / 2)), roundPx(weightBoostPx / 2)];
}

export function getSubtitleLetterWidthSpreadPx(fontSize: number, letterWidth = 1): number {
  const effectiveLetterWidth = clampCreatorSubtitleLetterWidth(letterWidth);
  return clampNumber((effectiveLetterWidth - 1) * fontSize * 0.18, 0, Math.min(fontSize * 0.08, 6));
}

export function getSubtitleLetterWidthOffsets(fontSize: number, letterWidth = 1): number[] {
  const widthSpreadPx = getSubtitleLetterWidthSpreadPx(fontSize, letterWidth);
  if (widthSpreadPx < 0.75) return [];

  const offsets = new Set<number>([-widthSpreadPx, widthSpreadPx]);
  if (widthSpreadPx > 2.2) {
    offsets.add(-(widthSpreadPx * 0.55));
    offsets.add(widthSpreadPx * 0.55);
  }

  return [...offsets].map(roundPx).sort((a, b) => a - b);
}

export function getSubtitleMaxCharsPerLine(fontSize: number, letterWidth = 1, canvasWidth = 1080): number {
  const effectiveLetterWidth = clampCreatorSubtitleLetterWidth(letterWidth);
  return Math.max(10, Math.round((canvasWidth * 0.8) / (fontSize * 0.55 * effectiveLetterWidth)));
}

export function wrapSubtitleLines(text: string, maxCharsPerLine: number): string[] {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (!words.length) return [];

  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine && (currentLine.length + 1 + word.length) > maxCharsPerLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export const COMMON_SUBTITLE_STYLE_PRESETS: CreatorSubtitleQuickStylePreset[] = [
  {
    id: "yt_classic",
    name: "YouTube Classic",
    description: "White captions with a clean charcoal border and soft shadow.",
    style: {
      ...getDefaultCreatorSubtitleStyle("clean_caption"),
      preset: "clean_caption",
      textCase: "original",
    },
  },
  {
    id: "reel_bold",
    name: "Reels Bold",
    description: "Heavy uppercase text with a thicker border and stronger drop shadow.",
    style: {
      ...getDefaultCreatorSubtitleStyle("bold_pop"),
      preset: "bold_pop",
      borderWidth: 4.6,
      shadowOpacity: 0.5,
      shadowDistance: 3.6,
      textCase: "uppercase",
    },
  },
  {
    id: "tiktok_pop",
    name: "TikTok Pop",
    description: "Warm bright text, dense border, and punchier shadow separation.",
    style: {
      ...getDefaultCreatorSubtitleStyle("bold_pop"),
      preset: "bold_pop",
      textColor: "#FFF3B0",
      borderColor: "#141414",
      borderWidth: 4.4,
      shadowColor: "#2B1118",
      shadowOpacity: 0.56,
      shadowDistance: 3.8,
      textCase: "uppercase",
    },
  },
  {
    id: "podcast_soft",
    name: "Podcast Soft",
    description: "Soft off-white text with a subtle slate border and restrained shadow.",
    style: {
      ...getDefaultCreatorSubtitleStyle("clean_caption"),
      preset: "clean_caption",
      textColor: "#F4F7FA",
      borderColor: "#425466",
      borderWidth: 2,
      shadowOpacity: 0.24,
      shadowDistance: 1.8,
      textCase: "original",
    },
  },
  {
    id: "minimal_clear",
    name: "Minimal Clear",
    description: "Lean caption styling with a crisp border and barely-there shadow.",
    style: {
      ...getDefaultCreatorSubtitleStyle("clean_caption"),
      preset: "clean_caption",
      borderWidth: 2.8,
      shadowOpacity: 0.18,
      shadowDistance: 1.2,
      textCase: "original",
    },
  },
  {
    id: "boxed_focus",
    name: "Boxed Focus",
    description: "High-contrast subtitles with a soft rounded background for busy footage.",
    style: {
      ...getDefaultCreatorSubtitleStyle("clean_caption"),
      preset: "clean_caption",
      borderWidth: 2.2,
      shadowOpacity: 0.18,
      shadowDistance: 1.4,
      backgroundEnabled: true,
      backgroundColor: "#111111",
      backgroundOpacity: 0.78,
      backgroundRadius: 26,
      backgroundPaddingX: 24,
      backgroundPaddingY: 12,
      textCase: "original",
    },
  },
  {
    id: "neon_creator",
    name: "Neon Creator",
    description: "Cool cyan text with electric edge contrast and a moody shadow.",
    style: {
      ...getDefaultCreatorSubtitleStyle("creator_neon"),
      preset: "creator_neon",
      borderColor: "#0F3B82",
      borderWidth: 3.8,
      shadowColor: "#010916",
      shadowOpacity: 0.54,
      shadowDistance: 3.1,
      textCase: "original",
    },
  },
];
