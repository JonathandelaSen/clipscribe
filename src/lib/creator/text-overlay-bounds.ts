const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const OVERLAY_ANTIALIAS_MARGIN = 6;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export interface CreatorTextOverlayRasterBoundsStyleInput {
  backgroundEnabled: boolean;
  backgroundOpacity: number;
  backgroundPaddingX: number;
  backgroundPaddingY: number;
  borderWidth: number;
  shadowOpacity: number;
  shadowDistance: number;
}

export interface CreatorTextOverlayRasterBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  maxLineWidth: number;
  top: number;
  blockHeight: number;
  lineHeight: number;
}

export function computeCreatorTextOverlayRasterBounds(input: {
  positionXPercent: number;
  positionYPercent: number;
  fontSize: number;
  lineWidths: readonly number[];
  style: CreatorTextOverlayRasterBoundsStyleInput;
  canvasWidth?: number;
  canvasHeight?: number;
}): CreatorTextOverlayRasterBounds {
  const canvasWidth = input.canvasWidth ?? CANVAS_WIDTH;
  const canvasHeight = input.canvasHeight ?? CANVAS_HEIGHT;
  const lineHeight = Math.round(input.fontSize * 1.02);
  const lineCount = Math.max(1, input.lineWidths.length);
  const maxLineWidth = input.lineWidths.reduce((max, lineWidth) => Math.max(max, lineWidth), 0);
  const blockHeight = lineCount * lineHeight;
  const anchorX = Math.round(canvasWidth * (input.positionXPercent / 100));
  const anchorY = Math.round(canvasHeight * (input.positionYPercent / 100));
  const top = anchorY - blockHeight / 2;

  const textLeft = anchorX - maxLineWidth / 2;
  const textTop = top;
  const textRight = anchorX + maxLineWidth / 2;
  const textBottom = top + blockHeight;

  const backgroundLeft =
    input.style.backgroundEnabled && input.style.backgroundOpacity > 0
      ? textLeft - input.style.backgroundPaddingX
      : textLeft;
  const backgroundTop =
    input.style.backgroundEnabled && input.style.backgroundOpacity > 0
      ? textTop - input.style.backgroundPaddingY
      : textTop;
  const backgroundRight =
    input.style.backgroundEnabled && input.style.backgroundOpacity > 0
      ? textRight + input.style.backgroundPaddingX
      : textRight;
  const backgroundBottom =
    input.style.backgroundEnabled && input.style.backgroundOpacity > 0
      ? textBottom + input.style.backgroundPaddingY
      : textBottom;

  const strokeExtent = input.style.borderWidth > 0 ? input.style.borderWidth * 2 : 0;
  const shadowExtent =
    input.style.shadowOpacity > 0 && input.style.shadowDistance > 0 ? input.style.shadowDistance : 0;

  const left = Math.floor(
    clampNumber(backgroundLeft - strokeExtent - OVERLAY_ANTIALIAS_MARGIN, 0, canvasWidth)
  );
  const topBound = Math.floor(
    clampNumber(backgroundTop - strokeExtent - OVERLAY_ANTIALIAS_MARGIN, 0, canvasHeight)
  );
  const right = Math.ceil(
    clampNumber(backgroundRight + strokeExtent + shadowExtent + OVERLAY_ANTIALIAS_MARGIN, 0, canvasWidth)
  );
  const bottom = Math.ceil(
    clampNumber(backgroundBottom + strokeExtent + shadowExtent + OVERLAY_ANTIALIAS_MARGIN, 0, canvasHeight)
  );

  return {
    x: left,
    y: topBound,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - topBound),
    anchorX,
    anchorY,
    maxLineWidth,
    top,
    blockHeight,
    lineHeight,
  };
}
