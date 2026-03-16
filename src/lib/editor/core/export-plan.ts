import { buildShortExportGeometry } from "../../creator/core/export-geometry";
import { getEditorOutputDimensions } from "./aspect-ratio";
import {
  getProjectDuration,
  getTimelineClipPlacements,
  getTimelineImagePlacements,
} from "./timeline";
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

function buildInputArgs(item: ResolvedExportInput): string[] {
  return item.asset.kind === "image" ? ["-loop", "1", "-i", item.path] : ["-i", item.path];
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
  durationSeconds: number;
}): {
  clipAudioLabel: string;
} {
  const clipAudioLabel = "clip_audio_track";
  const concatAudioInputs: string[] = [];

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
  }

  if (concatAudioInputs.length === 0) {
    input.filterParts.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${Math.max(input.durationSeconds, 0.5).toFixed(3)}[${clipAudioLabel}]`
    );
    return { clipAudioLabel };
  }

  input.filterParts.push(
    `${concatAudioInputs.join("")}concat=n=${concatAudioInputs.length}:v=0:a=1[${clipAudioLabel}]`
  );

  return { clipAudioLabel };
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

function appendTimelineImageOverlayFilters(input: {
  imagePlacements: ReturnType<typeof getTimelineImagePlacements>;
  inputsByAssetId: Map<string, ResolvedExportInput>;
  warnings: string[];
  filterParts: string[];
  width: number;
  height: number;
  baseVideoLabel: string;
}): string {
  let currentVideoLabel = input.baseVideoLabel;

  input.imagePlacements.forEach((placement, index) => {
    const inputRef = input.inputsByAssetId.get(placement.item.assetId);
    if (!inputRef) {
      input.warnings.push(`Image track item "${placement.item.label}" is missing its source file.`);
      return;
    }

    const geometry = buildShortExportGeometry({
      sourceWidth: inputRef.asset.width ?? input.width,
      sourceHeight: inputRef.asset.height ?? input.height,
      editor: placement.item.canvas,
      previewViewport: {
        width: input.width,
        height: input.height,
      },
      outputWidth: input.width,
      outputHeight: input.height,
    });
    const imageLabel = `img${index}`;
    const outputLabel = index === input.imagePlacements.length - 1 ? "video_track" : `image_overlay_${index}`;
    input.filterParts.push(`[${inputRef.inputIndex}:v]${geometry.filter}[${imageLabel}]`);
    input.filterParts.push(`[${currentVideoLabel}][${imageLabel}]overlay=shortest=1:eof_action=pass[${outputLabel}]`);
    currentVideoLabel = outputLabel;
  });

  return currentVideoLabel;
}

export function buildEditorExportPlan(input: {
  project: EditorProjectRecord;
  inputs: ResolvedExportInput[];
  resolution: EditorResolution;
  includeAudio?: boolean;
}): EditorExportPlan {
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);
  const imagePlacements = getTimelineImagePlacements(input.project);
  const inputsByAssetId = new Map(input.inputs.map((item) => [item.assetId, item]));
  const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
  const includeAudio = input.includeAudio !== false;
  const durationSeconds = roundMs(Math.max(getProjectDuration(input.project), 0.5));

  if (placements.length === 0 && imagePlacements.length === 0) {
    throw new Error("Export plan requires at least one timeline clip or image track item.");
  }

  const warnings: string[] = [];
  const filterParts: string[] = [];
  const concatVideoInputs: string[] = [];
  const concatInterleavedInputs: string[] = [];
  const baseVideoLabel = imagePlacements.length > 0 ? "video_track_base" : "video_track";

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
    filterParts.push(`[${inputRef.inputIndex}:v]${videoFilters.join(",")}[${videoLabel}]`);

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
  }

  if (placements.length > 0 && concatVideoInputs.length === 0 && imagePlacements.length === 0) {
    throw new Error("Export plan could not resolve any timeline video inputs.");
  }

  let mixedAudioLabel: string | null = null;
  if (concatVideoInputs.length > 0) {
    if (includeAudio) {
      filterParts.push(
        `${concatInterleavedInputs.join("")}concat=n=${concatVideoInputs.length}:v=1:a=1[${baseVideoLabel}][clip_audio_track]`
      );
      mixedAudioLabel = appendTimelineAudioMixFilters({
        project: input.project,
        inputsByAssetId,
        warnings,
        filterParts,
        baseAudioLabel: "clip_audio_track",
      });
    } else {
      filterParts.push(`${concatVideoInputs.join("")}concat=n=${concatVideoInputs.length}:v=1:a=0[${baseVideoLabel}]`);
    }
  } else {
    filterParts.push(
      `color=c=black:s=${width}x${height}:d=${durationSeconds.toFixed(3)}[${baseVideoLabel}]`
    );
    if (includeAudio && input.project.timeline.audioItems.length > 0) {
      filterParts.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${durationSeconds.toFixed(3)}[clip_audio_track]`
      );
      mixedAudioLabel = appendTimelineAudioMixFilters({
        project: input.project,
        inputsByAssetId,
        warnings,
        filterParts,
        baseAudioLabel: "clip_audio_track",
      });
    }
  }

  const videoTrackLabel =
    imagePlacements.length > 0
      ? appendTimelineImageOverlayFilters({
          imagePlacements,
          inputsByAssetId,
          warnings,
          filterParts,
          width,
          height,
          baseVideoLabel,
        })
      : baseVideoLabel;

  const ffmpegArgs = input.inputs.flatMap((item) => buildInputArgs(item));

  return {
    width,
    height,
    durationSeconds,
    inputs: input.inputs,
    ffmpegArgs,
    filterComplex: filterParts.join(";"),
    warnings,
    videoTrackLabel,
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
  const durationSeconds = roundMs(Math.max(getProjectDuration(input.project), 0.5));

  if (placements.length === 0 && input.project.timeline.audioItems.length === 0) {
    throw new Error("Audio export plan requires clip audio or at least one timeline audio item.");
  }

  const { clipAudioLabel } = appendClipAudioFilters({
    placements,
    inputsByAssetId,
    warnings,
    filterParts,
    durationSeconds,
  });

  const mixedAudioLabel =
    input.project.timeline.audioItems.length > 0
      ? appendTimelineAudioMixFilters({
          project: input.project,
          inputsByAssetId,
          warnings,
          filterParts,
          baseAudioLabel: clipAudioLabel,
        })
      : clipAudioLabel;
  const ffmpegArgs = input.inputs.flatMap((item) => buildInputArgs(item));

  return {
    durationSeconds,
    inputs: input.inputs,
    ffmpegArgs,
    filterComplex: filterParts.join(";"),
    warnings,
    mixedAudioLabel,
  };
}
