import { throwIfBrowserRenderCanceled } from "@/lib/browser-render";
import {
  computeCreatorTextOverlayRasterBounds,
  type CreatorTextOverlayRasterBounds,
} from "@/lib/creator/text-overlay-bounds";
import { cssRgbaFromHex } from "@/lib/creator/subtitle-style";
import {
  getCreatorTextOverlayFontSize,
  getCreatorTextOverlayFallbackPreset,
  resolveCreatorTextOverlayWindow,
  type CreatorTextOverlaySlot,
} from "@/lib/creator/core/text-overlays";
import {
  cssTextShadowFromTextOverlayStyle,
  getCreatorTextOverlayMaxCharsPerLine,
  resolveCreatorTextOverlayStyle,
  wrapCreatorTextOverlayLines,
} from "@/lib/creator/text-overlay-style";
import type { CreatorTextOverlayState } from "@/lib/creator/types";
import type { SubtitlePngFrame } from "@/lib/creator/subtitle-canvas";

export { computeCreatorTextOverlayRasterBounds } from "@/lib/creator/text-overlay-bounds";

const CANVAS_WIDTH = 1080;
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
    const face = new FontFace("InterOverlay", fontData, { weight: "800" });
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

function renderOverlayCanvas(
  text: string[],
  overlay: CreatorTextOverlayState,
  slot: CreatorTextOverlaySlot,
  lineWidths: readonly number[],
  bounds: CreatorTextOverlayRasterBounds
): OffscreenCanvas {
  const style = resolveCreatorTextOverlayStyle(getCreatorTextOverlayFallbackPreset(slot), overlay.style);
  const fontSize = getCreatorTextOverlayFontSize(slot, overlay.scale);
  const canvas = new OffscreenCanvas(bounds.width, bounds.height);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, bounds.width, bounds.height);
  ctx.translate(-bounds.x, -bounds.y);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `800 ${fontSize}px InterOverlay, Inter, sans-serif`;

  const maxLineWidth = lineWidths.reduce((max, lineWidth) => Math.max(max, lineWidth), 0);
  const top = bounds.top;

  if (style.backgroundEnabled && style.backgroundOpacity > 0) {
    drawRoundedRect(
      ctx,
      bounds.anchorX - maxLineWidth / 2 - style.backgroundPaddingX,
      top - style.backgroundPaddingY,
      maxLineWidth + style.backgroundPaddingX * 2,
      bounds.blockHeight + style.backgroundPaddingY * 2,
      style.backgroundRadius
    );
    ctx.fillStyle = cssRgbaFromHex(style.backgroundColor, style.backgroundOpacity);
    ctx.fill();
  }

  const shadowValue = cssTextShadowFromTextOverlayStyle(style);
  const shadowMatch = shadowValue.match(/^([\d.]+)px ([\d.]+)px 0 (.+)$/);

  text.forEach((line, index) => {
    const y = top + index * bounds.lineHeight;

    if (shadowMatch) {
      ctx.save();
      ctx.shadowOffsetX = Number(shadowMatch[1]);
      ctx.shadowOffsetY = Number(shadowMatch[2]);
      ctx.shadowBlur = 0;
      ctx.shadowColor = shadowMatch[3];
      ctx.fillStyle = cssRgbaFromHex(style.textColor, 1);
      ctx.fillText(line, bounds.anchorX, y);
      ctx.restore();
    }

    if (style.borderWidth > 0) {
      ctx.save();
      ctx.strokeStyle = cssRgbaFromHex(style.borderColor, 0.95);
      ctx.lineWidth = style.borderWidth * 2;
      ctx.lineJoin = "round";
      ctx.strokeText(line, bounds.anchorX, y);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = cssRgbaFromHex(style.textColor, 1);
    ctx.fillText(line, bounds.anchorX, y);
    ctx.restore();
  });

  return canvas;
}

export async function renderTextOverlayToPngFrames(input: {
  overlay: CreatorTextOverlayState;
  slot: CreatorTextOverlaySlot;
  clipDurationSeconds: number;
  timeOffsetSeconds: number;
  signal?: AbortSignal;
}): Promise<SubtitlePngFrame[]> {
  const effectiveWindow = resolveCreatorTextOverlayWindow(input.overlay, input.clipDurationSeconds);
  if (!effectiveWindow.enabled) return [];

  const style = resolveCreatorTextOverlayStyle(
    getCreatorTextOverlayFallbackPreset(input.slot),
    input.overlay.style
  );
  const fontSize = getCreatorTextOverlayFontSize(input.slot, input.overlay.scale);
  const maxChars = getCreatorTextOverlayMaxCharsPerLine(fontSize, input.overlay.maxWidthPct, CANVAS_WIDTH);
  const transformedText =
    style.textCase === "uppercase" ? effectiveWindow.text.toUpperCase() : effectiveWindow.text;
  const lines = wrapCreatorTextOverlayLines(transformedText, maxChars);
  if (!lines.length) return [];

  await ensureCanvasFont(input.signal);
  throwIfBrowserRenderCanceled(input.signal);
  const measureCanvas = new OffscreenCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d")!;
  measureCtx.font = `800 ${fontSize}px InterOverlay, Inter, sans-serif`;
  const lineWidths = lines.map((line) => measureCtx.measureText(line).width);
  const bounds = computeCreatorTextOverlayRasterBounds({
    positionXPercent: input.overlay.positionXPercent,
    positionYPercent: input.overlay.positionYPercent,
    fontSize,
    lineWidths,
    style: {
      backgroundEnabled: style.backgroundEnabled,
      backgroundOpacity: style.backgroundOpacity,
      backgroundPaddingX: style.backgroundPaddingX,
      backgroundPaddingY: style.backgroundPaddingY,
      borderWidth: style.borderWidth,
      shadowOpacity: style.shadowOpacity,
      shadowDistance: style.shadowDistance,
    },
  });
  const canvas = renderOverlayCanvas(lines, input.overlay, input.slot, lineWidths, bounds);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  throwIfBrowserRenderCanceled(input.signal);
  const pngBytes = new Uint8Array(await blob.arrayBuffer());

  return [
    {
      pngBytes,
      start: effectiveWindow.startOffsetSeconds + input.timeOffsetSeconds,
      end: effectiveWindow.endOffsetSeconds + input.timeOffsetSeconds,
      vfsPath: `/tmp/${input.slot}_overlay.png`,
      kind: input.slot === "intro" ? "intro_overlay" : "outro_overlay",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  ];
}
