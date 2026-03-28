import { throwIfBrowserRenderCanceled } from "@/lib/browser-render";
import {
  cssRgbaFromHex,
  getSubtitleMaxCharsPerLine,
  resolveCreatorSubtitleStyle,
  wrapSubtitleLines,
} from "@/lib/creator/subtitle-style";
import type { CreatorSubtitleStyleSettings } from "@/lib/creator/types";
import type { EditorProjectRecord } from "@/lib/editor/types";
import type { TimelineCaptionChunk } from "@/lib/editor/core/captions";

export interface EditorSubtitlePngFrame {
  pngBytes: Uint8Array;
  start: number;
  end: number;
  vfsPath: string;
}

export interface EditorSubtitleTextLayout {
  style: CreatorSubtitleStyleSettings;
  fontSize: number;
  lineHeight: number;
  anchorX: number;
  anchorY: number;
  lines: string[];
  maxCharsPerLine: number;
}

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

export function resolveEditorSubtitleTextLayout(input: {
  width: number;
  height: number;
  text: string;
  project: EditorProjectRecord;
}): EditorSubtitleTextLayout {
  const style = resolveCreatorSubtitleStyle(input.project.subtitles.preset, input.project.subtitles.style);
  const fontSize = Math.round(Math.min(96, Math.max(34, 56 * input.project.subtitles.scale)));
  const lineHeight = Math.round(fontSize * 1.18);
  const anchorX = Math.round(input.width * (input.project.subtitles.positionXPercent / 100));
  const anchorY = Math.round(input.height * (input.project.subtitles.positionYPercent / 100));
  const maxCharsPerLine = getSubtitleMaxCharsPerLine(fontSize, style.letterWidth, input.width);
  const lines = wrapSubtitleLines(
    style.textCase === "uppercase" ? input.text.toUpperCase() : input.text,
    maxCharsPerLine
  );

  return {
    style,
    fontSize,
    lineHeight,
    anchorX,
    anchorY,
    lines,
    maxCharsPerLine,
  };
}

function renderChunkToCanvas(input: {
  width: number;
  height: number;
  text: string;
  project: EditorProjectRecord;
}) {
  const canvas = new OffscreenCanvas(input.width, input.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to initialize subtitle canvas context.");
  }

  const { style, fontSize, lineHeight, anchorX, anchorY, lines } = resolveEditorSubtitleTextLayout(input);
  const fontSpec = `700 ${fontSize}px InterSubtitle, Inter, sans-serif`;

  ctx.clearRect(0, 0, input.width, input.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = fontSpec;

  const textBlockHeight = (lines.length - 1) * lineHeight + fontSize;
  const blockTop = -textBlockHeight;
  const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
  const hasBackground = style.backgroundEnabled && style.backgroundOpacity > 0;

  ctx.save();
  ctx.translate(anchorX, anchorY);
  ctx.scale(style.letterWidth, 1);

  if (hasBackground) {
    const backgroundX = -(maxLineWidth / 2) - style.backgroundPaddingX;
    const backgroundY = blockTop - style.backgroundPaddingY;
    const backgroundWidth = maxLineWidth + style.backgroundPaddingX * 2;
    const backgroundHeight = textBlockHeight + style.backgroundPaddingY * 2;
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
  }

  lines.forEach((line, index) => {
    const textY = blockTop + index * lineHeight;

    if (style.shadowOpacity > 0 && style.shadowDistance > 0) {
      ctx.save();
      ctx.shadowColor = cssRgbaFromHex(style.shadowColor, style.shadowOpacity);
      ctx.shadowOffsetX = style.shadowDistance;
      ctx.shadowOffsetY = style.shadowDistance;
      ctx.fillStyle = style.textColor;
      ctx.fillText(line, 0, textY);
      ctx.restore();
    }

    if (style.borderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = cssRgbaFromHex(style.borderColor, 0.95);
      ctx.lineWidth = style.borderWidth * 2;
      ctx.lineJoin = "round";
      ctx.strokeText(line, 0, textY);
      ctx.restore();
    }

    ctx.fillStyle = style.textColor;
    ctx.fillText(line, 0, textY);
  });

  ctx.restore();
  return canvas;
}

export async function renderTimelineSubtitlesToPngs(input: {
  chunks: TimelineCaptionChunk[];
  project: EditorProjectRecord;
  width: number;
  height: number;
  signal?: AbortSignal;
}): Promise<EditorSubtitlePngFrame[]> {
  if (!input.project.subtitles.enabled || input.chunks.length === 0) return [];

  await ensureCanvasFont(input.signal);
  const frames: EditorSubtitlePngFrame[] = [];

  for (const chunk of input.chunks) {
    throwIfBrowserRenderCanceled(input.signal);
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1];
    const text = String(chunk.text ?? "").trim();
    if (typeof start !== "number" || !Number.isFinite(start) || !text) continue;
    const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : start + 2.5;
    if (safeEnd <= start) continue;

    const canvas = renderChunkToCanvas({
      width: input.width,
      height: input.height,
      text,
      project: input.project,
    });
    throwIfBrowserRenderCanceled(input.signal);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    throwIfBrowserRenderCanceled(input.signal);
    const pngBytes = new Uint8Array(await blob.arrayBuffer());
    frames.push({
      pngBytes,
      start,
      end: safeEnd,
      vfsPath: `/tmp/editor_sub_${frames.length}.png`,
    });
  }

  return frames;
}
