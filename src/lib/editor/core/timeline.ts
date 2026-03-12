import type {
  EditorAssetRecord,
  EditorProjectRecord,
  TimelineAudioItem,
  TimelineAudioPlacement,
  TimelineClipPlacement,
  TimelineSelection,
  TimelineSelectionKind,
  TimelineVideoClip,
} from "../types";
import { makeId } from "../../history";
import {
  DEFAULT_EDITOR_MEDIA_MUTED,
  DEFAULT_EDITOR_MEDIA_VOLUME,
  getDefaultEditorCanvasState,
} from "../storage";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

export function getVideoClipDuration(clip: TimelineVideoClip): number {
  return roundMs(Math.max(0.5, clip.trimEndSeconds - clip.trimStartSeconds));
}

export function getVideoClipMediaTime(
  clip: TimelineVideoClip,
  clipStartSeconds: number,
  playheadSeconds: number
): number {
  const clipOffsetSeconds = Math.max(0, playheadSeconds - clipStartSeconds);
  if (!clip.actions.reverse) {
    return roundMs(clip.trimStartSeconds + clipOffsetSeconds);
  }

  // Avoid landing on the exact trim end because browsers often snap that to media end.
  const reverseTrimEnd = Math.max(clip.trimStartSeconds, clip.trimEndSeconds - 0.001);
  return roundMs(reverseTrimEnd - clipOffsetSeconds);
}

export function getAudioItemDuration(item: TimelineAudioItem): number {
  return roundMs(Math.max(0.5, item.trimEndSeconds - item.trimStartSeconds));
}

export const getAudioTrackDuration = getAudioItemDuration;

export function getTimelineClipPlacements(clips: TimelineVideoClip[]): TimelineClipPlacement[] {
  let cursor = 0;
  return clips.map((clip, index) => {
    const durationSeconds = getVideoClipDuration(clip);
    const placement = {
      clip,
      index,
      startSeconds: roundMs(cursor),
      endSeconds: roundMs(cursor + durationSeconds),
      durationSeconds,
    };
    cursor += durationSeconds;
    return placement;
  });
}

export function getTimelineAudioPlacements(items: TimelineAudioItem[]): TimelineAudioPlacement[] {
  return items.map((item, index) => {
    const durationSeconds = getAudioItemDuration(item);
    const startSeconds = roundMs(Math.max(0, item.startOffsetSeconds));
    return {
      item,
      index,
      startSeconds,
      endSeconds: roundMs(startSeconds + durationSeconds),
      durationSeconds,
    };
  });
}

export function getTimelineAudioEnd(items: TimelineAudioItem[]): number {
  const placements = getTimelineAudioPlacements(items);
  return placements.length ? placements[placements.length - 1].endSeconds : 0;
}

export function getProjectVideoDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  const placements = getTimelineClipPlacements(project.timeline.videoClips);
  return placements.length ? placements[placements.length - 1].endSeconds : 0;
}

export function getProjectDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  return roundMs(Math.max(getProjectVideoDuration(project), getTimelineAudioEnd(project.timeline.audioItems)));
}

export function clampVideoClipToAsset(clip: TimelineVideoClip, assetDurationSeconds: number): TimelineVideoClip {
  const safeDuration = Math.max(0.5, assetDurationSeconds || 0.5);
  const trimStartSeconds = clampNumber(clip.trimStartSeconds, 0, Math.max(0, safeDuration - 0.5));
  const trimEndSeconds = clampNumber(clip.trimEndSeconds, trimStartSeconds + 0.5, safeDuration);
  return {
    ...clip,
    trimStartSeconds: roundMs(trimStartSeconds),
    trimEndSeconds: roundMs(trimEndSeconds),
  };
}

export function clampAudioItemToAsset(item: TimelineAudioItem, assetDurationSeconds: number): TimelineAudioItem {
  const safeDuration = Math.max(0.5, assetDurationSeconds || 0.5);
  const trimStartSeconds = clampNumber(item.trimStartSeconds, 0, Math.max(0, safeDuration - 0.5));
  const trimEndSeconds = clampNumber(item.trimEndSeconds, trimStartSeconds + 0.5, safeDuration);
  return {
    ...item,
    startOffsetSeconds: roundMs(Math.max(0, item.startOffsetSeconds)),
    trimStartSeconds: roundMs(trimStartSeconds),
    trimEndSeconds: roundMs(trimEndSeconds),
  };
}

export const clampAudioTrackToAsset = clampAudioItemToAsset;

export function resetTimelineVideoClipTrim(
  clip: TimelineVideoClip,
  assetDurationSeconds: number
): TimelineVideoClip {
  return clampVideoClipToAsset(
    {
      ...clip,
      trimStartSeconds: 0,
      trimEndSeconds: Math.max(0.5, assetDurationSeconds || 0.5),
    },
    assetDurationSeconds
  );
}

export function resetTimelineVideoClipFrame(clip: TimelineVideoClip): TimelineVideoClip {
  return {
    ...clip,
    canvas: getDefaultEditorCanvasState(),
  };
}

export function resetTimelineVideoClipAudio(clip: TimelineVideoClip): TimelineVideoClip {
  return {
    ...clip,
    volume: DEFAULT_EDITOR_MEDIA_VOLUME,
    muted: DEFAULT_EDITOR_MEDIA_MUTED,
  };
}

export function resetTimelineAudioItemTrim(
  item: TimelineAudioItem,
  assetDurationSeconds: number
): TimelineAudioItem {
  return clampAudioItemToAsset(
    {
      ...item,
      trimStartSeconds: 0,
      trimEndSeconds: Math.max(0.5, assetDurationSeconds || 0.5),
    },
    assetDurationSeconds
  );
}

export function getContiguousAudioStartOffset(
  items: TimelineAudioItem[],
  itemId: string
): number {
  let cursor = 0;
  for (const item of items) {
    if (item.id === itemId) {
      return roundMs(cursor);
    }
    cursor += getAudioItemDuration(item);
  }
  return 0;
}

export function resetTimelineAudioItemTrack(
  items: TimelineAudioItem[],
  itemId: string
): TimelineAudioItem[] {
  const nextStartOffset = getContiguousAudioStartOffset(items, itemId);
  return normalizeTimelineAudioItems(
    items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            startOffsetSeconds: nextStartOffset,
            volume: DEFAULT_EDITOR_MEDIA_VOLUME,
            muted: DEFAULT_EDITOR_MEDIA_MUTED,
          }
        : item
    )
  );
}

export function normalizeTimelineAudioItems(items: TimelineAudioItem[]): TimelineAudioItem[] {
  const sorted = [...items].sort((a, b) => a.startOffsetSeconds - b.startOffsetSeconds);
  let previousEnd = 0;
  return sorted.map((item) => {
    const startOffsetSeconds = roundMs(Math.max(previousEnd, Math.max(0, item.startOffsetSeconds)));
    const nextItem = {
      ...item,
      startOffsetSeconds,
      trimStartSeconds: roundMs(Math.max(0, item.trimStartSeconds)),
      trimEndSeconds: roundMs(Math.max(item.trimStartSeconds + 0.5, item.trimEndSeconds)),
    };
    previousEnd = roundMs(startOffsetSeconds + getAudioItemDuration(nextItem));
    return nextItem;
  });
}

export function reorderTimelineClip(
  clips: TimelineVideoClip[],
  draggedClipId: string,
  targetIndex: number
): TimelineVideoClip[] {
  const startIndex = clips.findIndex((clip) => clip.id === draggedClipId);
  if (startIndex < 0) return clips;
  const boundedTarget = clampNumber(targetIndex, 0, Math.max(0, clips.length - 1));
  if (startIndex === boundedTarget) return clips;

  const next = [...clips];
  const [moved] = next.splice(startIndex, 1);
  next.splice(boundedTarget, 0, moved);
  return next;
}

export function splitTimelineClip(
  clips: TimelineVideoClip[],
  clipId: string,
  projectTimeSeconds: number
): TimelineVideoClip[] {
  const placements = getTimelineClipPlacements(clips);
  const placement = placements.find((item) => item.clip.id === clipId);
  if (!placement) return clips;

  const splitOffset = projectTimeSeconds - placement.startSeconds;
  if (splitOffset <= 0.25 || splitOffset >= placement.durationSeconds - 0.25) return clips;

  const splitTrim = roundMs(placement.clip.trimStartSeconds + splitOffset);
  const first: TimelineVideoClip = {
    ...placement.clip,
    trimEndSeconds: splitTrim,
  };
  const second: TimelineVideoClip = {
    ...placement.clip,
    id: makeId("edclip"),
    label: `${placement.clip.label} B`,
    trimStartSeconds: splitTrim,
  };

  return clips.flatMap((clip) => {
    if (clip.id !== clipId) return [clip];
    return [first, second];
  });
}

export function removeTimelineClip(clips: TimelineVideoClip[], clipId: string): TimelineVideoClip[] {
  return clips.filter((clip) => clip.id !== clipId);
}

export function removeTimelineAudioItem(items: TimelineAudioItem[], itemId: string): TimelineAudioItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function replaceTimelineClip(
  clips: TimelineVideoClip[],
  nextClip: TimelineVideoClip
): TimelineVideoClip[] {
  return clips.map((clip) => (clip.id === nextClip.id ? nextClip : clip));
}

export function replaceTimelineAudioItem(
  items: TimelineAudioItem[],
  nextItem: TimelineAudioItem
): TimelineAudioItem[] {
  return normalizeTimelineAudioItems(items.map((item) => (item.id === nextItem.id ? nextItem : item)));
}

export function createClonedTimelineClip(clip: TimelineVideoClip): TimelineVideoClip {
  return {
    ...clip,
    id: makeId("edclip"),
  };
}

export function createClonedTimelineAudioItem(item: TimelineAudioItem): TimelineAudioItem {
  return {
    ...item,
    id: makeId("edaudio"),
  };
}

export function insertTimelineClipAfter(
  clips: TimelineVideoClip[],
  nextClip: TimelineVideoClip,
  afterClipId?: string
): TimelineVideoClip[] {
  if (!afterClipId) {
    return [...clips, nextClip];
  }
  const index = clips.findIndex((clip) => clip.id === afterClipId);
  if (index < 0) {
    return [...clips, nextClip];
  }
  const result = [...clips];
  result.splice(index + 1, 0, nextClip);
  return result;
}

export function replaceTimelineClipsWithMergedClip(
  clips: TimelineVideoClip[],
  mergedClip: TimelineVideoClip,
  mergedClipIds: string[]
): TimelineVideoClip[] {
  if (mergedClipIds.length === 0) return clips;
  const selectedIds = new Set(mergedClipIds);
  const firstIndex = clips.findIndex((clip) => selectedIds.has(clip.id));
  if (firstIndex < 0) return clips;

  const nextClips = clips.filter((clip) => !selectedIds.has(clip.id));
  nextClips.splice(firstIndex, 0, mergedClip);
  return nextClips;
}

export function appendTimelineAudioItem(
  items: TimelineAudioItem[],
  nextItem: TimelineAudioItem
): TimelineAudioItem[] {
  const endSeconds = getTimelineAudioEnd(items);
  return normalizeTimelineAudioItems([
    ...items,
    {
      ...nextItem,
      startOffsetSeconds: endSeconds,
    },
  ]);
}

export function insertTimelineAudioItemAfter(
  items: TimelineAudioItem[],
  nextItem: TimelineAudioItem,
  afterItemId?: string
): TimelineAudioItem[] {
  if (!afterItemId) {
    return appendTimelineAudioItem(items, nextItem);
  }

  const index = items.findIndex((item) => item.id === afterItemId);
  if (index < 0) {
    return appendTimelineAudioItem(items, nextItem);
  }

  const result = [...items];
  const insertedDuration = getAudioItemDuration(nextItem);
  const insertionStart = roundMs(items[index].startOffsetSeconds + getAudioItemDuration(items[index]));
  result.splice(index + 1, 0, {
    ...nextItem,
    startOffsetSeconds: insertionStart,
  });

  for (let itemIndex = index + 2; itemIndex < result.length; itemIndex += 1) {
    result[itemIndex] = {
      ...result[itemIndex],
      startOffsetSeconds: roundMs(result[itemIndex].startOffsetSeconds + insertedDuration),
    };
  }

  return normalizeTimelineAudioItems(result);
}

export function findClipAtProjectTime(
  clips: TimelineVideoClip[],
  projectTimeSeconds: number
): TimelineClipPlacement | undefined {
  return getTimelineClipPlacements(clips).find(
    (placement) => projectTimeSeconds >= placement.startSeconds && projectTimeSeconds < placement.endSeconds
  );
}

export function findAudioItemAtProjectTime(
  items: TimelineAudioItem[],
  projectTimeSeconds: number
): TimelineAudioPlacement | undefined {
  return getTimelineAudioPlacements(items).find(
    (placement) => projectTimeSeconds >= placement.startSeconds && projectTimeSeconds < placement.endSeconds
  );
}

export function getFirstTimelineSelection(
  videoClips: TimelineVideoClip[],
  audioItems: TimelineAudioItem[]
): TimelineSelection | undefined {
  if (videoClips[0]) return { kind: "video", id: videoClips[0].id };
  if (audioItems[0]) return { kind: "audio", id: audioItems[0].id };
  return undefined;
}

export function hasTimelineSelection(
  selection: TimelineSelection | undefined,
  videoClips: TimelineVideoClip[],
  audioItems: TimelineAudioItem[]
): boolean {
  if (!selection) return false;
  if (selection.kind === "video") {
    return videoClips.some((clip) => clip.id === selection.id);
  }
  return audioItems.some((item) => item.id === selection.id);
}

export function ensureProjectSelection(project: EditorProjectRecord): EditorProjectRecord {
  const audioItems = normalizeTimelineAudioItems(project.timeline.audioItems ?? []);
  const selectedItem = hasTimelineSelection(project.timeline.selectedItem, project.timeline.videoClips, audioItems)
    ? project.timeline.selectedItem
    : getFirstTimelineSelection(project.timeline.videoClips, audioItems);

  return {
    ...project,
    timeline: {
      ...project.timeline,
      selectedItem,
      audioItems,
    },
  };
}

export function getSelectionForLaneIndex(
  kind: TimelineSelectionKind,
  index: number,
  videoClips: TimelineVideoClip[],
  audioItems: TimelineAudioItem[]
): TimelineSelection | undefined {
  const lane = kind === "video" ? videoClips : audioItems;
  if (lane[index]) {
    return { kind, id: lane[index].id };
  }
  if (index > 0 && lane[index - 1]) {
    return { kind, id: lane[index - 1].id };
  }
  return getFirstTimelineSelection(videoClips, audioItems);
}

export function getAssetById(
  assets: EditorAssetRecord[],
  assetId: string
): EditorAssetRecord | undefined {
  return assets.find((asset) => asset.id === assetId);
}
