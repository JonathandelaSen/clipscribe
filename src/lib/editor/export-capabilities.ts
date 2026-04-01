import type {
  EditorAssetRecord,
  EditorProjectRecord,
  EditorResolution,
} from "./types";

export const EDITOR_EXPORT_ENGINE_LABELS = {
  system: "System FFmpeg",
} as const;
export const EDITOR_EXPORT_ENGINE_LABEL = EDITOR_EXPORT_ENGINE_LABELS.system;

export const EDITOR_EXPORT_OUTPUT_LABEL = "MP4 video";

export interface EditorExportCapabilityResult {
  supported: boolean;
  reasons: string[];
}

type AssetWithRecord = {
  asset: Pick<EditorAssetRecord, "id" | "filename">;
};

export function getEditorExportOutputLabel(resolution: EditorResolution): string {
  return `${EDITOR_EXPORT_OUTPUT_LABEL} · ${resolution}`;
}

export function getEditorExportReferencedAssetIds(project: EditorProjectRecord): Set<string> {
  const assetIds = new Set<string>();

  for (const clip of project.timeline.videoClips) {
    assetIds.add(clip.assetId);
  }
  for (const item of project.timeline.imageItems) {
    assetIds.add(item.assetId);
  }
  for (const item of project.timeline.audioItems) {
    assetIds.add(item.assetId);
  }

  return assetIds;
}

export function filterEditorAssetsForExport<T extends { asset: Pick<EditorAssetRecord, "id"> }>(
  project: EditorProjectRecord,
  assets: readonly T[]
): T[] {
  const referencedAssetIds = getEditorExportReferencedAssetIds(project);
  return assets.filter((entry) => referencedAssetIds.has(entry.asset.id));
}

function getSystemExportReasons(
  project: EditorProjectRecord,
  assets: readonly AssetWithRecord[]
): string[] {
  const reasons: string[] = [];

  if (project.timeline.videoClips.length === 0 && project.timeline.imageItems.length === 0) {
    reasons.push("Add at least one video clip or image track item to export the project.");
    return reasons;
  }

  const relevantAssets = filterEditorAssetsForExport(project, assets);
  const referencedAssetIds = getEditorExportReferencedAssetIds(project);
  if (relevantAssets.length !== referencedAssetIds.size) {
    reasons.push("One or more timeline assets are unavailable for system export. Reattach them before exporting.");
  }

  return reasons;
}

export function getEditorExportCapability(input: {
  project: EditorProjectRecord;
  assets: readonly AssetWithRecord[];
}): EditorExportCapabilityResult {
  const reasons = getSystemExportReasons(input.project, input.assets);
  return {
    supported: reasons.length === 0,
    reasons,
  };
}
