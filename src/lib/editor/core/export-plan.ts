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

export function buildEditorExportPlan(input: {
  project: EditorProjectRecord;
  inputs: ResolvedExportInput[];
  resolution: EditorResolution;
}): EditorExportPlan {
  const placements = getTimelineClipPlacements(input.project.timeline.videoClips);
  const inputsByAssetId = new Map(input.inputs.map((item) => [item.assetId, item]));
  const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);

  const warnings: string[] = [];
  const filterParts: string[] = [];
  const segmentVideoLabels: string[] = [];
  const segmentAudioLabels: string[] = [];

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
    filterParts.push(
      `[${inputRef.inputIndex}:v]trim=start=${placement.clip.trimStartSeconds}:end=${placement.clip.trimEndSeconds},setpts=PTS-STARTPTS,${geometry.filter}[${videoLabel}]`
    );
    segmentVideoLabels.push(`[${videoLabel}]`);

    if (inputRef.asset.hasAudio && !placement.clip.muted && placement.clip.volume > 0) {
      const audioLabel = `aseg${placement.index}`;
      filterParts.push(
        `[${inputRef.inputIndex}:a]atrim=start=${placement.clip.trimStartSeconds}:end=${placement.clip.trimEndSeconds},asetpts=PTS-STARTPTS,volume=${placement.clip.volume.toFixed(
          3
        )}[${audioLabel}]`
      );
    } else {
      const audioLabel = `aseg${placement.index}`;
      filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${placement.durationSeconds.toFixed(3)}[${audioLabel}]`);
    }
    segmentAudioLabels.push(`[aseg${placement.index}]`);
  }

  const concatVideoLabel = "video_track";
  const concatAudioLabel = "clip_audio_track";
  if (segmentVideoLabels.length === 0) {
    throw new Error("Export plan requires at least one timeline clip.");
  }

  const concatParts = [...segmentVideoLabels, ...segmentAudioLabels];
  filterParts.push(
    `${concatParts.join("")}concat=n=${segmentVideoLabels.length}:v=1:a=1[${concatVideoLabel}][${concatAudioLabel}]`
  );

  let mixedAudioLabel: string | null = concatAudioLabel;
  input.project.timeline.audioItems.forEach((audioItem, index) => {
    const audioInputRef = inputsByAssetId.get(audioItem.assetId);
    if (!audioInputRef) {
      warnings.push(`Audio track item ${index + 1} is missing its source file.`);
      return;
    }

    const trackLabel = `music_track_${index}`;
    const delayMs = Math.round(Math.max(0, audioItem.startOffsetSeconds) * 1000);
    filterParts.push(
      `[${audioInputRef.inputIndex}:a]atrim=start=${audioItem.trimStartSeconds}:end=${audioItem.trimEndSeconds},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=${audioItem.muted ? 0 : audioItem.volume.toFixed(
        3
      )}[${trackLabel}]`
    );
    if (mixedAudioLabel) {
      const nextMixedLabel = `mixed_audio_${index}`;
      filterParts.push(`[${mixedAudioLabel}][${trackLabel}]amix=inputs=2:duration=longest:dropout_transition=0[${nextMixedLabel}]`);
      mixedAudioLabel = nextMixedLabel;
    } else {
      mixedAudioLabel = trackLabel;
    }
  });

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
