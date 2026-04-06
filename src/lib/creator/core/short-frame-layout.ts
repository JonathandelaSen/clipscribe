export type ShortFrameLayoutMode = "cover_crop" | "zoom_out_pad";

export interface ShortFrameLayoutInput {
  sourceWidth: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface ShortFrameLayoutResult {
  mode: ShortFrameLayoutMode;
  frameWidth: number;
  frameHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  offsetX: number;
  offsetY: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  padX: number;
  padY: number;
  canvasWidth: number;
  canvasHeight: number;
  objectPositionXPercent: number;
  objectPositionYPercent: number;
  previewScaleFactor: number;
}

export interface ScaledShortFramePanInput {
  panX: number;
  panY: number;
  viewportWidth: number;
  viewportHeight: number;
  referenceWidth?: number;
  referenceHeight?: number;
}

export interface ShortPreviewStyle {
  width: string;
  height: string;
  objectPosition: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function resolveAxisPlacement(input: {
  media: number;
  frame: number;
  pan: number;
}): {
  offset: number;
  crop: number;
  pad: number;
  canvas: number;
} {
  if (input.media >= input.frame) {
    const overflow = input.media - input.frame;
    const offset = clamp(-overflow / 2 + input.pan, -overflow, 0);
    return {
      offset: round(offset),
      crop: round(-offset),
      pad: 0,
      canvas: round(input.media),
    };
  }

  const slack = input.frame - input.media;
  const offset = clamp(slack / 2 + input.pan, 0, slack);
  return {
    offset: round(offset),
    crop: 0,
    pad: round(offset),
    canvas: round(input.frame),
  };
}

function resolveObjectPositionPercent(input: {
  media: number;
  frame: number;
  pan: number;
}): number {
  const overflow = Math.max(0, input.media - input.frame);
  if (overflow <= 0) return 50;
  const offset = clamp(-overflow / 2 + input.pan, -overflow, 0);
  return Number(((-offset / overflow) * 100).toFixed(4));
}

export function scaleShortFramePanToViewport(
  input: ScaledShortFramePanInput
): { panX: number; panY: number } {
  const referenceWidth = Math.max(1, round(input.referenceWidth ?? 1080));
  const referenceHeight = Math.max(1, round(input.referenceHeight ?? 1920));
  const viewportWidth = Math.max(1, Number(input.viewportWidth) || referenceWidth);
  const viewportHeight = Math.max(1, Number(input.viewportHeight) || referenceHeight);

  return {
    panX: (input.panX * viewportWidth) / referenceWidth,
    panY: (input.panY * viewportHeight) / referenceHeight,
  };
}

export function resolveShortFrameLayout(input: ShortFrameLayoutInput): ShortFrameLayoutResult {
  const sourceWidth = Math.max(1, round(input.sourceWidth));
  const sourceHeight = Math.max(1, round(input.sourceHeight));
  const frameWidth = Math.max(1, round(input.frameWidth));
  const frameHeight = Math.max(1, round(input.frameHeight));
  const zoom = Math.max(0.2, Number.isFinite(input.zoom) ? input.zoom : 1);
  const panX = Number.isFinite(input.panX) ? input.panX : 0;
  const panY = Number.isFinite(input.panY) ? input.panY : 0;

  const coverScale = Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const mediaWidth = Math.max(1, round(sourceWidth * coverScale * zoom));
  const mediaHeight = Math.max(1, round(sourceHeight * coverScale * zoom));

  const xAxis = resolveAxisPlacement({
    media: mediaWidth,
    frame: frameWidth,
    pan: panX,
  });
  const yAxis = resolveAxisPlacement({
    media: mediaHeight,
    frame: frameHeight,
    pan: panY,
  });

  const previewScaleFactor = Math.max(1, zoom);
  const previewMediaWidth = Math.max(1, sourceWidth * coverScale * previewScaleFactor);
  const previewMediaHeight = Math.max(1, sourceHeight * coverScale * previewScaleFactor);

  return {
    mode:
      xAxis.canvas !== mediaWidth || yAxis.canvas !== mediaHeight
        ? "zoom_out_pad"
        : "cover_crop",
    frameWidth,
    frameHeight,
    mediaWidth,
    mediaHeight,
    offsetX: xAxis.offset,
    offsetY: yAxis.offset,
    cropX: xAxis.crop,
    cropY: yAxis.crop,
    cropWidth: frameWidth,
    cropHeight: frameHeight,
    padX: xAxis.pad,
    padY: yAxis.pad,
    canvasWidth: xAxis.canvas,
    canvasHeight: yAxis.canvas,
    objectPositionXPercent: resolveObjectPositionPercent({
      media: previewMediaWidth,
      frame: frameWidth,
      pan: panX,
    }),
    objectPositionYPercent: resolveObjectPositionPercent({
      media: previewMediaHeight,
      frame: frameHeight,
      pan: panY,
    }),
    previewScaleFactor: Number(previewScaleFactor.toFixed(4)),
  };
}

export function buildShortPreviewStyle(layout: ShortFrameLayoutResult): ShortPreviewStyle {
  const sizePct = Number((layout.previewScaleFactor * 100).toFixed(4));
  return {
    width: `${sizePct}%`,
    height: `${sizePct}%`,
    objectPosition: `${layout.objectPositionXPercent}% ${layout.objectPositionYPercent}%`,
  };
}
