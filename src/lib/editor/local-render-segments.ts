import { getProjectDuration, getTimelineAudioPlacements, getTimelineClipPlacements } from "./core/timeline";
import { isEditorFfmpegExecDiagnosticMessage } from "./local-render-runtime";
import type { EditorProjectRecord, EditorResolution, TimelineAudioItem, TimelineVideoClip } from "./types";

export type BrowserRenderTierName = "low" | "medium" | "high" | "extreme";

export interface BrowserRenderProfile {
  name: BrowserRenderTierName;
  maxClipCount: number;
  maxDurationSeconds: number;
  videoPreset: "superfast" | "veryfast";
  crf: number;
}

export interface BrowserRenderPlan {
  profile: BrowserRenderProfile;
  durationSeconds: number;
  shouldSegment: boolean;
  includeAudioInSegments: boolean;
  needsAudioRemixPass: boolean;
  needsFinalMuxPass: boolean;
}

export const BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT = 1;
export const BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS = 45;
export const BROWSER_SEGMENT_RENDER_MEDIUM_MAX_CLIP_COUNT = 2;
export const BROWSER_SEGMENT_RENDER_MEDIUM_MAX_DURATION_SECONDS = 75;
export const BROWSER_SEGMENT_RENDER_LOW_MAX_CLIP_COUNT = 3;
export const BROWSER_SEGMENT_RENDER_LOW_MAX_DURATION_SECONDS = 120;
export const BROWSER_SEGMENT_RENDER_EXTREME_MAX_CLIP_COUNT = 1;
export const BROWSER_SEGMENT_RENDER_EXTREME_MAX_DURATION_SECONDS = 30;

const BROWSER_RENDER_PROFILES: Record<BrowserRenderTierName, BrowserRenderProfile> = {
  low: {
    name: "low",
    maxClipCount: BROWSER_SEGMENT_RENDER_LOW_MAX_CLIP_COUNT,
    maxDurationSeconds: BROWSER_SEGMENT_RENDER_LOW_MAX_DURATION_SECONDS,
    videoPreset: "superfast",
    crf: 24,
  },
  medium: {
    name: "medium",
    maxClipCount: BROWSER_SEGMENT_RENDER_MEDIUM_MAX_CLIP_COUNT,
    maxDurationSeconds: BROWSER_SEGMENT_RENDER_MEDIUM_MAX_DURATION_SECONDS,
    videoPreset: "veryfast",
    crf: 23,
  },
  high: {
    name: "high",
    maxClipCount: BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT,
    maxDurationSeconds: BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS,
    videoPreset: "veryfast",
    crf: 22,
  },
  extreme: {
    name: "extreme",
    maxClipCount: BROWSER_SEGMENT_RENDER_EXTREME_MAX_CLIP_COUNT,
    maxDurationSeconds: BROWSER_SEGMENT_RENDER_EXTREME_MAX_DURATION_SECONDS,
    videoPreset: "veryfast",
    crf: 24,
  },
};

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

function getBrowserTimelineDurationSeconds(project: EditorProjectRecord): number {
  return roundMs(getProjectDuration(project));
}

function hasReversedClip(project: EditorProjectRecord): boolean {
  return project.timeline.videoClips.some((clip) => clip.actions.reverse);
}

function hasSubtitleTrack(project: EditorProjectRecord): boolean {
  return (
    project.subtitles.enabled &&
    (project.subtitles.source.kind !== "none" || project.subtitles.chunks.length > 0 || Boolean(project.subtitles.label))
  );
}

export function getBrowserRenderProfile(name: BrowserRenderTierName): BrowserRenderProfile {
  return BROWSER_RENDER_PROFILES[name];
}

export function selectBrowserRenderProfile(input: {
  project: EditorProjectRecord;
  resolution: EditorResolution;
  durationSeconds?: number;
}): BrowserRenderProfile {
  const durationSeconds = input.durationSeconds ?? getBrowserTimelineDurationSeconds(input.project);
  const audioItemCount = input.project.timeline.audioItems.length;
  const clipCount = input.project.timeline.videoClips.length;
  const subtitlesEnabled = hasSubtitleTrack(input.project);
  const reversed = hasReversedClip(input.project);

  if (input.resolution === "4K") {
    return getBrowserRenderProfile("extreme");
  }

  if (subtitlesEnabled || reversed || audioItemCount > 1) {
    return getBrowserRenderProfile("high");
  }

  if (
    input.resolution === "1080p" ||
    audioItemCount === 1 ||
    clipCount >= 24 ||
    durationSeconds >= 1_500
  ) {
    return getBrowserRenderProfile("medium");
  }

  return getBrowserRenderProfile("low");
}

export function getSaferBrowserRenderProfile(
  profile: BrowserRenderProfile
): BrowserRenderProfile | null {
  switch (profile.name) {
    case "low":
      return getBrowserRenderProfile("medium");
    case "medium":
      return getBrowserRenderProfile("high");
    case "high":
      return getBrowserRenderProfile("extreme");
    case "extreme":
      return null;
  }
}

export function getRetryBrowserRenderProfile(input: {
  error: unknown;
  currentProfile: BrowserRenderProfile;
}): BrowserRenderProfile | null {
  const rawMessage = input.error instanceof Error ? input.error.message : String(input.error);
  if (!isEditorFfmpegExecDiagnosticMessage(rawMessage)) {
    return null;
  }

  return getSaferBrowserRenderProfile(input.currentProfile);
}

export function shouldUseSegmentedBrowserRender(input: {
  clipCount: number;
  durationSeconds: number;
  maxClipCount?: number;
  maxDurationSeconds?: number;
}): boolean {
  const maxClipCount = Math.max(1, Math.floor(input.maxClipCount ?? BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT));
  const maxDurationSeconds = Math.max(1, input.maxDurationSeconds ?? BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS);

  return input.clipCount > maxClipCount || input.durationSeconds > maxDurationSeconds;
}

export function buildBrowserRenderPlan(input: {
  project: EditorProjectRecord;
  resolution: EditorResolution;
  profileName?: BrowserRenderTierName;
}): BrowserRenderPlan {
  const durationSeconds = getBrowserTimelineDurationSeconds(input.project);
  const profile = input.profileName
    ? getBrowserRenderProfile(input.profileName)
    : selectBrowserRenderProfile({
        project: input.project,
        resolution: input.resolution,
        durationSeconds,
      });
  const shouldSegment = shouldUseSegmentedBrowserRender({
    clipCount: input.project.timeline.videoClips.length,
    durationSeconds,
    maxClipCount: profile.maxClipCount,
    maxDurationSeconds: profile.maxDurationSeconds,
  }) && input.project.timeline.videoClips.length > 0;
  const includeAudioInSegments = shouldSegment && input.project.timeline.audioItems.length === 0;

  return {
    profile,
    durationSeconds,
    shouldSegment,
    includeAudioInSegments,
    needsAudioRemixPass: shouldSegment && !includeAudioInSegments,
    needsFinalMuxPass: shouldSegment && !includeAudioInSegments,
  };
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
  const imageItems = input.project.timeline.imageItems.map((item) => ({
    ...item,
    canvas: { ...item.canvas },
  }));
  const audioItems = sliceTimelineAudioItemsForSegment(input.project, startSeconds, endSeconds);
  const assetIdSet = new Set([
    ...imageItems.map((item) => item.assetId),
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
        imageItems,
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
