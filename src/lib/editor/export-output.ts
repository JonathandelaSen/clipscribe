import type { EditorAspectRatio, EditorResolution } from "./types";

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}

export function buildEditorExportFilename(
  projectName: string,
  aspectRatio: EditorAspectRatio,
  resolution: EditorResolution
): string {
  return sanitizeFilename(
    `${projectName.replace(/\.[^/.]+$/, "")}__${aspectRatio.replace(":", "x")}__${resolution}.mp4`
  );
}
