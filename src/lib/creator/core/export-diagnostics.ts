import type { CreatorShortPlan, CreatorViralClip } from "@/lib/creator/types";

export type ShortExportDiagnosticsContext = {
  sourceFilename: string;

  requestedClip: CreatorViralClip;
  exportClip: CreatorViralClip;
  sourceMeta?: { width: number; height: number; durationSeconds?: number } | null;
  selectedSubtitleChunkCount: number;
  exportSubtitleChunkCount: number;
  stylePreset: string;
  errorMessage?: string;
};

export function buildShortExportDiagnostics(context: ShortExportDiagnosticsContext): string {
  const sourceDuration =
    typeof context.sourceMeta?.durationSeconds === "number" && Number.isFinite(context.sourceMeta.durationSeconds)
      ? context.sourceMeta.durationSeconds.toFixed(3)
      : "unknown";

  return [
    `source=${context.sourceFilename}`,

    `sourceSize=${context.sourceMeta?.width ?? "?"}x${context.sourceMeta?.height ?? "?"}`,
    `sourceDurationSec=${sourceDuration}`,
    `requestedClip=${context.requestedClip.startSeconds.toFixed(3)}-${context.requestedClip.endSeconds.toFixed(3)} (${context.requestedClip.durationSeconds.toFixed(3)}s)`,
    `exportClip=${context.exportClip.startSeconds.toFixed(3)}-${context.exportClip.endSeconds.toFixed(3)} (${context.exportClip.durationSeconds.toFixed(3)}s)`,
    `selectedSubtitleChunks=${context.selectedSubtitleChunkCount}`,
    `exportSubtitleChunks=${context.exportSubtitleChunkCount}`,
    `subtitleStylePreset=${context.stylePreset}`,
    context.errorMessage ? `error=${context.errorMessage}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
