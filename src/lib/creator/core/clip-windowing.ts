import type { CreatorSuggestedShort, CreatorViralClip } from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";

type ClipWindowLike = CreatorSuggestedShort | CreatorViralClip;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clipSubtitleChunks(clip: ClipWindowLike, chunks: SubtitleChunk[]): SubtitleChunk[] {
  return chunks.filter((chunk) => {
    const start = chunk.timestamp?.[0] ?? 0;
    const end = chunk.timestamp?.[1] ?? start;
    return start < clip.endSeconds && end > clip.startSeconds;
  });
}

export function findSubtitleChunkAtTime(chunks: SubtitleChunk[], timeSeconds: number): SubtitleChunk | undefined {
  if (!Number.isFinite(timeSeconds)) return undefined;

  return chunks.find((chunk) => {
    const start = chunk.timestamp?.[0];
    if (typeof start !== "number" || !Number.isFinite(start)) return false;

    const rawEnd = chunk.timestamp?.[1];
    const end = typeof rawEnd === "number" && Number.isFinite(rawEnd) ? rawEnd : start;
    return timeSeconds >= start && timeSeconds <= end;
  });
}

export function clampClipToMediaDuration(
  clip: ClipWindowLike,
  mediaDurationSeconds: number
): typeof clip {
  const safeDuration = Number.isFinite(mediaDurationSeconds) ? mediaDurationSeconds : 0;
  if (safeDuration <= 0) return clip;

  const minClipDuration = 0.5;
  const rawDuration =
    Number.isFinite(clip.durationSeconds) && clip.durationSeconds > 0
      ? clip.durationSeconds
      : Math.max(0, clip.endSeconds - clip.startSeconds);
  const targetDuration = clampNumber(rawDuration, minClipDuration, safeDuration);
  const maxStart = Math.max(0, safeDuration - targetDuration);

  let start = Number.isFinite(clip.startSeconds) ? clip.startSeconds : 0;
  start = clampNumber(start, 0, maxStart);
  let end = start + targetDuration;

  if (end > safeDuration) {
    end = safeDuration;
    start = Math.max(0, end - targetDuration);
  }
  const duration = Math.max(minClipDuration, end - start);

  return {
    ...clip,
    startSeconds: Number(start.toFixed(3)),
    endSeconds: Number(end.toFixed(3)),
    durationSeconds: Number(duration.toFixed(3)),
  } as typeof clip;
}
