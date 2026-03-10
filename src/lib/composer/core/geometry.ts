import type { ComposerFitMode } from "../types";

export interface ComposerItemGeometry {
  fitMode: ComposerFitMode;
  outputWidth: number;
  outputHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  cropX: number;
  cropY: number;
  padX: number;
  padY: number;
  filter: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundInt(value: number): number {
  return Math.max(1, Math.round(value));
}

function resolveOffsetPosition(slack: number, offset: number): number {
  if (slack <= 0) return 0;
  const normalized = clamp(offset, -100, 100) / 100;
  return Math.round((slack / 2) * (normalized + 1));
}

export function buildComposerItemGeometry(input: {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  fitMode?: ComposerFitMode;
  offsetX?: number;
  offsetY?: number;
}): ComposerItemGeometry {
  const fitMode = input.fitMode ?? "fill";
  const safeSourceWidth = Math.max(1, input.sourceWidth);
  const safeSourceHeight = Math.max(1, input.sourceHeight);
  const outputWidth = Math.max(1, input.outputWidth);
  const outputHeight = Math.max(1, input.outputHeight);
  const offsetX = input.offsetX ?? 0;
  const offsetY = input.offsetY ?? 0;

  const scale =
    fitMode === "fit"
      ? Math.min(outputWidth / safeSourceWidth, outputHeight / safeSourceHeight)
      : Math.max(outputWidth / safeSourceWidth, outputHeight / safeSourceHeight);

  const scaledWidth = roundInt(safeSourceWidth * scale);
  const scaledHeight = roundInt(safeSourceHeight * scale);

  if (fitMode === "fit") {
    const padX = resolveOffsetPosition(Math.max(0, outputWidth - scaledWidth), offsetX);
    const padY = resolveOffsetPosition(Math.max(0, outputHeight - scaledHeight), offsetY);
    return {
      fitMode,
      outputWidth,
      outputHeight,
      scaledWidth,
      scaledHeight,
      cropX: 0,
      cropY: 0,
      padX,
      padY,
      filter: `scale=${scaledWidth}:${scaledHeight},pad=${outputWidth}:${outputHeight}:${padX}:${padY}:black,setsar=1`,
    };
  }

  const cropX = resolveOffsetPosition(Math.max(0, scaledWidth - outputWidth), offsetX);
  const cropY = resolveOffsetPosition(Math.max(0, scaledHeight - outputHeight), offsetY);
  return {
    fitMode,
    outputWidth,
    outputHeight,
    scaledWidth,
    scaledHeight,
    cropX,
    cropY,
    padX: 0,
    padY: 0,
    filter: `scale=${scaledWidth}:${scaledHeight},crop=${outputWidth}:${outputHeight}:${cropX}:${cropY},setsar=1`,
  };
}
