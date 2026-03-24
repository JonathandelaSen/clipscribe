import type { CreatorSuggestedShort, CreatorViralClip } from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";
import { clampClipToMediaDuration, clipSubtitleChunks } from "./clip-windowing";

type ExportClipLike = CreatorSuggestedShort | CreatorViralClip;

export interface ShortExportPreparationInput<TClip extends ExportClipLike = ExportClipLike> {
  requestedClip: TClip;
  allSubtitleChunks: SubtitleChunk[];
  sourceDurationSeconds?: number;
  minClipDurationSeconds?: number;
  clipAdjustmentToleranceSeconds?: number;
}

export interface ShortExportPreparationResult<TClip extends ExportClipLike = ExportClipLike> {
  exportClip: TClip;
  exportSubtitleChunks: SubtitleChunk[];
  clipAdjustedToSource: boolean;
  adjustmentNotice?: string;
  durationValid: boolean;
  minClipDurationSeconds: number;
  validationError?: string;
}

export function prepareShortExport<TClip extends ExportClipLike>(
  input: ShortExportPreparationInput<TClip>
): ShortExportPreparationResult<TClip> {
  const clipAdjustmentToleranceSeconds = Math.max(0, input.clipAdjustmentToleranceSeconds ?? 0.02);
  const minClipDurationSeconds = Math.max(0.01, input.minClipDurationSeconds ?? 0.25);

  const hasSourceDuration = typeof input.sourceDurationSeconds === "number" && Number.isFinite(input.sourceDurationSeconds);
  const exportClip = hasSourceDuration
    ? (clampClipToMediaDuration(input.requestedClip, input.sourceDurationSeconds as number) as TClip)
    : input.requestedClip;
  const clipAdjustedToSource =
    Math.abs(exportClip.startSeconds - input.requestedClip.startSeconds) > clipAdjustmentToleranceSeconds ||
    Math.abs(exportClip.endSeconds - input.requestedClip.endSeconds) > clipAdjustmentToleranceSeconds;
  const exportSubtitleChunks = clipSubtitleChunks(exportClip, input.allSubtitleChunks);

  const rawDuration =
    Number.isFinite(exportClip.durationSeconds) && exportClip.durationSeconds > 0
      ? exportClip.durationSeconds
      : exportClip.endSeconds - exportClip.startSeconds;
  const durationValid = Number.isFinite(rawDuration) && rawDuration >= minClipDurationSeconds;
  const validationError = durationValid
    ? undefined
    : `Selected clip is too short to export. Increase duration to at least ${minClipDurationSeconds.toFixed(2)}s.`;
  const adjustmentNotice = clipAdjustedToSource
    ? `Clip adjusted to media range: ${exportClip.startSeconds.toFixed(2)}s -> ${exportClip.endSeconds.toFixed(2)}s.`
    : undefined;

  return {
    exportClip,
    exportSubtitleChunks,
    clipAdjustedToSource,
    adjustmentNotice,
    durationValid,
    minClipDurationSeconds,
    validationError,
  };
}
