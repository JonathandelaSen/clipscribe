import { createEditorAssetRecord, createEmptyEditorProject } from "@/lib/editor/storage";
import type { EditorExternalSourceRef } from "@/lib/editor/types";
import { readMediaMetadata } from "@/lib/editor/media";
import { sortHistoryItems, type HistoryItem } from "@/lib/history";
import type { ContentProjectRecord, ProjectAssetRecord } from "@/lib/projects/types";

function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function getAssetSourceDefaults(externalSource?: EditorExternalSourceRef) {
  if (externalSource?.kind === "youtube") {
    return {
      origin: "youtube-import" as const,
      sourceType: "youtube" as const,
    };
  }

  return {
    origin: "upload" as const,
    sourceType: "upload" as const,
  };
}

export async function createProjectAssetFromFile(input: {
  projectId: string;
  file: File;
  now?: number;
  externalSource?: EditorExternalSourceRef;
}): Promise<ProjectAssetRecord> {
  const metadata = await readMediaMetadata(input.file);
  const now = input.now ?? Date.now();
  const sourceDefaults = getAssetSourceDefaults(input.externalSource);

  return createEditorAssetRecord({
    projectId: input.projectId,
    role: metadata.kind === "image" ? "support" : "source",
    origin: sourceDefaults.origin,
    kind: metadata.kind,
    filename: input.file.name,
    mimeType:
      input.file.type ||
      (metadata.kind === "video"
        ? "video/mp4"
        : metadata.kind === "image"
          ? "image/png"
          : "audio/mpeg"),
    sizeBytes: input.file.size,
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    hasAudio: metadata.hasAudio,
    sourceType: sourceDefaults.sourceType,
    externalSource: input.externalSource,
    captionSource: { kind: "none" },
    fileBlob: input.file,
    now,
  }) as ProjectAssetRecord;
}

export async function createProjectImageAssetFromFile(input: {
  projectId: string;
  file: File;
  now?: number;
}): Promise<ProjectAssetRecord> {
  const metadata = await readMediaMetadata(input.file);
  const now = input.now ?? Date.now();

  return createEditorAssetRecord({
    projectId: input.projectId,
    role: "support",
    origin: "ai-image",
    kind: "image",
    filename: input.file.name,
    mimeType: input.file.type || "image/png",
    sizeBytes: input.file.size,
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    hasAudio: false,
    sourceType: "upload",
    captionSource: { kind: "none" },
    fileBlob: input.file,
    now,
  }) as ProjectAssetRecord;
}

export async function createProjectFromSourceFile(input: {
  file: File;
  now?: number;
  externalSource?: EditorExternalSourceRef;
}): Promise<{ project: ContentProjectRecord; asset: ProjectAssetRecord }> {
  const now = input.now ?? Date.now();
  const project = createEmptyEditorProject({
    now,
    name: fileStem(input.file.name) || "Untitled Project",
  }) as ContentProjectRecord;
  const asset = await createProjectAssetFromFile({
    projectId: project.id,
    file: input.file,
    now,
    externalSource: input.externalSource,
  });

  project.assetIds = [asset.id];
  project.activeSourceAssetId = asset.role === "source" ? asset.id : undefined;

  return { project, asset };
}

export function createEmptyContentProject(input?: {
  name?: string;
  now?: number;
}): ContentProjectRecord {
  return createEmptyEditorProject({
    now: input?.now,
    name: input?.name?.trim() || "Untitled Project",
  }) as ContentProjectRecord;
}

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

export type ProjectSourceHistoryItem = HistoryItem & { projectId?: string };

export function projectSourceAssetToHistoryItem(asset: ProjectAssetRecord): ProjectSourceHistoryItem {
  return {
    id: asset.id,
    mediaId: asset.id,
    filename: asset.filename,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    timestamp: asset.updatedAt ?? asset.createdAt,
    activeTranscriptVersionId: undefined,
    transcripts: [],
    projectId: asset.projectId,
  };
}

export function mergeProjectSourceAssetsWithHistory(
  history: ProjectSourceHistoryItem[],
  assets: ProjectAssetRecord[]
): ProjectSourceHistoryItem[] {
  const itemsById = new Map(history.map((item) => [item.id, item]));

  for (const asset of getSelectableProjectSourceAssets(assets)) {
    if (!itemsById.has(asset.id)) {
      itemsById.set(asset.id, projectSourceAssetToHistoryItem(asset));
    }
  }

  return sortHistoryItems([...itemsById.values()]) as ProjectSourceHistoryItem[];
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
