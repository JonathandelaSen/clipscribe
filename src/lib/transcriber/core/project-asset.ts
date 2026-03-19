import { createEditorAssetRecord, createEmptyEditorProject } from "../../editor/storage";
import type { ProjectRepository } from "../../repositories/project-repo";
import type { ContentProjectRecord, ProjectAssetRecord } from "../../projects/types";

export type TranscribeProjectAssetOptions = {
  projectId?: string;
  assetId?: string;
};

export function inferAssetKind(file: File): ProjectAssetRecord["kind"] {
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) return "video";
  return "audio";
}

export async function ensureProjectAssetForTranscription(
  repository: ProjectRepository,
  file: File,
  options: TranscribeProjectAssetOptions,
  durationSeconds: number
) {
  if (options.projectId && options.assetId) {
    const existingAsset = await repository.getAsset(options.assetId);
    if (!existingAsset) {
      throw new Error("Selected source asset no longer exists.");
    }

    const updatedAsset: ProjectAssetRecord = {
      ...existingAsset,
      filename: file.name,
      mimeType: file.type || existingAsset.mimeType,
      sizeBytes: file.size,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : existingAsset.durationSeconds,
      fileBlob: file,
      updatedAt: Date.now(),
    };
    await repository.bulkPutAssets([updatedAsset]);
    return { projectId: existingAsset.projectId, assetId: existingAsset.id };
  }

  const now = Date.now();
  const project = createEmptyEditorProject({
    id: options.projectId,
    now,
    name: file.name.replace(/\.[^.]+$/, "") || "Untitled Project",
  }) as ContentProjectRecord;
  const asset = createEditorAssetRecord({
    id: options.assetId,
    projectId: project.id,
    role: "source",
    origin: "upload",
    kind: inferAssetKind(file),
    filename: file.name,
    mimeType: file.type || (file.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "audio/mpeg"),
    sizeBytes: file.size,
    durationSeconds,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    fileBlob: file,
    now,
  });

  project.activeSourceAssetId = asset.id;
  project.assetIds = [asset.id];

  await repository.putProject(project);
  await repository.bulkPutAssets([asset]);
  return { projectId: project.id, assetId: asset.id };
}
