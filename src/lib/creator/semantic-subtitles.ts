import type { SubtitleChunk } from "../history";
import {
  getDefaultCreatorSubtitleStyle,
  getSubtitleMaxCharsPerLine,
  resolveCreatorSubtitleStyle,
} from "./subtitle-style";
import type {
  CreatorShortEditorState,
  CreatorSubtitleStyleSettings,
  CreatorSuggestedShort,
} from "./types";

export const CREATOR_EXPORT_SUBTITLE_CANVAS_WIDTH = 1080;
export const CREATOR_EXPORT_SUBTITLE_CANVAS_HEIGHT = 1920;

export interface CreatorShortSemanticSubtitleCue {
  text: string;
  start: number;
  end: number;
}

export interface CreatorShortSemanticSubtitlePayload {
  canvasWidth: number;
  canvasHeight: number;
  anchorX: number;
  anchorY: number;
  fontSize: number;
  maxCharsPerLine: number;
  style: CreatorSubtitleStyleSettings;
  chunks: CreatorShortSemanticSubtitleCue[];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shouldUseCreatorPngSubtitleFallback(style: CreatorSubtitleStyleSettings): boolean {
  const defaultStyle = getDefaultCreatorSubtitleStyle(style.preset);
  const hasBackgroundBox = style.backgroundEnabled && style.backgroundOpacity > 0.01;
  const hasNonDefaultLetterWidth = Math.abs(style.letterWidth - defaultStyle.letterWidth) > 0.01;

  return hasBackgroundBox || hasNonDefaultLetterWidth;
}

export function buildCreatorSemanticSubtitlePayload(input: {
  subtitleChunks: SubtitleChunk[];
  short: CreatorSuggestedShort;
  editor: CreatorShortEditorState;
  timeOffsetSeconds?: number;
}): CreatorShortSemanticSubtitlePayload | null {
  if ((input.editor.showSubtitles ?? true) === false || input.subtitleChunks.length === 0) {
    return null;
  }

  const style = resolveCreatorSubtitleStyle(input.short.editorPreset.subtitleStyle, input.editor.subtitleStyle);
  const fontSize = Math.round(Math.min(96, Math.max(36, 56 * input.editor.subtitleScale)));
  const maxCharsPerLine = getSubtitleMaxCharsPerLine(
    fontSize,
    style.letterWidth,
    CREATOR_EXPORT_SUBTITLE_CANVAS_WIDTH
  );
  const anchorX = Math.round(CREATOR_EXPORT_SUBTITLE_CANVAS_WIDTH * (input.editor.subtitleXPositionPct / 100));
  const anchorY = Math.round(CREATOR_EXPORT_SUBTITLE_CANVAS_HEIGHT * (input.editor.subtitleYOffsetPct / 100));
  const timeOffsetSeconds = Math.max(0, input.timeOffsetSeconds ?? 0);

  const chunks: CreatorShortSemanticSubtitleCue[] = [];

  for (const chunk of input.subtitleChunks) {
    const startAbs = chunk.timestamp?.[0];
    const endAbs = chunk.timestamp?.[1];
    if (startAbs == null || !Number.isFinite(startAbs)) continue;

    const start = Math.max(0, startAbs - input.short.startSeconds) + timeOffsetSeconds;
    const end = endAbs != null && Number.isFinite(endAbs)
      ? Math.min(Math.max(0, endAbs - input.short.startSeconds), input.short.durationSeconds) + timeOffsetSeconds
      : Math.min(start - timeOffsetSeconds + 2.5, input.short.durationSeconds) + timeOffsetSeconds;

    if (end <= start || start > input.short.durationSeconds + timeOffsetSeconds + 0.25) continue;

    const text = String(chunk.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    chunks.push({
      text: style.textCase === "uppercase" ? text.toUpperCase() : text,
      start: Number(clampNumber(start, 0, input.short.durationSeconds + timeOffsetSeconds).toFixed(3)),
      end: Number(clampNumber(end, 0, input.short.durationSeconds + timeOffsetSeconds).toFixed(3)),
    });
  }

  if (chunks.length === 0) {
    return null;
  }

  return {
    canvasWidth: CREATOR_EXPORT_SUBTITLE_CANVAS_WIDTH,
    canvasHeight: CREATOR_EXPORT_SUBTITLE_CANVAS_HEIGHT,
    anchorX,
    anchorY,
    fontSize,
    maxCharsPerLine,
    style,
    chunks,
  };
}
