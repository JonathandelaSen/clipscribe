import type { ComposerTimelineItem } from "../types";

const EPSILON = 0.0001;

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeTimelineItemEndSeconds(item: ComposerTimelineItem): number {
  return round3(item.timelineStartSeconds + item.durationSeconds);
}

export function computeProjectDurationSeconds(items: ComposerTimelineItem[]): number {
  if (items.length === 0) return 0;
  return round3(
    items.reduce((maxEnd, item) => Math.max(maxEnd, computeTimelineItemEndSeconds(item)), 0)
  );
}

export function sortTimelineItems(items: ComposerTimelineItem[]): ComposerTimelineItem[] {
  return [...items].sort((a, b) => {
    if (a.timelineStartSeconds !== b.timelineStartSeconds) {
      return a.timelineStartSeconds - b.timelineStartSeconds;
    }
    if (a.lane !== b.lane) {
      return a.lane === "audio" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

export function clampTimelineItemToAsset(
  item: ComposerTimelineItem,
  assetDurationSeconds: number
): ComposerTimelineItem {
  const safeAssetDuration = Math.max(0, assetDurationSeconds);
  const sourceStartSeconds = clamp(item.sourceStartSeconds, 0, safeAssetDuration);
  const maxDuration = Math.max(0, safeAssetDuration - sourceStartSeconds);
  const durationSeconds = clamp(item.durationSeconds, 0.01, Math.max(0.01, maxDuration));

  return {
    ...item,
    sourceStartSeconds: round3(sourceStartSeconds),
    durationSeconds: round3(durationSeconds),
    timelineStartSeconds: round3(Math.max(0, item.timelineStartSeconds)),
  };
}

export function hasVisualLaneOverlap(
  items: ComposerTimelineItem[],
  candidate: ComposerTimelineItem,
  ignoreId?: string
): boolean {
  if (candidate.lane !== "video") return false;

  const candidateStart = candidate.timelineStartSeconds;
  const candidateEnd = computeTimelineItemEndSeconds(candidate);

  return items.some((item) => {
    if (item.lane !== "video") return false;
    if (item.id === candidate.id || item.id === ignoreId) return false;
    const itemStart = item.timelineStartSeconds;
    const itemEnd = computeTimelineItemEndSeconds(item);
    return candidateStart < itemEnd - EPSILON && itemStart < candidateEnd - EPSILON;
  });
}

export function duplicateTimelineItem(
  item: ComposerTimelineItem,
  newId: string,
  timelineStartSeconds = computeTimelineItemEndSeconds(item)
): ComposerTimelineItem {
  return {
    ...item,
    id: newId,
    timelineStartSeconds: round3(Math.max(0, timelineStartSeconds)),
  };
}

export function pasteTimelineItem(
  item: ComposerTimelineItem,
  newId: string,
  timelineStartSeconds: number
): ComposerTimelineItem {
  return {
    ...item,
    id: newId,
    timelineStartSeconds: round3(Math.max(0, timelineStartSeconds)),
  };
}
