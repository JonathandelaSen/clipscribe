/**
 * subtitle-canvas.ts
 *
 * Renders subtitle chunks to transparent 1080×1920 PNGs using OffscreenCanvas.
 * The rendering mirrors `SubtitlePreviewText` in CreatorHub.tsx exactly:
 *   - optional rounded subtitle background box
 *   - stroke pass (outline)
 *   - shadow
 *   - main fill
 *
 * Because we use the same browser rendering engine as the preview div, the
 * exported video will be pixel-identical to what the user sees.
 */

import { throwIfBrowserRenderCanceled } from "@/lib/browser-render";
import {
  cssRgbaFromHex,
  getSubtitleMaxCharsPerLine,
  resolveCreatorSubtitleStyle,
  wrapSubtitleLines,
} from "@/lib/creator/subtitle-style";
import type {
  CreatorShortEditorState,
  CreatorSubtitleStyleSettings,
  CreatorSuggestedShort,
} from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";

export const SUBTITLE_CANVAS_WIDTH = 1080;
export const SUBTITLE_CANVAS_HEIGHT = 1920;

export interface SubtitlePngFrame {
  /** Raw PNG bytes for the 1080×1920 transparent overlay frame */
  pngBytes: Uint8Array;
  /** Start time in seconds, already offset for the FFmpeg filter graph */
  start: number;
  /** End time in seconds, already offset for the FFmpeg filter graph */
  end: number;
  /** Path into ffmpeg.wasm VFS where the PNG will be written */
  vfsPath: string;
}

// ─── Font loading ───────────────────────────────────────────────────────────

const FONT_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf";

let cachedFontFace: FontFace | null = null;

async function ensureCanvasFont(signal?: AbortSignal): Promise<boolean> {
  if (cachedFontFace) return true;
  try {
    throwIfBrowserRenderCanceled(signal);
    const res = await fetch(FONT_URL, signal ? { signal } : undefined);
    if (!res.ok) return false;
    const fontData = await res.arrayBuffer();
    throwIfBrowserRenderCanceled(signal);
    const face = new FontFace("InterSubtitle", fontData, { weight: "700" });
    await face.load();
    throwIfBrowserRenderCanceled(signal);
    // Register so OffscreenCanvas ctx.font can use it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).fonts?.add(face);
    cachedFontFace = face;
    return true;
  } catch {
    return false;
  }
}

function drawRoundedRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (safeRadius <= 0) {
    ctx.rect(x, y, width, height);
    ctx.closePath();
    return;
  }

  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

// ─── Single‑chunk renderer ──────────────────────────────────────────────────

function renderChunk(
  style: CreatorSubtitleStyleSettings,
  lines: string[],
  anchorX: number,
  anchorY: number,
  fontSize: number
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(SUBTITLE_CANVAS_WIDTH, SUBTITLE_CANVAS_HEIGHT);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, SUBTITLE_CANVAS_WIDTH, SUBTITLE_CANVAS_HEIGHT);

  const lineHeight = Math.round(fontSize * 1.18);
  const fontSpec = `700 ${fontSize}px InterSubtitle, Inter, sans-serif`;
  const letterScale = Math.max(1, Math.min(1.5, style.letterWidth));

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = fontSpec;
  const textBlockHeight = (lines.length - 1) * lineHeight + fontSize;
  const blockTop = -(textBlockHeight / 2);
  const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
  const hasBackground = style.backgroundEnabled && style.backgroundOpacity > 0;

  ctx.save();
  ctx.translate(anchorX, anchorY);
  ctx.scale(letterScale, 1);

  if (hasBackground) {
    const backgroundX = -(maxLineWidth / 2) - style.backgroundPaddingX;
    const backgroundY = blockTop - style.backgroundPaddingY;
    const backgroundWidth = maxLineWidth + style.backgroundPaddingX * 2;
    const backgroundHeight = textBlockHeight + style.backgroundPaddingY * 2;
    ctx.save();
    drawRoundedRect(
      ctx,
      backgroundX,
      backgroundY,
      backgroundWidth,
      backgroundHeight,
      style.backgroundRadius
    );
    ctx.fillStyle = cssRgbaFromHex(style.backgroundColor, style.backgroundOpacity);
    ctx.fill();
    ctx.restore();
  }

  lines.forEach((line, i) => {
    const textY = blockTop + i * lineHeight;

    if (style.shadowOpacity > 0 && style.shadowDistance > 0) {
      ctx.save();
      ctx.shadowColor = cssRgbaFromHex(style.shadowColor, style.shadowOpacity);
      ctx.shadowOffsetX = style.shadowDistance;
      ctx.shadowOffsetY = style.shadowDistance;
      ctx.shadowBlur = 0;
      ctx.fillStyle = cssRgbaFromHex(style.textColor, 1);
      ctx.font = fontSpec;
      ctx.fillText(line, 0, textY);
      ctx.restore();
    }

    if (style.borderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = cssRgbaFromHex(style.borderColor, 0.95);
      ctx.lineWidth = style.borderWidth * 2;
      ctx.lineJoin = "round";
      ctx.font = fontSpec;
      ctx.strokeText(line, 0, textY);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = cssRgbaFromHex(style.textColor, 1);
    ctx.font = fontSpec;
    ctx.fillText(line, 0, textY);
    ctx.restore();
  });

  ctx.restore();

  return canvas;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function renderSubtitlesToPngs(
  subtitleChunks: SubtitleChunk[],
  short: CreatorSuggestedShort,
  editor: CreatorShortEditorState,
  timeOffsetSeconds: number,
  signal?: AbortSignal
): Promise<SubtitlePngFrame[]> {
  if ((editor.showSubtitles ?? true) === false || subtitleChunks.length === 0) {
    return [];
  }

  const fontLoaded = await ensureCanvasFont(signal);
  if (!fontLoaded) {
    console.warn("subtitle-canvas: Inter font failed to load — PNGs will use fallback font");
  }

  const style = resolveCreatorSubtitleStyle(short.editorPreset.subtitleStyle, editor.subtitleStyle);
  const fontSize = Math.round(Math.min(96, Math.max(36, 56 * editor.subtitleScale)));
  const maxCharsPerLine = getSubtitleMaxCharsPerLine(
    fontSize,
    style.letterWidth,
    SUBTITLE_CANVAS_WIDTH
  );

  const anchorX = Math.round(SUBTITLE_CANVAS_WIDTH  * (editor.subtitleXPositionPct / 100));
  const anchorY = Math.round(SUBTITLE_CANVAS_HEIGHT * (editor.subtitleYOffsetPct   / 100));

  const frames: SubtitlePngFrame[] = [];

  for (const chunk of subtitleChunks) {
    throwIfBrowserRenderCanceled(signal);
    const startAbs = chunk.timestamp?.[0];
    const endAbs   = chunk.timestamp?.[1];
    if (startAbs == null) continue;

    const start = Math.max(0, startAbs - short.startSeconds);
    const end   = endAbs != null
      ? Math.min(Math.max(0, endAbs - short.startSeconds), short.durationSeconds)
      : Math.min(start + 2.5, short.durationSeconds);

    if (end <= start || start > short.durationSeconds + 0.25) continue;

    const text = String(chunk.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const transformed = style.textCase === "uppercase" ? text.toUpperCase() : text;
    const lines = wrapSubtitleLines(transformed, maxCharsPerLine);
    if (!lines.length) continue;

    const canvas = renderChunk(style, lines, anchorX, anchorY, fontSize);
    throwIfBrowserRenderCanceled(signal);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    throwIfBrowserRenderCanceled(signal);
    const pngBytes = new Uint8Array(await blob.arrayBuffer());

    const idx = frames.length;
    frames.push({
      pngBytes,
      start: start + timeOffsetSeconds,
      end: end + timeOffsetSeconds,
      vfsPath: `/tmp/sub_${idx}.png`,
    });
  }

  return frames;
}
