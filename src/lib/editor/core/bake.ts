import { createEmptyEditorProject } from "../storage";
import type { EditorProjectRecord, TimelineClipPlacement } from "../types";

export interface PreparedTimelineClipBake {
  bakeProject: EditorProjectRecord;
  bakedClipIds: string[];
  bakedLabel: string;
  requiredAssetIds: string[];
}

export function prepareTimelineClipBake(input: {
  project: EditorProjectRecord;
  clipPlacements: TimelineClipPlacement[];
}): PreparedTimelineClipBake {
  const clipPlacements = [...input.clipPlacements].sort((left, right) => left.index - right.index);
  const bakedClipIds = clipPlacements.map((placement) => placement.clip.id);
  const requiredAssetIds = [...new Set(clipPlacements.map((placement) => placement.clip.assetId))];
  const bakedLabel = clipPlacements.map((placement) => placement.clip.label).join(" + ");

  const bakeProject = createEmptyEditorProject({
    name: `${bakedLabel} baked`,
    aspectRatio: input.project.aspectRatio,
  });

  bakeProject.assetIds = requiredAssetIds;
  bakeProject.timeline.videoClips = clipPlacements.map((placement) => ({
    ...placement.clip,
    canvas: { ...placement.clip.canvas },
    actions: { ...placement.clip.actions },
  }));
  bakeProject.timeline.videoClipGroups = [];
  bakeProject.timeline.audioItems = [];
  bakeProject.timeline.selectedItem = clipPlacements[0]
    ? { kind: "video", id: clipPlacements[0].clip.id }
    : undefined;
  bakeProject.subtitles = {
    ...input.project.subtitles,
    enabled: false,
  };

  return {
    bakeProject,
    bakedClipIds,
    bakedLabel,
    requiredAssetIds,
  };
}
