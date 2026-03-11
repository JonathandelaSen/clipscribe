import type {
  EditorAssetRecord,
  EditorProjectRecord,
  TimelineAudioItem,
  TimelineClipPlacement,
  TimelineVideoClip,
} from "../types";
import { makeId } from "../../history";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

export function getVideoClipDuration(clip: TimelineVideoClip): number {
  return roundMs(Math.max(0.5, clip.trimEndSeconds - clip.trimStartSeconds));
}

export function getAudioTrackDuration(track: TimelineAudioItem | null | undefined): number {
  if (!track) return 0;
  return roundMs(Math.max(0, track.trimEndSeconds - track.trimStartSeconds));
}

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

export function getProjectVideoDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  const placements = getTimelineClipPlacements(project.timeline.videoClips);
  return placements.length ? placements[placements.length - 1].endSeconds : 0;
}

export function getProjectDuration(project: Pick<EditorProjectRecord, "timeline">): number {
  const videoDuration = getProjectVideoDuration(project);
  const audioDuration = project.timeline.audioTrack
    ? project.timeline.audioTrack.startOffsetSeconds + getAudioTrackDuration(project.timeline.audioTrack)
    : 0;
  return roundMs(Math.max(videoDuration, audioDuration));
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

export function clampAudioTrackToAsset(track: TimelineAudioItem, assetDurationSeconds: number): TimelineAudioItem {
  const safeDuration = Math.max(0.5, assetDurationSeconds || 0.5);
  const trimStartSeconds = clampNumber(track.trimStartSeconds, 0, Math.max(0, safeDuration - 0.5));
  const trimEndSeconds = clampNumber(track.trimEndSeconds, trimStartSeconds + 0.5, safeDuration);
  return {
    ...track,
    startOffsetSeconds: roundMs(Math.max(0, track.startOffsetSeconds)),
    trimStartSeconds: roundMs(trimStartSeconds),
    trimEndSeconds: roundMs(trimEndSeconds),
  };
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

export function replaceTimelineClip(
  clips: TimelineVideoClip[],
  nextClip: TimelineVideoClip
): TimelineVideoClip[] {
  return clips.map((clip) => (clip.id === nextClip.id ? nextClip : clip));
}

export function findClipAtProjectTime(
  clips: TimelineVideoClip[],
  projectTimeSeconds: number
): TimelineClipPlacement | undefined {
  return getTimelineClipPlacements(clips).find(
    (placement) => projectTimeSeconds >= placement.startSeconds && projectTimeSeconds < placement.endSeconds
  );
}

export function ensureProjectSelection(project: EditorProjectRecord): EditorProjectRecord {
  const selectedExists = project.timeline.selectedClipId
    ? project.timeline.videoClips.some((clip) => clip.id === project.timeline.selectedClipId)
    : false;
  return {
    ...project,
    timeline: {
      ...project.timeline,
      selectedClipId: selectedExists ? project.timeline.selectedClipId : project.timeline.videoClips[0]?.id,
    },
  };
}

export function getAssetById(
  assets: EditorAssetRecord[],
  assetId: string
): EditorAssetRecord | undefined {
  return assets.find((asset) => asset.id === assetId);
}
