import { db, type AudioTranscriberDB, type MediaFile } from "@/lib/db";
import type { EditorAssetRecord, EditorExportRecord, EditorProjectRecord } from "@/lib/editor/types";

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
  getHistoryMediaFile(mediaId: string): Promise<MediaFile | undefined>;
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

export function createDexieEditorRepository(database: AudioTranscriberDB = db): EditorRepository {
  return {
    async listProjects() {
      const records = await database.editorProjects.toArray();
      return sortEditorProjects(records || []);
    },

    async getProject(projectId) {
      return database.editorProjects.get(projectId);
    },

    async listProjectAssets(projectId) {
      return database.editorAssets.where("projectId").equals(projectId).toArray();
    },

    async listProjectExports(projectId) {
      const records = await database.editorExports.where("projectId").equals(projectId).toArray();
      return sortEditorExports(records || []);
    },

    async putProject(record) {
      await database.editorProjects.put(record);
    },

    async putProjectWithAssets(record, assets) {
      await database.transaction("rw", database.editorProjects, database.editorAssets, async () => {
        if (assets.length > 0) {
          await database.editorAssets.bulkPut(assets);
        }
        await database.editorProjects.put(record);
      });
    },

    async bulkPutAssets(records) {
      if (records.length === 0) return;
      await database.editorAssets.bulkPut(records);
    },

    async deleteAsset(assetId) {
      await database.editorAssets.delete(assetId);
    },

    async putExport(record) {
      await database.editorExports.put(record);
    },

    async deleteProject(projectId) {
      await database.transaction("rw", database.editorProjects, database.editorAssets, database.editorExports, async () => {
        await database.editorProjects.delete(projectId);
        await database.editorAssets.where("projectId").equals(projectId).delete();
        await database.editorExports.where("projectId").equals(projectId).delete();
      });
    },

    async getHistoryMediaFile(mediaId) {
      return database.mediaFiles.get(mediaId);
    },
  };
}
