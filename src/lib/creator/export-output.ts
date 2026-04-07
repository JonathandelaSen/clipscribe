import type { CreatorSuggestedShort } from "./types";

function sanitizeFilename(value: string): string {
  return value
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildCreatorShortExportFilename(
  sourceFilename: string,
  short: Pick<CreatorSuggestedShort, "startSeconds" | "endSeconds">,
  shortName?: string | null
): string {
  const preferredBasename = sanitizeFilename(shortName || "");
  if (preferredBasename) {
    return `${preferredBasename}.mp4`;
  }

  const basename = sanitizeFilename(sourceFilename) || "short";
  return `${sanitizeFilename(`${basename}__${Math.floor(short.startSeconds)}-${Math.ceil(short.endSeconds)}`)}.mp4`;
}
