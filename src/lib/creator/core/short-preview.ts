import type { CreatorViralClip } from "@/lib/creator/types";

const VIDEO_SOURCE_FILENAME_PATTERN = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isLikelyVideoSourceFilename(filename?: string | null): boolean {
  return VIDEO_SOURCE_FILENAME_PATTERN.test(String(filename ?? "").trim());
}

export function getShortPreviewSeekTime(progressPct: number, clip: Pick<CreatorViralClip, "startSeconds" | "durationSeconds">): number {
  const boundedProgress = clamp(progressPct, 0, 100) / 100;
  return clip.startSeconds + clip.durationSeconds * boundedProgress;
}

export function getShortPreviewProgressPct(
  currentTime: number,
  clip: Pick<CreatorViralClip, "startSeconds" | "endSeconds" | "durationSeconds">
): number {
  if (!Number.isFinite(currentTime) || clip.durationSeconds <= 0) return 0;
  const elapsed = clamp(currentTime, clip.startSeconds, clip.endSeconds) - clip.startSeconds;
  return clamp((elapsed / clip.durationSeconds) * 100, 0, 100);
}

export function resolveShortPreviewBoundary(
  currentTime: number,
  clip: Pick<CreatorViralClip, "startSeconds" | "endSeconds">
): { shouldStop: boolean; nextTimeSeconds: number } {
  if (!Number.isFinite(currentTime) || currentTime >= clip.endSeconds) {
    return {
      shouldStop: true,
      nextTimeSeconds: clip.startSeconds,
    };
  }

  return {
    shouldStop: false,
    nextTimeSeconds: clamp(currentTime, clip.startSeconds, clip.endSeconds),
  };
}

export function getNextActiveShortPreviewId(currentActiveId: string, requestedId: string): string {
  return currentActiveId === requestedId ? "" : requestedId;
}
