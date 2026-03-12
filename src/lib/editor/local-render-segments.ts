import { getTimelineAudioPlacements, getTimelineClipPlacements } from "./core/timeline";
import type { EditorProjectRecord, TimelineAudioItem, TimelineVideoClip } from "./types";

export const BROWSER_SEGMENT_RENDER_TRIGGER_CLIP_COUNT = 18;
export const BROWSER_SEGMENT_RENDER_TRIGGER_DURATION_SECONDS = 300;
export const BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT = 1;
export const BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS = 45;

export interface BrowserRenderSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  clipCount: number;
  project: EditorProjectRecord;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

export function shouldUseSegmentedBrowserRender(input: {
  clipCount: number;
  durationSeconds: number;
}): boolean {
  return (
    input.clipCount >= BROWSER_SEGMENT_RENDER_TRIGGER_CLIP_COUNT ||
    input.durationSeconds >= BROWSER_SEGMENT_RENDER_TRIGGER_DURATION_SECONDS
  );
}

interface RenderSegmentClip {
  clip: TimelineVideoClip;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

function splitPlacementIntoRenderSegmentClips(
  placement: ReturnType<typeof getTimelineClipPlacements>[number],
  maxDurationSeconds: number
): RenderSegmentClip[] {
  if (placement.durationSeconds <= maxDurationSeconds) {
    return [
      {
        clip: placement.clip,
        startSeconds: placement.startSeconds,
        endSeconds: placement.endSeconds,
        durationSeconds: placement.durationSeconds,
      },
    ];
  }

  const partCount = Math.ceil(placement.durationSeconds / maxDurationSeconds);
  const units: RenderSegmentClip[] = [];
  let consumedDurationSeconds = 0;

  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const durationSeconds = roundMs(
      Math.min(maxDurationSeconds, placement.durationSeconds - consumedDurationSeconds)
    );
    const trimStartSeconds = placement.clip.actions.reverse
      ? roundMs(placement.clip.trimEndSeconds - consumedDurationSeconds - durationSeconds)
      : roundMs(placement.clip.trimStartSeconds + consumedDurationSeconds);
    const trimEndSeconds = roundMs(trimStartSeconds + durationSeconds);
    const label = `${placement.clip.label} (${partIndex + 1}/${partCount})`;
    units.push({
      clip: {
        ...placement.clip,
        id: `${placement.clip.id}__segment_${partIndex}`,
        label,
        trimStartSeconds,
        trimEndSeconds,
      },
      startSeconds: roundMs(placement.startSeconds + consumedDurationSeconds),
      endSeconds: roundMs(placement.startSeconds + consumedDurationSeconds + durationSeconds),
      durationSeconds,
    });
    consumedDurationSeconds = roundMs(consumedDurationSeconds + durationSeconds);
  }

  return units;
}

function sliceTimelineAudioItemsForSegment(
  project: EditorProjectRecord,
  startSeconds: number,
  endSeconds: number
): TimelineAudioItem[] {
  return getTimelineAudioPlacements(project.timeline.audioItems).flatMap((placement) => {
    const overlapStart = Math.max(startSeconds, placement.startSeconds);
    const overlapEnd = Math.min(endSeconds, placement.endSeconds);
    if (overlapEnd <= overlapStart) return [];

    const itemOffsetStart = overlapStart - placement.startSeconds;
    const itemOffsetEnd = overlapEnd - placement.startSeconds;
    return [
      {
        ...placement.item,
        startOffsetSeconds: roundMs(overlapStart - startSeconds),
        trimStartSeconds: roundMs(placement.item.trimStartSeconds + itemOffsetStart),
        trimEndSeconds: roundMs(placement.item.trimStartSeconds + itemOffsetEnd),
      },
    ];
  });
}

function buildSegmentProject(input: {
  project: EditorProjectRecord;
  segmentIndex: number;
  segmentClips: RenderSegmentClip[];
}): BrowserRenderSegment {
  const firstPlacement = input.segmentClips[0];
  const lastPlacement = input.segmentClips[input.segmentClips.length - 1];
  if (!firstPlacement || !lastPlacement) {
    throw new Error("Segmented browser render requires at least one clip per segment.");
  }

  const startSeconds = firstPlacement.startSeconds;
  const endSeconds = lastPlacement.endSeconds;
  const videoClips = input.segmentClips.map((segmentClip) => segmentClip.clip);
  const audioItems = sliceTimelineAudioItemsForSegment(input.project, startSeconds, endSeconds);
  const assetIdSet = new Set([
    ...videoClips.map((clip) => clip.assetId),
    ...audioItems.map((item) => item.assetId),
  ]);

  return {
    index: input.segmentIndex,
    startSeconds,
    endSeconds,
    durationSeconds: roundMs(endSeconds - startSeconds),
    clipCount: videoClips.length,
    project: {
      ...input.project,
      name: `${input.project.name} (Segment ${input.segmentIndex + 1})`,
      assetIds: [...assetIdSet],
      timeline: {
        playheadSeconds: 0,
        zoomLevel: input.project.timeline.zoomLevel,
        selectedItem: undefined,
        videoClips,
        videoClipGroups: [],
        audioItems,
      },
    },
  };
}

export function buildSegmentedBrowserRenderSegments(input: {
  project: EditorProjectRecord;
  maxClipCount?: number;
  maxDurationSeconds?: number;
}): BrowserRenderSegment[] {
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);
  if (placements.length === 0) return [];

  const maxClipCount = Math.max(1, Math.floor(input.maxClipCount ?? BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT));
  const maxDurationSeconds = Math.max(1, input.maxDurationSeconds ?? BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS);
  const renderSegmentClips = placements.flatMap((placement) =>
    splitPlacementIntoRenderSegmentClips(placement, maxDurationSeconds)
  );
  const segments: BrowserRenderSegment[] = [];
  let pendingClips: RenderSegmentClip[] = [];

  const pushSegment = () => {
    if (pendingClips.length === 0) return;
    segments.push(
      buildSegmentProject({
        project: input.project,
        segmentIndex: segments.length,
        segmentClips: pendingClips,
      })
    );
    pendingClips = [];
  };

  for (const nextClip of renderSegmentClips) {
    const nextClipCount = pendingClips.length + 1;
    const nextDurationSeconds =
      pendingClips.length === 0
        ? nextClip.durationSeconds
        : nextClip.endSeconds - pendingClips[0].startSeconds;
    const shouldSplit =
      pendingClips.length > 0 &&
      (nextClipCount > maxClipCount || nextDurationSeconds > maxDurationSeconds);

    if (shouldSplit) {
      pushSegment();
    }
    pendingClips.push(nextClip);
  }

  pushSegment();
  return segments;
}
