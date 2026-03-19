import type { AudioTranscriberDB } from "@/lib/db";
import type { EditorAssetRecord, EditorExportRecord, EditorProjectRecord } from "@/lib/editor/types";
import { normalizeLegacyEditorExportRecord, normalizeLegacyEditorProjectRecord } from "@/lib/editor/storage";
import type { ProjectAssetRecord, ProjectExportRecord } from "@/lib/projects/types";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";

export interface EditorRepository {
  listProjects(): Promise<EditorProjectRecord[]>;
  getProject(projectId: string): Promise<EditorProjectRecord | undefined>;
  listProjectAssets(projectId: string): Promise<EditorAssetRecord[]>;
  listProjectExports(projectId: string): Promise<EditorExportRecord[]>;
  putProject(record: EditorProjectRecord): Promise<void>;
  putProjectWithAssets(record: EditorProjectRecord, assets: EditorAssetRecord[]): Promise<void>;
  bulkPutAssets(records: EditorAssetRecord[]): Promise<void>;
  deleteAsset(assetId: string): Promise<void>;
  putExport(record: EditorExportRecord): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  getAssetFile(assetId: string): Promise<{ id: string; file: File } | undefined>;
}

export function sortEditorProjects(records: EditorProjectRecord[]): EditorProjectRecord[] {
  return [...records].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function sortEditorExports(records: EditorExportRecord[]): EditorExportRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

export function groupEditorExportsByProjectId(records: EditorExportRecord[]): Map<string, EditorExportRecord[]> {
  const result = new Map<string, EditorExportRecord[]>();
  for (const record of records) {
    const list = result.get(record.projectId) ?? [];
    list.push(record);
    result.set(record.projectId, list);
  }
  return result;
}

function toProjectAssetRecord(asset: EditorAssetRecord): ProjectAssetRecord {
  return {
    ...asset,
    role: (asset as ProjectAssetRecord).role ?? "support",
    origin: (asset as ProjectAssetRecord).origin ?? (asset.sourceType === "history" ? "manual" : "upload"),
    derivedFromAssetId: (asset as ProjectAssetRecord).derivedFromAssetId,
  };
}

function toEditorExportRecord(record: ProjectExportRecord): EditorExportRecord {
  return normalizeLegacyEditorExportRecord({
    id: record.id,
    projectId: record.projectId,
    sourceAssetId: record.sourceAssetId,
    outputAssetId: record.outputAssetId,
    createdAt: record.createdAt,
    status: record.status,
    engine: record.engine === "system" ? "system" : "browser",
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    durationSeconds: record.durationSeconds ?? 0,
    aspectRatio: record.aspectRatio ?? "16:9",
    resolution: record.resolution === "720p" || record.resolution === "4K" ? record.resolution : "1080p",
    width: record.width ?? 0,
    height: record.height ?? 0,
    warnings: record.warnings,
    error: record.error,
    debugFfmpegCommand: record.debugFfmpegCommand,
    debugNotes: record.debugNotes,
  });
}

export function createDexieEditorRepository(database?: AudioTranscriberDB): EditorRepository {
  const projectRepository = createDexieProjectRepository(database);

  return {
    async listProjects() {
      const records = await projectRepository.listProjects();
      return sortEditorProjects(records.map((project) => normalizeLegacyEditorProjectRecord(project)));
    },

    async getProject(projectId) {
      const record = await projectRepository.getProject(projectId);
      return record ? normalizeLegacyEditorProjectRecord(record) : undefined;
    },

    async listProjectAssets(projectId) {
      return (await projectRepository.listProjectAssets(projectId)) as EditorAssetRecord[];
    },

    async listProjectExports(projectId) {
      const records = await projectRepository.listProjectExports(projectId);
      return sortEditorExports(records.filter((record) => record.kind === "timeline").map((record) => toEditorExportRecord(record)));
    },

    async putProject(record) {
      await projectRepository.putProject(record);
    },

    async putProjectWithAssets(record, assets) {
      await projectRepository.putProject(record);
      await projectRepository.bulkPutAssets(assets.map((asset) => toProjectAssetRecord(asset)));
    },

    async bulkPutAssets(records) {
      await projectRepository.bulkPutAssets(records.map((record) => toProjectAssetRecord(record)));
    },

    async deleteAsset(assetId) {
      await projectRepository.deleteAsset(assetId);
    },

    async putExport(record) {
      await projectRepository.putProjectExport({
        ...record,
        kind: "timeline",
      });
    },

    async deleteProject(projectId) {
      await projectRepository.deleteProject(projectId);
    },

    async getAssetFile(assetId) {
      const asset = await projectRepository.getAsset(assetId);
      if (!asset?.fileBlob) return undefined;
      return { id: asset.id, file: asset.fileBlob };
    },
  };
}
