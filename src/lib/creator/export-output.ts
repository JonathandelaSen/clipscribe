import type { CreatorSuggestedShort } from "./types";

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}

export function buildCreatorShortExportFilename(
  sourceFilename: string,
  short: Pick<CreatorSuggestedShort, "startSeconds" | "endSeconds">
): string {
  const basename = sourceFilename.replace(/\.[^/.]+$/, "") || "short";
  return sanitizeFilename(
    `${basename}__${Math.floor(short.startSeconds)}-${Math.ceil(short.endSeconds)}.mp4`
  );
}
