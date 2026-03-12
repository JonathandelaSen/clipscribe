import { buildShortExportGeometry } from "../../creator/core/export-geometry";
import { getEditorOutputDimensions } from "./aspect-ratio";
import { getTimelineAudioEnd, getTimelineClipPlacements } from "./timeline";
import type {
  EditorAssetRecord,
  EditorProjectRecord,
  EditorResolution,
  ResolvedEditorAsset,
} from "../types";

export interface ResolvedExportInput {
  inputIndex: number;
  assetId: string;
  path: string;
  asset: EditorAssetRecord;
}

export interface EditorExportPlan {
  width: number;
  height: number;
  durationSeconds: number;
  inputs: ResolvedExportInput[];
  ffmpegArgs: string[];
  filterComplex: string;
  warnings: string[];
  videoTrackLabel: string;
  mixedAudioLabel: string | null;
}

export interface EditorAudioExportPlan {
  durationSeconds: number;
  inputs: ResolvedExportInput[];
  ffmpegArgs: string[];
  filterComplex: string;
  warnings: string[];
  mixedAudioLabel: string;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

export function createResolvedExportInputs(resolvedAssets: ResolvedEditorAsset[]): ResolvedExportInput[] {
  let inputIndex = 0;
  return resolvedAssets.flatMap((resolved) => {
    if (resolved.missing || !resolved.file) return [];
    return [
      {
        inputIndex: inputIndex++,
        assetId: resolved.asset.id,
        path: resolved.file.name,
        asset: resolved.asset,
      },
    ];
  });
}

function appendClipAudioFilters(input: {
  placements: ReturnType<typeof getTimelineClipPlacements>;
  inputsByAssetId: Map<string, ResolvedExportInput>;
  warnings: string[];
  filterParts: string[];
}): {
  concatAudioInputs: string[];
  concatSegmentCount: number;
  clipAudioLabel: string;
} {
  const concatAudioInputs: string[] = [];
  let concatSegmentCount = 0;

  for (const placement of input.placements) {
    const inputRef = input.inputsByAssetId.get(placement.clip.assetId);
    if (!inputRef) {
      input.warnings.push(`Missing asset for clip "${placement.clip.label}".`);
      continue;
    }

    const audioLabel = `aseg${placement.index}`;
    if (inputRef.asset.hasAudio && !placement.clip.muted && placement.clip.volume > 0) {
      const audioFilters = [
        `atrim=start=${placement.clip.trimStartSeconds}:end=${placement.clip.trimEndSeconds}`,
        "asetpts=PTS-STARTPTS",
        placement.clip.actions.reverse ? "areverse" : null,
        `volume=${placement.clip.volume.toFixed(3)}`,
      ].filter(Boolean);
      input.filterParts.push(`[${inputRef.inputIndex}:a]${audioFilters.join(",")}[${audioLabel}]`);
    } else {
      input.filterParts.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${placement.durationSeconds.toFixed(3)}[${audioLabel}]`
      );
    }

    concatAudioInputs.push(`[${audioLabel}]`);
    concatSegmentCount += 1;
  }

  if (concatSegmentCount === 0) {
    throw new Error("Export plan requires at least one timeline clip.");
  }

  const clipAudioLabel = "clip_audio_track";
  input.filterParts.push(
    `${concatAudioInputs.join("")}concat=n=${concatSegmentCount}:v=0:a=1[${clipAudioLabel}]`
  );

  return {
    concatAudioInputs,
    concatSegmentCount,
    clipAudioLabel,
  };
}

function appendTimelineAudioMixFilters(input: {
  project: EditorProjectRecord;
  inputsByAssetId: Map<string, ResolvedExportInput>;
  warnings: string[];
  filterParts: string[];
  baseAudioLabel: string;
}): string {
  let mixedAudioLabel = input.baseAudioLabel;

  input.project.timeline.audioItems.forEach((audioItem, index) => {
    const audioInputRef = input.inputsByAssetId.get(audioItem.assetId);
    if (!audioInputRef) {
      input.warnings.push(`Audio track item ${index + 1} is missing its source file.`);
      return;
    }

    const trackLabel = `music_track_${index}`;
    const delayMs = Math.round(Math.max(0, audioItem.startOffsetSeconds) * 1000);
    input.filterParts.push(
      `[${audioInputRef.inputIndex}:a]atrim=start=${audioItem.trimStartSeconds}:end=${audioItem.trimEndSeconds},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=${audioItem.muted ? 0 : audioItem.volume.toFixed(
        3
      )}[${trackLabel}]`
    );
    const nextMixedLabel = `mixed_audio_${index}`;
    input.filterParts.push(
      `[${mixedAudioLabel}][${trackLabel}]amix=inputs=2:duration=longest:dropout_transition=0[${nextMixedLabel}]`
    );
    mixedAudioLabel = nextMixedLabel;
  });

  return mixedAudioLabel;
}

export function buildEditorExportPlan(input: {
  project: EditorProjectRecord;
  inputs: ResolvedExportInput[];
  resolution: EditorResolution;
  includeAudio?: boolean;
}): EditorExportPlan {
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);
  const inputsByAssetId = new Map(input.inputs.map((item) => [item.assetId, item]));
  const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
  const includeAudio = input.includeAudio !== false;

  const warnings: string[] = [];
  const filterParts: string[] = [];
  const concatVideoInputs: string[] = [];
  const concatInterleavedInputs: string[] = [];
  let concatSegmentCount = 0;

  for (const placement of placements) {
    const inputRef = inputsByAssetId.get(placement.clip.assetId);
    if (!inputRef) {
      warnings.push(`Missing asset for clip "${placement.clip.label}".`);
      continue;
    }

    const geometry = buildShortExportGeometry({
      sourceWidth: inputRef.asset.width ?? width,
      sourceHeight: inputRef.asset.height ?? height,
      editor: placement.clip.canvas,
      outputWidth: width,
      outputHeight: height,
    });
    const videoLabel = `vseg${placement.index}`;
    const videoFilters = [
      `trim=start=${placement.clip.trimStartSeconds}:end=${placement.clip.trimEndSeconds}`,
      "setpts=PTS-STARTPTS",
      placement.clip.actions.reverse ? "reverse" : null,
      geometry.filter,
    ].filter(Boolean);
    filterParts.push(
      `[${inputRef.inputIndex}:v]${videoFilters.join(",")}[${videoLabel}]`
    );

    concatVideoInputs.push(`[${videoLabel}]`);
    if (includeAudio) {
      const audioLabel = `aseg${placement.index}`;
      if (inputRef.asset.hasAudio && !placement.clip.muted && placement.clip.volume > 0) {
        const audioFilters = [
          `atrim=start=${placement.clip.trimStartSeconds}:end=${placement.clip.trimEndSeconds}`,
          "asetpts=PTS-STARTPTS",
          placement.clip.actions.reverse ? "areverse" : null,
          `volume=${placement.clip.volume.toFixed(3)}`,
        ].filter(Boolean);
        filterParts.push(`[${inputRef.inputIndex}:a]${audioFilters.join(",")}[${audioLabel}]`);
      } else {
        filterParts.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${placement.durationSeconds.toFixed(3)}[${audioLabel}]`
        );
      }
      concatInterleavedInputs.push(`[${videoLabel}]`, `[${audioLabel}]`);
    }
    concatSegmentCount += 1;
  }

  const concatVideoLabel = "video_track";
  if (concatSegmentCount === 0) {
    throw new Error("Export plan requires at least one timeline clip.");
  }

  let mixedAudioLabel: string | null = null;
  if (includeAudio) {
    filterParts.push(
      `${concatInterleavedInputs.join("")}concat=n=${concatSegmentCount}:v=1:a=1[${concatVideoLabel}][clip_audio_track]`
    );
    mixedAudioLabel = appendTimelineAudioMixFilters({
      project: input.project,
      inputsByAssetId,
      warnings,
      filterParts,
      baseAudioLabel: "clip_audio_track",
    });
  } else {
    filterParts.push(`${concatVideoInputs.join("")}concat=n=${concatSegmentCount}:v=1:a=0[${concatVideoLabel}]`);
  }

  const ffmpegArgs = input.inputs.flatMap((item) => ["-i", item.path]);
  const durationSeconds = roundMs(
    Math.max(placements[placements.length - 1]?.endSeconds ?? 0, getTimelineAudioEnd(input.project.timeline.audioItems))
  );

  return {
    width,
    height,
    durationSeconds,
    inputs: input.inputs,
    ffmpegArgs,
    filterComplex: filterParts.join(";"),
    warnings,
    videoTrackLabel: concatVideoLabel,
    mixedAudioLabel,
  };
}

export function buildEditorAudioExportPlan(input: {
  project: EditorProjectRecord;
  inputs: ResolvedExportInput[];
}): EditorAudioExportPlan {
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);
  const inputsByAssetId = new Map(input.inputs.map((item) => [item.assetId, item]));
  const warnings: string[] = [];
  const filterParts: string[] = [];
  const { clipAudioLabel } = appendClipAudioFilters({
    placements,
    inputsByAssetId,
    warnings,
    filterParts,
  });

  const mixedAudioLabel = appendTimelineAudioMixFilters({
    project: input.project,
    inputsByAssetId,
    warnings,
    filterParts,
    baseAudioLabel: clipAudioLabel,
  });
  const ffmpegArgs = input.inputs.flatMap((item) => ["-i", item.path]);
  const durationSeconds = roundMs(
    Math.max(placements[placements.length - 1]?.endSeconds ?? 0, getTimelineAudioEnd(input.project.timeline.audioItems))
  );

  return {
    durationSeconds,
    inputs: input.inputs,
    ffmpegArgs,
    filterComplex: filterParts.join(";"),
    warnings,
    mixedAudioLabel,
  };
}
