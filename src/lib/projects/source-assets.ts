import type { ProjectAssetRecord } from "@/lib/projects/types";

export function isSelectableProjectSourceAsset(
  asset: Pick<ProjectAssetRecord, "kind">
): boolean {
  return asset.kind === "audio" || asset.kind === "video";
}

export function isSelectableProjectVisualAsset(
  asset: Pick<ProjectAssetRecord, "kind">
): boolean {
  return asset.kind === "video" || asset.kind === "image";
}

export function getSelectableProjectSourceAssets(
  assets: ProjectAssetRecord[]
): ProjectAssetRecord[] {
  return assets.filter(isSelectableProjectSourceAsset);
}

export function getSelectableProjectVisualAssets(
  assets: ProjectAssetRecord[]
): ProjectAssetRecord[] {
  return assets.filter(isSelectableProjectVisualAsset);
}

export function getActiveProjectSourceAsset(
  assets: ProjectAssetRecord[],
  activeSourceAssetId?: string
): ProjectAssetRecord | undefined {
  const selectableAssets = getSelectableProjectSourceAssets(assets);
  if (selectableAssets.length === 0) return undefined;

  return (
    selectableAssets.find((asset) => asset.id === activeSourceAssetId) ??
    selectableAssets[0]
  );
}
