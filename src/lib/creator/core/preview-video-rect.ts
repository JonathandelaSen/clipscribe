export interface PreviewVideoRectInput {
  viewportWidth: number;
  viewportHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface PreviewVideoRectSize {
  width: number;
  height: number;
}

export function resolveContainedPreviewVideoRect(
  input: PreviewVideoRectInput
): PreviewVideoRectSize | null {
  const viewportWidth = Number(input.viewportWidth);
  const viewportHeight = Number(input.viewportHeight);
  const sourceWidth = Number(input.sourceWidth);
  const sourceHeight = Number(input.sourceHeight);

  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
