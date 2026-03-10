import type {
  ComposerAssetRecord,
  ComposerExportSettings,
  ComposerTimelineItem,
} from "../types";
import { buildComposerItemGeometry } from "./geometry";
import { getComposerExportPreset, type ComposerExportPreset } from "./export-presets";
import {
  computeProjectDurationSeconds,
  computeTimelineItemEndSeconds,
  sortTimelineItems,
} from "./timeline";

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}

function formatSeconds(value: number): string {
  return round3(value).toFixed(3);
}

export interface ComposerRenderInputDescriptor {
  itemId: string;
  assetId: string;
  assetFilename: string;
  inputIndex: number;
  lane: ComposerTimelineItem["lane"];
  sourceStartSeconds: number;
  timelineStartSeconds: number;
  durationSeconds: number;
  includeVideo: boolean;
  includeAudio: boolean;
  volume: number;
  muted: boolean;
}

export interface ComposerRenderPlan {
  durationSeconds: number;
  outputFilename: string;
  preset: ComposerExportPreset;
  inputDescriptors: ComposerRenderInputDescriptor[];
  filterComplex: string;
  mapVideoLabel: string;
  mapAudioLabel?: string;
  videoItemCount: number;
  audioSourceCount: number;
  notes: string[];
}

export function buildComposerRenderPlan(input: {
  items: ComposerTimelineItem[];
  assets: ComposerAssetRecord[];
  exportSettings: ComposerExportSettings;
  outputBasename: string;
}): ComposerRenderPlan {
  const preset = getComposerExportPreset(input.exportSettings);
  const sortedItems = sortTimelineItems(input.items).filter((item) => item.durationSeconds > 0);
  const durationSeconds = Math.max(0.01, computeProjectDurationSeconds(sortedItems));
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const notes: string[] = [];

  const inputDescriptors = sortedItems.map((item, index) => {
    const asset = assetById.get(item.assetId);
    if (!asset) {
      throw new Error(`Missing composer asset for timeline item ${item.id}`);
    }

    return {
      itemId: item.id,
      assetId: item.assetId,
      assetFilename: asset.filename,
      inputIndex: index + 1,
      lane: item.lane,
      sourceStartSeconds: item.sourceStartSeconds,
      timelineStartSeconds: item.timelineStartSeconds,
      durationSeconds: item.durationSeconds,
      includeVideo: item.lane === "video",
      includeAudio: !item.muted && item.volume > 0 && (item.lane === "audio" || asset.hasAudio),
      volume: item.volume,
      muted: item.muted,
    } satisfies ComposerRenderInputDescriptor;
  });

  const filterLines: string[] = [
    `[0:v]trim=duration=${formatSeconds(durationSeconds)},setpts=PTS-STARTPTS[vbase0]`,
  ];

  const videoDescriptors = inputDescriptors
    .filter((descriptor) => descriptor.includeVideo)
    .sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds);

  if (videoDescriptors.length === 0) {
    filterLines.push("[vbase0]null[vout]");
    notes.push("No video clips active on the timeline. Output will stay on a black canvas.");
  } else {
    let currentLabel = "vbase0";
    for (const [index, descriptor] of videoDescriptors.entries()) {
      const item = sortedItems.find((candidate) => candidate.id === descriptor.itemId);
      const asset = assetById.get(descriptor.assetId);
      if (!item || !asset || !asset.width || !asset.height) {
        throw new Error(`Video asset metadata incomplete for timeline item ${descriptor.itemId}`);
      }

      const geometry = buildComposerItemGeometry({
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        outputWidth: preset.width,
        outputHeight: preset.height,
        fitMode: item.fitMode ?? "fill",
        offsetX: item.offsetX ?? 0,
        offsetY: item.offsetY ?? 0,
      });
      const clipLabel = `vclip${index}`;
      const outputLabel = index === videoDescriptors.length - 1 ? "vout" : `vbase${index + 1}`;

      filterLines.push(
        `[${descriptor.inputIndex}:v]trim=start=${formatSeconds(descriptor.sourceStartSeconds)}:duration=${formatSeconds(descriptor.durationSeconds)},setpts=PTS-STARTPTS,${geometry.filter}[${clipLabel}]`
      );
      filterLines.push(
        `[${currentLabel}][${clipLabel}]overlay=0:0:shortest=0:enable='between(t,${formatSeconds(descriptor.timelineStartSeconds)},${formatSeconds(
          computeTimelineItemEndSeconds(item)
        )})'[${outputLabel}]`
      );
      currentLabel = outputLabel;
    }
  }

  const audioDescriptors = inputDescriptors.filter((descriptor) => descriptor.includeAudio);
  for (const [index, descriptor] of audioDescriptors.entries()) {
    const delayMs = Math.max(0, Math.round(descriptor.timelineStartSeconds * 1000));
    filterLines.push(
      `[${descriptor.inputIndex}:a]atrim=start=${formatSeconds(descriptor.sourceStartSeconds)}:duration=${formatSeconds(descriptor.durationSeconds)},asetpts=PTS-STARTPTS,volume=${descriptor.volume.toFixed(
        3
      )},adelay=${delayMs}|${delayMs}[a${index}]`
    );
  }

  let mapAudioLabel: string | undefined;
  if (audioDescriptors.length === 1) {
    mapAudioLabel = "a0";
  } else if (audioDescriptors.length > 1) {
    const labels = audioDescriptors.map((_, index) => `[a${index}]`).join("");
    filterLines.push(`${labels}amix=inputs=${audioDescriptors.length}:normalize=0:dropout_transition=0[aout]`);
    mapAudioLabel = "aout";
  } else {
    notes.push("No active audio sources. Output will be silent.");
  }

  const lastVideoEnd = videoDescriptors.reduce((maxEnd, descriptor) => {
    const item = sortedItems.find((candidate) => candidate.id === descriptor.itemId);
    return Math.max(maxEnd, item ? computeTimelineItemEndSeconds(item) : 0);
  }, 0);
  if (durationSeconds > lastVideoEnd + 0.001) {
    notes.push("Output duration extends past the last visible video clip; black frames will cover the tail.");
  }

  for (const descriptor of inputDescriptors) {
    const asset = assetById.get(descriptor.assetId);
    if (descriptor.lane === "video" && asset && !asset.hasAudio) {
      notes.push(`Video clip "${asset.filename}" has no embedded audio track.`);
    }
    if (descriptor.lane === "video" && descriptor.muted) {
      notes.push(`Video clip "${descriptor.assetFilename}" is muted in the final mix.`);
    }
  }

  return {
    durationSeconds,
    outputFilename: `${sanitizeFilename(input.outputBasename)}__${input.exportSettings.ratio.replace(":", "x")}__${preset.resolution}.mp4`,
    preset,
    inputDescriptors,
    filterComplex: filterLines.join(";"),
    mapVideoLabel: "vout",
    mapAudioLabel,
    videoItemCount: videoDescriptors.length,
    audioSourceCount: audioDescriptors.length,
    notes,
  };
}
