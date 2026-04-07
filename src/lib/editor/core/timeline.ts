import {
  EDITOR_SUBTITLE_TRACK_ID,
} from "../types";
import type {
  EditorAssetRecord,
  EditorProjectRecord,
  TimelineAudioItem,
  TimelineAudioPlacement,
  TimelineClipGroup,
  TimelineImageItem,
  TimelineImagePlacement,
  TimelineOverlayItem,
  TimelineOverlayPlacement,
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

function hasProjectSubtitleTrack(project: Pick<EditorProjectRecord, "subtitles">): boolean {
  return (
    project.subtitles.source.kind !== "none" ||
    project.subtitles.chunks.length > 0 ||
    Boolean(project.subtitles.label)
  );
}

function getOrderedClipIds(
  clipIds: string[],
  indexByClipId: Map<string, number>
): string[] {
  return [...clipIds].sort((left, right) => (indexByClipId.get(left) ?? Infinity) - (indexByClipId.get(right) ?? Infinity));
}

export interface TimelineVideoClipBlockPlacement {
  kind: "clip";
  id: string;
  label: string;
  clip: TimelineVideoClip;
  clipPlacement: TimelineClipPlacement;
  clipIds: string[];
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  index: number;
}

export interface TimelineVideoGroupBlockPlacement {
  kind: "group";
  id: string;
  label: string;
  group: TimelineClipGroup;
  clipPlacements: TimelineClipPlacement[];
  clipIds: string[];
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  index: number;
}

export type TimelineVideoBlockPlacement =
  | TimelineVideoClipBlockPlacement
  | TimelineVideoGroupBlockPlacement;

export const TIMELINE_IMAGE_TRACK_FALLBACK_DURATION_SECONDS = 5;

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

export function normalizeTimelineClipGroups(
  groups: TimelineClipGroup[] | undefined,
  clips: TimelineVideoClip[]
): TimelineClipGroup[] {
  const indexByClipId = new Map(clips.map((clip, index) => [clip.id, index]));
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const occupiedClipIds = new Set<string>();
  const normalized = (groups ?? []).flatMap((group) => {
    if (!group || group.kind !== "joined" || !group.id) return [];
    const uniqueClipIds = [...new Set(group.clipIds.filter((clipId) => typeof clipId === "string"))];
    if (uniqueClipIds.length !== 2) return [];
    if (uniqueClipIds.some((clipId) => occupiedClipIds.has(clipId) || !indexByClipId.has(clipId))) {
      return [];
    }

    const orderedClipIds = getOrderedClipIds(uniqueClipIds, indexByClipId);
    const firstIndex = indexByClipId.get(orderedClipIds[0]);
    const secondIndex = indexByClipId.get(orderedClipIds[1]);
    if (firstIndex == null || secondIndex == null || secondIndex !== firstIndex + 1) {
      return [];
    }

    orderedClipIds.forEach((clipId) => occupiedClipIds.add(clipId));
    const derivedLabel = orderedClipIds
      .map((clipId) => clipsById.get(clipId)?.label)
      .filter((label): label is string => Boolean(label))
      .join(" + ");
    return [
      {
        ...group,
        kind: "joined" as const,
        clipIds: orderedClipIds,
        label: group.label.trim() || derivedLabel,
      },
    ];
  });

  return normalized.sort(
    (left, right) => (indexByClipId.get(left.clipIds[0]) ?? 0) - (indexByClipId.get(right.clipIds[0]) ?? 0)
  );
}

export function findTimelineClipGroup(
  groups: TimelineClipGroup[],
  groupId: string
): TimelineClipGroup | undefined {
  return groups.find((group) => group.id === groupId);
}

export function getTimelineClipGroupForClip(
  groups: TimelineClipGroup[],
  clipId: string
): TimelineClipGroup | undefined {
  return groups.find((group) => group.clipIds.includes(clipId));
}

export function canJoinTimelineClips(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  clipIds: string[]
): boolean {
  const uniqueClipIds = [...new Set(clipIds)];
  if (uniqueClipIds.length !== 2) return false;

  const normalizedGroups = normalizeTimelineClipGroups(groups, clips);
  if (uniqueClipIds.some((clipId) => getTimelineClipGroupForClip(normalizedGroups, clipId))) {
    return false;
  }

  const indexByClipId = new Map(clips.map((clip, index) => [clip.id, index]));
  const orderedClipIds = getOrderedClipIds(uniqueClipIds, indexByClipId);
  const firstIndex = indexByClipId.get(orderedClipIds[0]);
  const secondIndex = indexByClipId.get(orderedClipIds[1]);
  return firstIndex != null && secondIndex != null && secondIndex === firstIndex + 1;
}

export function createJoinedTimelineClipGroup(input: {
  clips: TimelineVideoClip[];
  groups: TimelineClipGroup[];
  clipIds: string[];
}): TimelineClipGroup | undefined {
  if (!canJoinTimelineClips(input.clips, input.groups, input.clipIds)) {
    return undefined;
  }

  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const indexByClipId = new Map(input.clips.map((clip, index) => [clip.id, index]));
  const orderedClipIds = getOrderedClipIds(input.clipIds, indexByClipId);
  return {
    id: makeId("edgroup"),
    kind: "joined",
    clipIds: orderedClipIds,
    label: orderedClipIds
      .map((clipId) => clipsById.get(clipId)?.label)
      .filter((label): label is string => Boolean(label))
      .join(" + "),
  };
}

export function unjoinTimelineClipGroup(
  groups: TimelineClipGroup[],
  groupId: string
): TimelineClipGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

export function getTimelineVideoBlockPlacements(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[]
): TimelineVideoBlockPlacement[] {
  const placements = getTimelineClipPlacements(clips);
  const normalizedGroups = normalizeTimelineClipGroups(groups, clips);
  const placementsByClipId = new Map(placements.map((placement) => [placement.clip.id, placement]));
  const groupByFirstClipId = new Map(normalizedGroups.map((group) => [group.clipIds[0], group]));
  const groupedClipIds = new Set(normalizedGroups.flatMap((group) => group.clipIds));
  const blocks: TimelineVideoBlockPlacement[] = [];
  let blockIndex = 0;

  for (let placementIndex = 0; placementIndex < placements.length; placementIndex += 1) {
    const placement = placements[placementIndex];
    const startingGroup = groupByFirstClipId.get(placement.clip.id);
    if (startingGroup) {
      const clipPlacements = startingGroup.clipIds.flatMap((clipId) => {
        const nextPlacement = placementsByClipId.get(clipId);
        return nextPlacement ? [nextPlacement] : [];
      });
      const firstPlacement = clipPlacements[0];
      const lastPlacement = clipPlacements[clipPlacements.length - 1];
      if (firstPlacement && lastPlacement) {
        blocks.push({
          kind: "group",
          id: startingGroup.id,
          label: startingGroup.label,
          group: startingGroup,
          clipPlacements,
          clipIds: [...startingGroup.clipIds],
          startSeconds: firstPlacement.startSeconds,
          endSeconds: lastPlacement.endSeconds,
          durationSeconds: roundMs(lastPlacement.endSeconds - firstPlacement.startSeconds),
          index: blockIndex,
        });
        blockIndex += 1;
        placementIndex = lastPlacement.index;
      }
      continue;
    }

    if (groupedClipIds.has(placement.clip.id)) {
      continue;
    }

    blocks.push({
      kind: "clip",
      id: placement.clip.id,
      label: placement.clip.label,
      clip: placement.clip,
      clipPlacement: placement,
      clipIds: [placement.clip.id],
      startSeconds: placement.startSeconds,
      endSeconds: placement.endSeconds,
      durationSeconds: placement.durationSeconds,
      index: blockIndex,
    });
    blockIndex += 1;
  }

  return blocks;
}

export function getTimelineSelectionForVideoBlock(
  block: TimelineVideoBlockPlacement
): TimelineSelection {
  return block.kind === "group"
    ? { kind: "video-group", id: block.group.id }
    : { kind: "video", id: block.clip.id };
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

function getProjectNonImageDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  return roundMs(Math.max(getProjectVideoDuration(project), getTimelineAudioEnd(project.timeline.audioItems)));
}

export function getTimelineImageTrackDuration(
  items: TimelineImageItem[],
  baseDurationSeconds: number
): number {
  if (items.length === 0) return 0;
  return roundMs(Math.max(baseDurationSeconds, TIMELINE_IMAGE_TRACK_FALLBACK_DURATION_SECONDS));
}

export function getTimelineImagePlacements(
  project: Pick<EditorProjectRecord, "timeline">
): TimelineImagePlacement[] {
  const durationSeconds = getTimelineImageTrackDuration(
    project.timeline.imageItems,
    getProjectNonImageDuration(project)
  );
  if (durationSeconds <= 0) return [];
  return project.timeline.imageItems.map((item, index) => ({
    item,
    index,
    startSeconds: 0,
    endSeconds: durationSeconds,
    durationSeconds,
  }));
}

export function getTimelineOverlayPlacements(
  items: TimelineOverlayItem[],
  projectDurationSeconds: number
): TimelineOverlayPlacement[] {
  const safeProjectDuration = Math.max(projectDurationSeconds, 0);
  return items.flatMap((item, index) => {
    const startSeconds = roundMs(Math.max(0, item.startOffsetSeconds));
    const durationSeconds = roundMs(Math.max(0.25, item.durationSeconds));
    const endSeconds = roundMs(Math.min(startSeconds + durationSeconds, Math.max(safeProjectDuration, startSeconds + 0.25)));
    if (endSeconds <= startSeconds) return [];
    return [
      {
        item,
        index,
        startSeconds,
        endSeconds,
        durationSeconds: roundMs(endSeconds - startSeconds),
      },
    ];
  });
}

export function getProjectVideoDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  const placements = getTimelineClipPlacements(project.timeline.videoClips);
  return placements.length ? placements[placements.length - 1].endSeconds : 0;
}

export function getProjectDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  const nonImageDuration = getProjectNonImageDuration(project);
  return roundMs(
    Math.max(
      nonImageDuration,
      getTimelineImageTrackDuration(project.timeline.imageItems, nonImageDuration)
    )
  );
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

export function reorderTimelineVideoBlock(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  block: Pick<TimelineVideoBlockPlacement, "id" | "kind">,
  targetIndex: number
): {
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
} {
  const blocks = getTimelineVideoBlockPlacements(clips, groups);
  const sourceIndex = blocks.findIndex((entry) => entry.id === block.id && entry.kind === block.kind);
  if (sourceIndex < 0) {
    return {
      videoClips: clips,
      videoClipGroups: normalizeTimelineClipGroups(groups, clips),
    };
  }

  const boundedTarget = clampNumber(targetIndex, 0, Math.max(0, blocks.length - 1));
  if (sourceIndex === boundedTarget) {
    return {
      videoClips: clips,
      videoClipGroups: normalizeTimelineClipGroups(groups, clips),
    };
  }

  const movingClipIds = new Set(blocks[sourceIndex].clipIds);
  const movingClips = clips.filter((clip) => movingClipIds.has(clip.id));
  const remainingClips = clips.filter((clip) => !movingClipIds.has(clip.id));
  const remainingBlocks = blocks.filter((_, index) => index !== sourceIndex);
  const targetBlock = remainingBlocks[boundedTarget];
  const insertionClipId = targetBlock?.clipIds[0];
  const insertionIndex =
    insertionClipId == null
      ? remainingClips.length
      : Math.max(0, remainingClips.findIndex((clip) => clip.id === insertionClipId));
  const nextClips = [...remainingClips];
  nextClips.splice(insertionIndex, 0, ...movingClips);

  return {
    videoClips: nextClips,
    videoClipGroups: normalizeTimelineClipGroups(groups, nextClips),
  };
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

export function removeTimelineClipGroup(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  groupId: string
): {
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
} {
  const normalizedGroups = normalizeTimelineClipGroups(groups, clips);
  const group = findTimelineClipGroup(normalizedGroups, groupId);
  if (!group) {
    return {
      videoClips: clips,
      videoClipGroups: normalizedGroups,
    };
  }

  const removedClipIds = new Set(group.clipIds);
  const nextClips = clips.filter((clip) => !removedClipIds.has(clip.id));
  return {
    videoClips: nextClips,
    videoClipGroups: normalizeTimelineClipGroups(
      normalizedGroups.filter((entry) => entry.id !== groupId),
      nextClips
    ),
  };
}

export function removeTimelineAudioItem(items: TimelineAudioItem[], itemId: string): TimelineAudioItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function removeTimelineImageItem(items: TimelineImageItem[], itemId: string): TimelineImageItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function removeTimelineOverlayItem(items: TimelineOverlayItem[], itemId: string): TimelineOverlayItem[] {
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

export function replaceTimelineImageItem(
  items: TimelineImageItem[],
  nextItem: TimelineImageItem
): TimelineImageItem[] {
  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

export function replaceTimelineOverlayItem(
  items: TimelineOverlayItem[],
  nextItem: TimelineOverlayItem
): TimelineOverlayItem[] {
  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

export interface TrimTimelineClipToMatchTrackResult {
  videoClips: TimelineVideoClip[];
  trimmed: boolean;
  trimmedSeconds: number;
}

export function trimTimelineClipToMatchTrackEnd(
  clips: TimelineVideoClip[],
  clipId: string,
  targetDurationSeconds: number
): TrimTimelineClipToMatchTrackResult {
  const lastPlacement = getTimelineClipPlacements(clips).at(-1);
  if (!lastPlacement || lastPlacement.clip.id !== clipId || lastPlacement.endSeconds <= targetDurationSeconds) {
    return {
      videoClips: clips,
      trimmed: false,
      trimmedSeconds: 0,
    };
  }

  const overshootSeconds = roundMs(lastPlacement.endSeconds - targetDurationSeconds);
  const nextDuration = roundMs(lastPlacement.durationSeconds - overshootSeconds);
  if (overshootSeconds <= 0 || nextDuration < 0.5) {
    return {
      videoClips: clips,
      trimmed: false,
      trimmedSeconds: 0,
    };
  }

  const nextClip: TimelineVideoClip = {
    ...lastPlacement.clip,
    trimEndSeconds: roundMs(lastPlacement.clip.trimEndSeconds - overshootSeconds),
  };

  return {
    videoClips: replaceTimelineClip(clips, nextClip),
    trimmed: true,
    trimmedSeconds: overshootSeconds,
  };
}

export interface TrimTimelineClipGroupToMatchTrackResult {
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
  trimmed: boolean;
  trimmedSeconds: number;
  tailClipId: string | null;
}

export function trimTimelineClipGroupToMatchTrackEnd(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  groupId: string,
  targetDurationSeconds: number
): TrimTimelineClipGroupToMatchTrackResult {
  const normalizedGroups = normalizeTimelineClipGroups(groups, clips);
  const lastBlock = getTimelineVideoBlockPlacements(clips, normalizedGroups).at(-1);
  if (!lastBlock || lastBlock.kind !== "group" || lastBlock.id !== groupId || lastBlock.endSeconds <= targetDurationSeconds) {
    return {
      videoClips: clips,
      videoClipGroups: normalizedGroups,
      trimmed: false,
      trimmedSeconds: 0,
      tailClipId: null,
    };
  }

  const tailPlacement = lastBlock.clipPlacements.at(-1);
  if (!tailPlacement) {
    return {
      videoClips: clips,
      videoClipGroups: normalizedGroups,
      trimmed: false,
      trimmedSeconds: 0,
      tailClipId: null,
    };
  }

  const overshootSeconds = roundMs(lastBlock.endSeconds - targetDurationSeconds);
  const nextDuration = roundMs(tailPlacement.durationSeconds - overshootSeconds);
  if (overshootSeconds <= 0 || nextDuration < 0.5) {
    return {
      videoClips: clips,
      videoClipGroups: normalizedGroups,
      trimmed: false,
      trimmedSeconds: 0,
      tailClipId: tailPlacement.clip.id,
    };
  }

  const nextClips = replaceTimelineClip(clips, {
    ...tailPlacement.clip,
    trimEndSeconds: roundMs(tailPlacement.clip.trimEndSeconds - overshootSeconds),
  });

  return {
    videoClips: nextClips,
    videoClipGroups: normalizeTimelineClipGroups(normalizedGroups, nextClips),
    trimmed: true,
    trimmedSeconds: overshootSeconds,
    tailClipId: tailPlacement.clip.id,
  };
}

export interface TrimTimelineAudioItemToMatchTrackResult {
  audioItems: TimelineAudioItem[];
  trimmed: boolean;
  trimmedSeconds: number;
}

export function trimTimelineAudioItemToMatchTrackEnd(
  items: TimelineAudioItem[],
  itemId: string,
  targetDurationSeconds: number
): TrimTimelineAudioItemToMatchTrackResult {
  const lastPlacement = getTimelineAudioPlacements(items).at(-1);
  if (!lastPlacement || lastPlacement.item.id !== itemId || lastPlacement.endSeconds <= targetDurationSeconds) {
    return {
      audioItems: items,
      trimmed: false,
      trimmedSeconds: 0,
    };
  }

  const overshootSeconds = roundMs(lastPlacement.endSeconds - targetDurationSeconds);
  const nextDuration = roundMs(lastPlacement.durationSeconds - overshootSeconds);
  if (overshootSeconds <= 0 || nextDuration < 0.5) {
    return {
      audioItems: items,
      trimmed: false,
      trimmedSeconds: 0,
    };
  }

  return {
    audioItems: replaceTimelineAudioItem(items, {
      ...lastPlacement.item,
      trimEndSeconds: roundMs(lastPlacement.item.trimEndSeconds - overshootSeconds),
    }),
    trimmed: true,
    trimmedSeconds: overshootSeconds,
  };
}

export function createClonedTimelineClip(clip: TimelineVideoClip): TimelineVideoClip {
  return {
    ...clip,
    id: makeId("edclip"),
  };
}

export function createClonedTimelineImageItem(item: TimelineImageItem): TimelineImageItem {
  return {
    ...item,
    id: makeId("edimage"),
  };
}

export function createClonedTimelineOverlayItem(item: TimelineOverlayItem): TimelineOverlayItem {
  return {
    ...item,
    id: makeId("edoverlay"),
  };
}

export interface CloneTimelineClipToFillResult {
  videoClips: TimelineVideoClip[];
  cloneCount: number;
  lastInsertedClipId: string | null;
}

export function cloneTimelineClipToFill(
  clips: TimelineVideoClip[],
  clipId: string,
  targetDurationSeconds: number
): CloneTimelineClipToFillResult {
  const template = clips.find((clip) => clip.id === clipId);
  const currentDuration = getTimelineClipPlacements(clips).at(-1)?.endSeconds ?? 0;
  if (!template || targetDurationSeconds <= currentDuration) {
    return {
      videoClips: clips,
      cloneCount: 0,
      lastInsertedClipId: null,
    };
  }

  let nextClips = clips;
  let afterClipId = clipId;
  let cloneCount = 0;
  let lastInsertedClipId: string | null = null;
  let nextDuration = currentDuration;
  const clipDuration = getVideoClipDuration(template);

  while (nextDuration < targetDurationSeconds) {
    const nextClip = createClonedTimelineClip(template);
    nextClips = insertTimelineClipAfter(nextClips, nextClip, afterClipId);
    afterClipId = nextClip.id;
    lastInsertedClipId = nextClip.id;
    cloneCount += 1;
    nextDuration = roundMs(nextDuration + clipDuration);
  }

  return {
    videoClips: nextClips,
    cloneCount,
    lastInsertedClipId,
  };
}

export function duplicateTimelineClipGroup(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  groupId: string
): {
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
  duplicatedGroup: TimelineClipGroup;
} | null {
  const normalizedGroups = normalizeTimelineClipGroups(groups, clips);
  const group = findTimelineClipGroup(normalizedGroups, groupId);
  if (!group) return null;

  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const clonedClips = group.clipIds.flatMap((clipId) => {
    const clip = clipsById.get(clipId);
    return clip ? [createClonedTimelineClip(clip)] : [];
  });
  if (clonedClips.length !== group.clipIds.length) {
    return null;
  }

  const lastClipId = group.clipIds[group.clipIds.length - 1];
  const nextClips = clips.flatMap((clip) => (clip.id === lastClipId ? [clip, ...clonedClips] : [clip]));
  const duplicatedGroup: TimelineClipGroup = {
    id: makeId("edgroup"),
    kind: "joined",
    clipIds: clonedClips.map((clip) => clip.id),
    label: group.label,
  };

  return {
    videoClips: nextClips,
    videoClipGroups: normalizeTimelineClipGroups([...normalizedGroups, duplicatedGroup], nextClips),
    duplicatedGroup,
  };
}

export interface CloneTimelineClipGroupToFillResult {
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
  cloneCount: number;
  lastInsertedGroupId: string | null;
}

export function cloneTimelineClipGroupToFill(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  groupId: string,
  targetDurationSeconds: number
): CloneTimelineClipGroupToFillResult {
  const groupBlock = getTimelineVideoBlockPlacements(clips, groups).find(
    (block) => block.kind === "group" && block.id === groupId
  );
  const currentDuration = getTimelineClipPlacements(clips).at(-1)?.endSeconds ?? 0;
  if (!groupBlock || targetDurationSeconds <= currentDuration) {
    return {
      videoClips: clips,
      videoClipGroups: normalizeTimelineClipGroups(groups, clips),
      cloneCount: 0,
      lastInsertedGroupId: null,
    };
  }

  let nextClips = clips;
  let nextGroups = normalizeTimelineClipGroups(groups, clips);
  let currentGroupId = groupId;
  let cloneCount = 0;
  let lastInsertedGroupId: string | null = null;
  let nextDuration = currentDuration;

  while (nextDuration < targetDurationSeconds) {
    const duplicated = duplicateTimelineClipGroup(nextClips, nextGroups, currentGroupId);
    if (!duplicated) break;
    nextClips = duplicated.videoClips;
    nextGroups = duplicated.videoClipGroups;
    currentGroupId = duplicated.duplicatedGroup.id;
    lastInsertedGroupId = duplicated.duplicatedGroup.id;
    cloneCount += 1;
    nextDuration = roundMs(nextDuration + groupBlock.durationSeconds);
  }

  return {
    videoClips: nextClips,
    videoClipGroups: nextGroups,
    cloneCount,
    lastInsertedGroupId,
  };
}

export function createClonedTimelineAudioItem(item: TimelineAudioItem): TimelineAudioItem {
  return {
    ...item,
    id: makeId("edaudio"),
  };
}

export interface CloneTimelineAudioItemToFillResult {
  audioItems: TimelineAudioItem[];
  cloneCount: number;
  lastInsertedItemId: string | null;
}

export function cloneTimelineAudioItemToFill(
  items: TimelineAudioItem[],
  itemId: string,
  targetDurationSeconds: number
): CloneTimelineAudioItemToFillResult {
  const template = items.find((item) => item.id === itemId);
  const currentDuration = getTimelineAudioEnd(items);
  if (!template || targetDurationSeconds <= currentDuration) {
    return {
      audioItems: items,
      cloneCount: 0,
      lastInsertedItemId: null,
    };
  }

  let nextItems = items;
  let afterItemId = itemId;
  let cloneCount = 0;
  let lastInsertedItemId: string | null = null;

  while (getTimelineAudioEnd(nextItems) < targetDurationSeconds) {
    const nextItem = createClonedTimelineAudioItem(template);
    nextItems = insertTimelineAudioItemAfter(nextItems, nextItem, afterItemId);
    afterItemId = nextItem.id;
    lastInsertedItemId = nextItem.id;
    cloneCount += 1;
  }

  return {
    audioItems: nextItems,
    cloneCount,
    lastInsertedItemId,
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

export function replaceTimelineClipGroupWithClip(
  clips: TimelineVideoClip[],
  groups: TimelineClipGroup[],
  groupId: string,
  replacementClip: TimelineVideoClip
): {
  videoClips: TimelineVideoClip[];
  videoClipGroups: TimelineClipGroup[];
} {
  const normalizedGroups = normalizeTimelineClipGroups(groups, clips);
  const group = findTimelineClipGroup(normalizedGroups, groupId);
  if (!group) {
    return {
      videoClips: clips,
      videoClipGroups: normalizedGroups,
    };
  }

  const firstIndex = clips.findIndex((clip) => clip.id === group.clipIds[0]);
  if (firstIndex < 0) {
    return {
      videoClips: clips,
      videoClipGroups: normalizedGroups,
    };
  }

  const groupedClipIds = new Set(group.clipIds);
  const nextClips = clips.filter((clip) => !groupedClipIds.has(clip.id));
  nextClips.splice(firstIndex, 0, replacementClip);

  return {
    videoClips: nextClips,
    videoClipGroups: normalizeTimelineClipGroups(
      normalizedGroups.filter((entry) => entry.id !== groupId),
      nextClips
    ),
  };
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
  audioItems: TimelineAudioItem[],
  videoClipGroups: TimelineClipGroup[] = [],
  imageItems: TimelineImageItem[] = [],
  overlayItems: TimelineOverlayItem[] = [],
  subtitleTrackAvailable = false
): TimelineSelection | undefined {
  if (overlayItems[0]) return { kind: "overlay", id: overlayItems[0].id };
  if (imageItems[0]) return { kind: "image", id: imageItems[0].id };
  const firstVideoBlock = getTimelineVideoBlockPlacements(videoClips, videoClipGroups)[0];
  if (firstVideoBlock) {
    return getTimelineSelectionForVideoBlock(firstVideoBlock);
  }
  if (subtitleTrackAvailable) return { kind: "subtitle", id: EDITOR_SUBTITLE_TRACK_ID };
  if (audioItems[0]) return { kind: "audio", id: audioItems[0].id };
  return undefined;
}

export function hasTimelineSelection(
  selection: TimelineSelection | undefined,
  videoClips: TimelineVideoClip[],
  audioItems: TimelineAudioItem[],
  videoClipGroups: TimelineClipGroup[] = [],
  imageItems: TimelineImageItem[] = [],
  overlayItems: TimelineOverlayItem[] = [],
  subtitleTrackAvailable = false
): boolean {
  if (!selection) return false;
  if (selection.kind === "overlay") {
    return overlayItems.some((item) => item.id === selection.id);
  }
  if (selection.kind === "image") {
    return imageItems.some((item) => item.id === selection.id);
  }
  if (selection.kind === "subtitle") {
    return subtitleTrackAvailable && selection.id === EDITOR_SUBTITLE_TRACK_ID;
  }
  if (selection.kind === "video") {
    return videoClips.some((clip) => clip.id === selection.id);
  }
  if (selection.kind === "video-group") {
    return normalizeTimelineClipGroups(videoClipGroups, videoClips).some((group) => group.id === selection.id);
  }
  return audioItems.some((item) => item.id === selection.id);
}

export function ensureProjectSelection(project: EditorProjectRecord): EditorProjectRecord {
  const videoClipGroups = normalizeTimelineClipGroups(project.timeline.videoClipGroups ?? [], project.timeline.videoClips);
  const audioItems = normalizeTimelineAudioItems(project.timeline.audioItems ?? []);
  const imageItems = Array.isArray(project.timeline.imageItems) ? project.timeline.imageItems : [];
  const overlayItems = Array.isArray(project.timeline.overlayItems) ? project.timeline.overlayItems : [];
  const subtitleTrackAvailable = hasProjectSubtitleTrack(project);
  const selectedItem = hasTimelineSelection(
    project.timeline.selectedItem,
    project.timeline.videoClips,
    audioItems,
    videoClipGroups,
    imageItems,
    overlayItems,
    subtitleTrackAvailable
  )
    ? project.timeline.selectedItem
    : getFirstTimelineSelection(project.timeline.videoClips, audioItems, videoClipGroups, imageItems, overlayItems, subtitleTrackAvailable);

  return {
    ...project,
    timeline: {
      ...project.timeline,
      selectedItem,
      imageItems,
      overlayItems,
      videoClipGroups,
      audioItems,
    },
  };
}

export function getSelectionForLaneIndex(
  kind: Exclude<TimelineSelectionKind, "video-group">,
  index: number,
  videoClips: TimelineVideoClip[],
  audioItems: TimelineAudioItem[],
  videoClipGroups: TimelineClipGroup[] = [],
  imageItems: TimelineImageItem[] = [],
  overlayItems: TimelineOverlayItem[] = [],
  subtitleTrackAvailable = false
): TimelineSelection | undefined {
  if (kind === "overlay") {
    if (overlayItems[index]) {
      return { kind: "overlay", id: overlayItems[index].id };
    }
    return getFirstTimelineSelection(videoClips, audioItems, videoClipGroups, imageItems, overlayItems, subtitleTrackAvailable);
  }

  if (kind === "image") {
    if (imageItems[index]) {
      return { kind: "image", id: imageItems[index].id };
    }
    return getFirstTimelineSelection(videoClips, audioItems, videoClipGroups, imageItems, overlayItems, subtitleTrackAvailable);
  }

  if (kind === "video") {
    const candidateClipIds = [videoClips[index]?.id, index > 0 ? videoClips[index - 1]?.id : undefined];
    for (const candidateClipId of candidateClipIds) {
      if (!candidateClipId) continue;
      const group = getTimelineClipGroupForClip(videoClipGroups, candidateClipId);
      if (group) {
        return { kind: "video-group", id: group.id };
      }
      return { kind: "video", id: candidateClipId };
    }
    return getFirstTimelineSelection(videoClips, audioItems, videoClipGroups, imageItems, overlayItems, subtitleTrackAvailable);
  }

  if (kind === "subtitle") {
    if (subtitleTrackAvailable) {
      return { kind: "subtitle", id: EDITOR_SUBTITLE_TRACK_ID };
    }
    return getFirstTimelineSelection(videoClips, audioItems, videoClipGroups, imageItems, overlayItems, subtitleTrackAvailable);
  }

  const lane = audioItems;
  if (lane[index]) {
    return { kind, id: lane[index].id };
  }
  if (index > 0 && lane[index - 1]) {
    return { kind, id: lane[index - 1].id };
  }
  return getFirstTimelineSelection(videoClips, audioItems, videoClipGroups, imageItems, overlayItems, subtitleTrackAvailable);
}

export function getAssetById(
  assets: EditorAssetRecord[],
  assetId: string
): EditorAssetRecord | undefined {
  return assets.find((asset) => asset.id === assetId);
}
