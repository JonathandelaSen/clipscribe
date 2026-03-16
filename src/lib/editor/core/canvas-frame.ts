import {
  buildShortExportGeometry,
  type ShortExportGeometryResult,
} from "../../creator/core/export-geometry";
import type { EditorCanvasState } from "../types";

export interface EditorCanvasCoverZoomInput {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export interface EditorCanvasPreviewLayoutInput {
  sourceWidth: number;
  sourceHeight: number;
  canvas: EditorCanvasState;
  viewportWidth: number;
  viewportHeight: number;
}

export function getEditorCanvasCoverZoom(input: EditorCanvasCoverZoomInput): number {
  const safeSourceWidth = Math.max(1, input.sourceWidth);
  const safeSourceHeight = Math.max(1, input.sourceHeight);
  const safeOutputWidth = Math.max(1, input.outputWidth);
  const safeOutputHeight = Math.max(1, input.outputHeight);

  const containScale = Math.min(safeOutputWidth / safeSourceWidth, safeOutputHeight / safeSourceHeight);
  const coverScale = Math.max(safeOutputWidth / safeSourceWidth, safeOutputHeight / safeSourceHeight);

  return Number((coverScale / Math.max(containScale, Number.EPSILON)).toFixed(4));
}

export function buildEditorCanvasPreviewLayout(
  input: EditorCanvasPreviewLayoutInput
): ShortExportGeometryResult {
  const viewportWidth = Math.max(1, Math.round(input.viewportWidth));
  const viewportHeight = Math.max(1, Math.round(input.viewportHeight));

  return buildShortExportGeometry({
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    editor: input.canvas,
    previewViewport: {
      width: viewportWidth,
      height: viewportHeight,
    },
    outputWidth: viewportWidth,
    outputHeight: viewportHeight,
  });
}
