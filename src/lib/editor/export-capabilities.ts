import type {
  EditorAssetRecord,
  EditorExportEngine,
  EditorProjectRecord,
  EditorResolution,
} from "./types";

export const EDITOR_EXPORT_ENGINE_LABELS: Record<EditorExportEngine, string> = {
  browser: "FFmpeg.wasm",
  system: "System FFmpeg",
};

export const EDITOR_EXPORT_OUTPUT_LABEL = "MP4 video";

export interface EditorExportCapabilityResult {
  supported: boolean;
  reasons: string[];
}

type AssetWithRecord = {
  asset: Pick<EditorAssetRecord, "id" | "filename" | "sourceType" | "captionSource">;
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

  for (const { asset } of relevantAssets) {
    if (asset.sourceType !== "upload") {
      reasons.push(`System FFmpeg supports upload assets only. "${asset.filename}" must use browser export.`);
    }
    if (asset.captionSource.kind !== "none") {
      reasons.push(`System FFmpeg does not support subtitle burn-in yet. "${asset.filename}" has attached captions.`);
    }
  }

  return reasons;
}

export function getEditorExportCapability(input: {
  engine: EditorExportEngine;
  project: EditorProjectRecord;
  assets: readonly AssetWithRecord[];
}): EditorExportCapabilityResult {
  const reasons =
    input.engine === "system"
      ? getSystemExportReasons(input.project, input.assets)
      : input.project.timeline.videoClips.length === 0 && input.project.timeline.imageItems.length === 0
        ? ["Add at least one video clip or image track item to export the project."]
        : [];

  return {
    supported: reasons.length === 0,
    reasons,
  };
}
