
export interface ClipTimingLike {
  id: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface ManualFallbackClip extends ClipTimingLike {
  score: number;
  title: string;
  hook: string;
  reason: string;
  punchline: string;
  sourceChunkIndexes: number[];
  suggestedSubtitleLanguage: string;
}

export interface ManualFallbackPlan {
  id: string;
  clipId: string;
  title: string;
  caption: string;
  openingText: string;
  endCardText: string;
  editorPreset: {
    aspectRatio: "9:16";
    resolution: "1080x1920";
    subtitleStyle: "bold_pop" | "clean_caption" | "creator_neon";
    safeTopPct: number;
    safeBottomPct: number;
    targetDurationRange: [number, number];
  };
}

export interface TrimNudges {
  trimStartNudge: number;
  trimEndNudge: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function createManualFallbackClip(options: {
  sourceDurationSeconds?: number;
  subtitleLanguage?: string;
}): ManualFallbackClip {
  const maxDuration =
    typeof options.sourceDurationSeconds === "number" && Number.isFinite(options.sourceDurationSeconds)
      ? Math.max(1, round2(options.sourceDurationSeconds))
      : undefined;
  const endSeconds = maxDuration ? Math.min(maxDuration, 60) : 60;

  return {
    id: "manual_clip_fallback",
    startSeconds: 0,
    endSeconds,
    durationSeconds: round2(endSeconds),
    score: 0,
    title: "Manual Clip (No Clip Lab)",
    hook: "Edit this source manually without generating clip suggestions first.",
    reason: "Fallback clip created so the editor can be used immediately.",
    punchline: "Manual short edit",
    sourceChunkIndexes: [],
    suggestedSubtitleLanguage: options.subtitleLanguage || "en",
  };
}

export function createManualFallbackPlan(clipId: string): ManualFallbackPlan {
  return {
    id: "manual_plan_fallback",
    clipId,
    title: "Manual Edit Preset",
    caption: "",
    openingText: "Manual short cut",
    endCardText: "Follow for more",
    editorPreset: {
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleStyle: "clean_caption",
      safeTopPct: 12,
      safeBottomPct: 14,
      targetDurationRange: [15, 60],
    },
  };
}

export function applyTrimNudgesToClip<TClip extends ClipTimingLike>(
  clip: TClip,
  options: {
    sourceDurationSeconds?: number;
    trimStartNudge: number;
    trimEndNudge: number;
  }
): TClip {
  const maxClipEnd =
    typeof options.sourceDurationSeconds === "number" && Number.isFinite(options.sourceDurationSeconds)
      ? Math.max(1, round2(options.sourceDurationSeconds))
      : Number.POSITIVE_INFINITY;
  const maxClipStart = Number.isFinite(maxClipEnd) ? Math.max(0, maxClipEnd - 1) : Number.POSITIVE_INFINITY;

  const start = round2(clamp(round2(clip.startSeconds + options.trimStartNudge), 0, maxClipStart));
  const unclampedEnd = round2(clip.endSeconds + options.trimEndNudge);
  const minEnd = round2(start + 1);
  const end = round2(clamp(Math.max(minEnd, unclampedEnd), minEnd, maxClipEnd));

  return {
    ...clip,
    startSeconds: start,
    endSeconds: end,
    durationSeconds: round2(end - start),
  };
}

export function deriveTrimNudgesFromSavedClip(baseClip: ClipTimingLike, savedClip: ClipTimingLike): TrimNudges {
  return {
    trimStartNudge: round2(savedClip.startSeconds - baseClip.startSeconds),
    trimEndNudge: round2(savedClip.endSeconds - baseClip.endSeconds),
  };
}
