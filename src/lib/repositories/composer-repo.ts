import { db, type AudioTranscriberDB } from "@/lib/db";
import type {
  ComposerAssetFileRecord,
  ComposerAssetRecord,
  ComposerExportRecord,
  ComposerProjectRecord,
} from "@/lib/composer/types";

export interface ComposerRepository {
  listProjects(): Promise<ComposerProjectRecord[]>;
  getProject(projectId: string): Promise<ComposerProjectRecord | undefined>;
  listAssets(projectId: string): Promise<ComposerAssetRecord[]>;
  listExports(projectId: string): Promise<ComposerExportRecord[]>;
  getAssetFile(fileId: string): Promise<ComposerAssetFileRecord | undefined>;
  putProject(record: ComposerProjectRecord): Promise<void>;
  putAsset(record: ComposerAssetRecord): Promise<void>;
  putAssetFile(record: ComposerAssetFileRecord): Promise<void>;
  putExport(record: ComposerExportRecord): Promise<void>;
  deleteAsset(assetId: string, fileId: string): Promise<void>;
}

export function sortComposerProjects(records: ComposerProjectRecord[]): ComposerProjectRecord[] {
  return [...records].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function sortComposerAssets(records: ComposerAssetRecord[]): ComposerAssetRecord[] {
  return [...records].sort((a, b) => a.createdAt - b.createdAt || a.filename.localeCompare(b.filename));
}

export function sortComposerExports(records: ComposerExportRecord[]): ComposerExportRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

export function createDexieComposerRepository(database: AudioTranscriberDB = db): ComposerRepository {
  return {
    async listProjects() {
      const records = await database.composerProjects.toArray();
      return sortComposerProjects(records || []);
    },

    async getProject(projectId) {
      return database.composerProjects.get(projectId);
    },

    async listAssets(projectId) {
      const records = await database.composerAssets.where("projectId").equals(projectId).toArray();
      return sortComposerAssets(records || []);
    },

    async listExports(projectId) {
      const records = await database.composerExports.where("projectId").equals(projectId).toArray();
      return sortComposerExports(records || []);
    },

    async getAssetFile(fileId) {
      return database.composerAssetFiles.get(fileId);
    },

    async putProject(record) {
      await database.composerProjects.put(record);
    },

    async putAsset(record) {
      await database.composerAssets.put(record);
    },

    async putAssetFile(record) {
      await database.composerAssetFiles.put(record);
    },

    async putExport(record) {
      await database.composerExports.put(record);
    },

    async deleteAsset(assetId, fileId) {
      await database.transaction("rw", database.composerAssets, database.composerAssetFiles, async () => {
        await database.composerAssets.delete(assetId);
        await database.composerAssetFiles.delete(fileId);
      });
    },
  };
}

