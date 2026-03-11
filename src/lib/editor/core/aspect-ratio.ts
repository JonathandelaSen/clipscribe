import type { EditorAspectRatio, EditorResolution } from "@/lib/editor/types";

export interface EditorOutputDimensions {
  width: number;
  height: number;
}

export const EDITOR_ASPECT_RATIO_LABELS: Record<EditorAspectRatio, string> = {
  "16:9": "Widescreen",
  "9:16": "Vertical",
  "1:1": "Square",
  "4:5": "Portrait 4:5",
};

export const EDITOR_RESOLUTION_LABELS: Record<EditorResolution, string> = {
  "720p": "HD 720p",
  "1080p": "Full HD",
  "4K": "4K Experimental",
};

const DIMENSION_MATRIX: Record<EditorResolution, Record<EditorAspectRatio, EditorOutputDimensions>> = {
  "720p": {
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "1:1": { width: 720, height: 720 },
    "4:5": { width: 720, height: 900 },
  },
  "1080p": {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
    "4:5": { width: 1080, height: 1350 },
  },
  "4K": {
    "16:9": { width: 3840, height: 2160 },
    "9:16": { width: 2160, height: 3840 },
    "1:1": { width: 2160, height: 2160 },
    "4:5": { width: 2160, height: 2700 },
  },
};

export function getEditorOutputDimensions(
  aspectRatio: EditorAspectRatio,
  resolution: EditorResolution
): EditorOutputDimensions {
  return DIMENSION_MATRIX[resolution][aspectRatio];
}

export function getAspectRatioNumber(aspectRatio: EditorAspectRatio): number {
  if (aspectRatio === "16:9") return 16 / 9;
  if (aspectRatio === "9:16") return 9 / 16;
  if (aspectRatio === "1:1") return 1;
  return 4 / 5;
}
