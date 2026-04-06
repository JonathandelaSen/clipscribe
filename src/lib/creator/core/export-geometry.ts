import {
  resolveShortFrameLayout,
  type ShortFrameLayoutMode,
  type ShortFrameLayoutResult,
} from "./short-frame-layout";

export interface PreviewViewportSize {
  width: number;
  height: number;
}

export interface ExportGeometryEditorLike {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ShortExportGeometryInput {
  sourceWidth: number;
  sourceHeight: number;
  editor: ExportGeometryEditorLike;
  previewViewport?: PreviewViewportSize | null;
  outputWidth?: number;
  outputHeight?: number;
}

export interface CanonicalShortExportGeometryInput {
  sourceWidth: number;
  sourceHeight: number;
  editor: ExportGeometryEditorLike;
  outputWidth?: number;
  outputHeight?: number;
}

export interface ShortExportGeometryResult {
  filter: string;
  cropX: number;
  cropY: number;
  scaledWidth: number;
  scaledHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  padX: number;
  padY: number;
  outputWidth: number;
  outputHeight: number;
  usedPreviewVideoRect: boolean;
  layoutMode?: ShortFrameLayoutMode;
}

function roundUpToEven(value: number): number {
  const rounded = Math.max(1, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function roundDownToEven(value: number): number {
  const rounded = Math.max(0, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildShortExportGeometry(input: ShortExportGeometryInput): ShortExportGeometryResult {
  const outputWidth = Math.max(1, Math.round(input.outputWidth ?? 1080));
  const outputHeight = Math.max(1, Math.round(input.outputHeight ?? 1920));

  const safeSourceWidth = Math.max(1, input.sourceWidth);
  const safeSourceHeight = Math.max(1, input.sourceHeight);
  const baseScale = Math.min(outputWidth / safeSourceWidth, outputHeight / safeSourceHeight);
  const scaleFactor = baseScale * Math.max(0.2, input.editor.zoom || 1);

  const scaledWidth = Math.max(1, Math.round(safeSourceWidth * scaleFactor));
  const scaledHeight = Math.max(1, Math.round(safeSourceHeight * scaleFactor));

  const viewportWidth = Math.max(1, input.previewViewport?.width ?? outputWidth);
  const viewportHeight = Math.max(1, input.previewViewport?.height ?? outputHeight);
  const panXOut = (input.editor.panX / viewportWidth) * outputWidth;
  const panYOut = (input.editor.panY / viewportHeight) * outputHeight;

  const canvasWidth = Math.max(outputWidth, scaledWidth);
  const canvasHeight = Math.max(outputHeight, scaledHeight);

  const padX = Math.round(
    clamp(
      (canvasWidth - scaledWidth) / 2 + (scaledWidth < outputWidth ? panXOut : 0),
      0,
      Math.max(0, canvasWidth - scaledWidth)
    )
  );
  const padY = Math.round(
    clamp(
      (canvasHeight - scaledHeight) / 2 + (scaledHeight < outputHeight ? panYOut : 0),
      0,
      Math.max(0, canvasHeight - scaledHeight)
    )
  );

  const centerCropX = (canvasWidth - outputWidth) / 2;
  const centerCropY = (canvasHeight - outputHeight) / 2;
  const cropX = Math.round(
    clamp(
      centerCropX - (scaledWidth >= outputWidth ? panXOut : 0),
      0,
      Math.max(0, canvasWidth - outputWidth)
    )
  );
  const cropY = Math.round(
    clamp(
      centerCropY - (scaledHeight >= outputHeight ? panYOut : 0),
      0,
      Math.max(0, canvasHeight - outputHeight)
    )
  );

  const filters = [`scale=${scaledWidth}:${scaledHeight}`];
  if (canvasWidth !== scaledWidth || canvasHeight !== scaledHeight) {
    filters.push(`pad=${canvasWidth}:${canvasHeight}:${padX}:${padY}:black`);
  }
  filters.push(`crop=${outputWidth}:${outputHeight}:${cropX}:${cropY}`);
  filters.push("format=yuv420p");

  return {
    filter: filters.join(","),
    cropX,
    cropY,
    scaledWidth,
    scaledHeight,
    canvasWidth,
    canvasHeight,
    padX,
    padY,
    outputWidth,
    outputHeight,
    usedPreviewVideoRect: false,
  };
}

export function buildShortExportGeometryFromLayout(
  layout: ShortFrameLayoutResult
): ShortExportGeometryResult {
  const scaledWidth = roundUpToEven(layout.mediaWidth);
  const scaledHeight = roundUpToEven(layout.mediaHeight);
  const cropWidth = roundUpToEven(layout.cropWidth);
  const cropHeight = roundUpToEven(layout.cropHeight);
  const canvasWidth = Math.max(cropWidth, roundUpToEven(layout.canvasWidth));
  const canvasHeight = Math.max(cropHeight, roundUpToEven(layout.canvasHeight));
  const cropX = roundDownToEven(Math.min(layout.cropX, Math.max(0, canvasWidth - cropWidth)));
  const cropY = roundDownToEven(Math.min(layout.cropY, Math.max(0, canvasHeight - cropHeight)));
  const padX = roundDownToEven(Math.min(layout.padX, Math.max(0, canvasWidth - scaledWidth)));
  const padY = roundDownToEven(Math.min(layout.padY, Math.max(0, canvasHeight - scaledHeight)));

  const filters = [`scale=${scaledWidth}:${scaledHeight}`];
  if (canvasWidth !== scaledWidth || canvasHeight !== scaledHeight) {
    filters.push(`pad=${canvasWidth}:${canvasHeight}:${padX}:${padY}:black`);
  }
  filters.push(`crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`);
  filters.push("format=yuv420p");

  return {
    filter: filters.join(","),
    cropX,
    cropY,
    scaledWidth,
    scaledHeight,
    canvasWidth,
    canvasHeight,
    padX,
    padY,
    outputWidth: cropWidth,
    outputHeight: cropHeight,
    usedPreviewVideoRect: false,
    layoutMode: layout.mode,
  };
}

export function buildCanonicalShortExportGeometry(
  input: CanonicalShortExportGeometryInput
): ShortExportGeometryResult {
  const layout = resolveShortFrameLayout({
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    frameWidth: input.outputWidth ?? 1080,
    frameHeight: input.outputHeight ?? 1920,
    zoom: input.editor.zoom,
    panX: input.editor.panX,
    panY: input.editor.panY,
  });

  return buildShortExportGeometryFromLayout(layout);
}
