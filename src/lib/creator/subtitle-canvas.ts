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
  CreatorShortRasterOverlayKind,
  CreatorSubtitleStyleSettings,
  CreatorSuggestedShort,
} from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";

export const SUBTITLE_CANVAS_WIDTH = 1080;
export const SUBTITLE_CANVAS_HEIGHT = 1920;

export interface SubtitlePngFrame {
  /** Raw PNG bytes for the transparent overlay frame */
  pngBytes: Uint8Array;
  /** Start time in seconds, already offset for the FFmpeg filter graph */
  start: number;
  /** End time in seconds, already offset for the FFmpeg filter graph */
  end: number;
  /** Path into ffmpeg.wasm VFS where the PNG will be written */
  vfsPath: string;
  /** Overlay kind used by system export diagnostics */
  kind?: CreatorShortRasterOverlayKind;
  /** Full-frame x position used when composing the overlay */
  x?: number;
  /** Full-frame y position used when composing the overlay */
  y?: number;
  /** Raster width of the uploaded PNG */
  width?: number;
  /** Raster height of the uploaded PNG */
  height?: number;
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

/**
 * Prepares the subtitle chunks for rendering: filters to the clip range,
 * computes timing, and returns the text/timing data needed for rendering.
 */
function prepareSubtitleRenderData(
  subtitleChunks: SubtitleChunk[],
  short: CreatorSuggestedShort,
  editor: CreatorShortEditorState,
  timeOffsetSeconds: number
) {
  const style = resolveCreatorSubtitleStyle(short.editorPreset.subtitleStyle, editor.subtitleStyle);
  const fontSize = Math.round(Math.min(96, Math.max(36, 56 * editor.subtitleScale)));
  const maxCharsPerLine = getSubtitleMaxCharsPerLine(
    fontSize,
    style.letterWidth,
    SUBTITLE_CANVAS_WIDTH
  );

  const anchorX = Math.round(SUBTITLE_CANVAS_WIDTH  * (editor.subtitleXPositionPct / 100));
  const anchorY = Math.round(SUBTITLE_CANVAS_HEIGHT * (editor.subtitleYOffsetPct   / 100));

  const entries: Array<{
    lines: string[];
    start: number;
    end: number;
  }> = [];

  for (const chunk of subtitleChunks) {
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

    entries.push({
      lines,
      start: start + timeOffsetSeconds,
      end: end + timeOffsetSeconds,
    });
  }

  return { style, fontSize, anchorX, anchorY, entries };
}

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

  const { style, fontSize, anchorX, anchorY, entries } = prepareSubtitleRenderData(
    subtitleChunks, short, editor, timeOffsetSeconds
  );

  if (entries.length === 0) return [];

  // Render all canvases first (synchronous draws)
  const canvases = entries.map((entry) =>
    renderChunk(style, entry.lines, anchorX, anchorY, fontSize)
  );

  // Parallelize the expensive PNG blob encoding step
  throwIfBrowserRenderCanceled(signal);
  const frames = await Promise.all(
    canvases.map(async (canvas, idx) => {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      return {
        pngBytes,
        start: entries[idx]!.start,
        end: entries[idx]!.end,
        vfsPath: `/tmp/sub_${idx}.png`,
        kind: "subtitle_frame" as const,
        x: 0,
        y: 0,
        width: SUBTITLE_CANVAS_WIDTH,
        height: SUBTITLE_CANVAS_HEIGHT,
      };
    })
  );
  throwIfBrowserRenderCanceled(signal);

  return frames;
}

// ─── Subtitle Atlas API ─────────────────────────────────────────────────────
//
// Groups subtitle frames into vertically-stacked sprite atlas PNGs, where
// each atlas uses a single FFmpeg overlay input with a `crop` expression
// to select the right frame based on time. This reduces N overlays to
// ceil(N/MAX_FRAMES_PER_ATLAS), dramatically reducing FFmpeg filter depth.

/**
 * Maximum subtitle frames packed into one atlas image.
 * Each frame is SUBTITLE_CANVAS_HEIGHT (1920) pixels tall.
 * With 7 frames + 1 blank = 8 × 1920 = 15360px, safely under the
 * OffscreenCanvas height limit of 16384px.
 */
const MAX_FRAMES_PER_ATLAS = 7;

export interface SubtitleAtlasFrame extends SubtitlePngFrame {
  /**
   * FFmpeg crop expression that selects the correct atlas frame based on `t`.
   * Used as the `y` value in `crop=W:H:0:EXPR`.
   */
  cropExpression: string;
}

/**
 * Build an FFmpeg crop `y` expression that selects the correct atlas row
 * based on the current time `t`. Frame 0 (y=0) is always blank/transparent.
 * Frames 1..N contain the actual subtitle content.
 *
 * The expression uses additive `between()` calls which is safe because
 * subtitles never overlap in time (at most one is active at any moment).
 *
 * Example for 3 subtitles: `between(t,0.5,1.0)*1920+between(t,1.2,1.7)*3840+between(t,2.0,2.5)*5760`
 * When no subtitle is active, all terms are 0, selecting the blank frame at y=0.
 */
function buildAtlasCropExpression(
  entries: ReadonlyArray<{ start: number; end: number }>,
  frameHeight: number
): string {
  if (entries.length === 0) return "0";

  const terms = entries.map((entry, i) => {
    const yOffset = (i + 1) * frameHeight; // +1 because frame 0 is blank
    return `between(t,${entry.start.toFixed(3)},${entry.end.toFixed(3)})*${yOffset}`;
  });

  return terms.join("+");
}

/**
 * Renders all subtitle chunks into sprite atlas PNGs (max 7 subtitles
 * per atlas). Each atlas uses a single overlay with a `crop` expression
 * to select the correct frame based on time.
 *
 * For 50 subtitles → ceil(50/7) = 8 atlases → 8 FFmpeg overlay inputs
 * instead of 50. A ~6× reduction in filter chain depth.
 */
export async function renderSubtitleAtlases(
  subtitleChunks: SubtitleChunk[],
  short: CreatorSuggestedShort,
  editor: CreatorShortEditorState,
  timeOffsetSeconds: number,
  signal?: AbortSignal
): Promise<SubtitleAtlasFrame[]> {
  if ((editor.showSubtitles ?? true) === false || subtitleChunks.length === 0) {
    return [];
  }

  const fontLoaded = await ensureCanvasFont(signal);
  if (!fontLoaded) {
    console.warn("subtitle-canvas: Inter font failed to load — PNGs will use fallback font");
  }

  const { style, fontSize, anchorX, anchorY, entries } = prepareSubtitleRenderData(
    subtitleChunks, short, editor, timeOffsetSeconds
  );

  if (entries.length === 0) return [];

  // Render all individual subtitle canvases (cheap synchronous draws)
  const canvases = entries.map((entry) =>
    renderChunk(style, entry.lines, anchorX, anchorY, fontSize)
  );
  throwIfBrowserRenderCanceled(signal);

  // Group into batches of MAX_FRAMES_PER_ATLAS
  const atlasCount = Math.ceil(entries.length / MAX_FRAMES_PER_ATLAS);
  const atlasFrames: SubtitleAtlasFrame[] = [];

  for (let atlasIdx = 0; atlasIdx < atlasCount; atlasIdx++) {
    throwIfBrowserRenderCanceled(signal);
    const batchStart = atlasIdx * MAX_FRAMES_PER_ATLAS;
    const batchEnd = Math.min(batchStart + MAX_FRAMES_PER_ATLAS, entries.length);
    const batchEntries = entries.slice(batchStart, batchEnd);
    const batchCanvases = canvases.slice(batchStart, batchEnd);

    // Build atlas: blank frame at row 0, then each subtitle frame
    const atlasFrameCount = batchCanvases.length + 1; // +1 for blank frame
    const atlasHeight = atlasFrameCount * SUBTITLE_CANVAS_HEIGHT;

    const atlasCanvas = new OffscreenCanvas(SUBTITLE_CANVAS_WIDTH, atlasHeight);
    const atlasCtx = atlasCanvas.getContext("2d")!;
    atlasCtx.clearRect(0, 0, SUBTITLE_CANVAS_WIDTH, atlasHeight);

    // Row 0 is already blank (transparent) from clearRect
    // Copy each subtitle canvas into its row
    for (let i = 0; i < batchCanvases.length; i++) {
      const yOffset = (i + 1) * SUBTITLE_CANVAS_HEIGHT;
      atlasCtx.drawImage(batchCanvases[i]!, 0, yOffset);
    }

    const cropExpression = buildAtlasCropExpression(batchEntries, SUBTITLE_CANVAS_HEIGHT);

    const blob = await atlasCanvas.convertToBlob({ type: "image/png" });
    throwIfBrowserRenderCanceled(signal);
    const pngBytes = new Uint8Array(await blob.arrayBuffer());

    const earliestStart = Math.min(...batchEntries.map((e) => e.start));
    const latestEnd = Math.max(...batchEntries.map((e) => e.end));

    atlasFrames.push({
      pngBytes,
      start: earliestStart,
      end: latestEnd,
      vfsPath: `/tmp/sub_atlas_${atlasIdx}.png`,
      cropExpression,
      kind: "subtitle_atlas",
      x: 0,
      y: 0,
      width: SUBTITLE_CANVAS_WIDTH,
      height: atlasHeight,
    });
  }

  return atlasFrames;
}
