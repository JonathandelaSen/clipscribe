import { db, type AudioTranscriberDB } from "@/lib/db";
import { hydrateCreatorShortEditorState } from "@/lib/creator/core/text-overlays";
import { normalizeHistoryItem, sortHistoryItems, type HistoryItem } from "@/lib/history";
import type { CreatorShortProjectRecord } from "@/lib/creator/storage";
import type {
  AssetTranscriptRecord,
  ContentProjectRecord,
  ProjectAssetRecord,
  ProjectExportRecord,
  ProjectHistoryItem,
} from "@/lib/projects/types";

export interface ProjectRepository {
  listProjects(): Promise<ContentProjectRecord[]>;
  getProject(projectId: string): Promise<ContentProjectRecord | undefined>;
  putProject(record: ContentProjectRecord): Promise<void>;
  listProjectAssets(projectId: string): Promise<ProjectAssetRecord[]>;
  getAsset(assetId: string): Promise<ProjectAssetRecord | undefined>;
  bulkPutAssets(records: ProjectAssetRecord[]): Promise<void>;
  deleteAsset(assetId: string): Promise<void>;
  getAssetTranscript(assetId: string): Promise<AssetTranscriptRecord | undefined>;
  listProjectTranscripts(projectId?: string): Promise<AssetTranscriptRecord[]>;
  putAssetTranscript(record: AssetTranscriptRecord): Promise<void>;
  deleteAssetTranscript(assetId: string): Promise<void>;
  listShortProjects(projectId?: string): Promise<CreatorShortProjectRecord[]>;
  putShortProject(record: CreatorShortProjectRecord): Promise<void>;
  deleteShortProject(shortProjectId: string): Promise<void>;
  deleteShortProjects(shortProjectIds: string[]): Promise<void>;
  deleteShortProjectsBySuggestionGenerationId(generationId: string): Promise<void>;
  listProjectExports(projectId?: string): Promise<ProjectExportRecord[]>;
  putProjectExport(record: ProjectExportRecord): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  listProjectHistory(projectId?: string): Promise<ProjectHistoryItem[]>;
}

export function sortProjects(records: ContentProjectRecord[]): ContentProjectRecord[] {
  return [...records].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function sortProjectAssets(records: ProjectAssetRecord[]): ProjectAssetRecord[] {
  return [...records].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function sortProjectExports(records: ProjectExportRecord[]): ProjectExportRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

export function toHistoryItem(
  transcriptRecord: AssetTranscriptRecord,
  asset: ProjectAssetRecord
): ProjectHistoryItem {
  const item: HistoryItem = normalizeHistoryItem({
    id: transcriptRecord.assetId,
    mediaId: transcriptRecord.assetId,
    filename: asset.filename,
    createdAt: transcriptRecord.createdAt,
    updatedAt: transcriptRecord.updatedAt,
    timestamp: transcriptRecord.timestamp,
    activeTranscriptVersionId: transcriptRecord.activeTranscriptVersionId,
    transcripts: transcriptRecord.transcripts,
  });

  return {
    ...item,
    assetId: transcriptRecord.assetId,
    projectId: transcriptRecord.projectId,
  };
}

export function createDexieProjectRepository(database: AudioTranscriberDB = db): ProjectRepository {
  return {
    async listProjects() {
      return sortProjects(await database.projects.toArray());
    },

    async getProject(projectId) {
      return database.projects.get(projectId);
    },

    async putProject(record) {
      await database.projects.put(record);
    },

    async listProjectAssets(projectId) {
      return sortProjectAssets(await database.projectAssets.where("projectId").equals(projectId).toArray());
    },

    async getAsset(assetId) {
      return database.projectAssets.get(assetId);
    },

    async bulkPutAssets(records) {
      if (records.length === 0) return;
      await database.projectAssets.bulkPut(records);
    },

    async deleteAsset(assetId) {
      await database.transaction("rw", database.projectAssets, database.assetTranscripts, async () => {
        await database.projectAssets.delete(assetId);
        await database.assetTranscripts.delete(assetId);
      });
    },

    async getAssetTranscript(assetId) {
      return database.assetTranscripts.get(assetId);
    },

    async listProjectTranscripts(projectId) {
      if (!projectId) {
        return database.assetTranscripts.toArray();
      }
      return database.assetTranscripts.where("projectId").equals(projectId).toArray();
    },

    async putAssetTranscript(record) {
      await database.assetTranscripts.put(record);
    },

    async deleteAssetTranscript(assetId) {
      await database.assetTranscripts.delete(assetId);
    },

    async listShortProjects(projectId) {
      const records = projectId
        ? await database.projectShorts.where("projectId").equals(projectId).toArray()
        : await database.projectShorts.toArray();
      return [...records]
        .map((record) => ({
          ...record,
          editor: hydrateCreatorShortEditorState(record.editor, {
            origin: record.origin,
            plan: record.plan,
            clipDurationSeconds: record.clip?.durationSeconds,
          }),
        }))
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    },

    async putShortProject(record) {
      await database.projectShorts.put({
        ...record,
        editor: hydrateCreatorShortEditorState(record.editor, {
          origin: record.origin,
          plan: record.plan,
          clipDurationSeconds: record.clip?.durationSeconds,
        }),
      });
    },

    async deleteShortProject(shortProjectId) {
      await database.transaction("rw", database.projectShorts, database.projectExports, async () => {
        await database.projectShorts.delete(shortProjectId);
        const relatedExports = await database.projectExports.where("shortProjectId").equals(shortProjectId).toArray();
        await database.projectExports.bulkDelete(relatedExports.map((record) => record.id));
      });
    },

    async deleteShortProjects(shortProjectIds) {
      if (shortProjectIds.length === 0) return;

      await database.transaction("rw", database.projectShorts, database.projectExports, async () => {
        await database.projectShorts.bulkDelete(shortProjectIds);
        const relatedExports = await database.projectExports
          .filter((record) => !!record.shortProjectId && shortProjectIds.includes(record.shortProjectId))
          .toArray();
        await database.projectExports.bulkDelete(relatedExports.map((record) => record.id));
      });
    },

    async deleteShortProjectsBySuggestionGenerationId(generationId) {
      if (!generationId) return;

      await database.transaction("rw", database.projectShorts, database.projectExports, async () => {
        const projects = await database.projectShorts.where("suggestionGenerationId").equals(generationId).toArray();
        if (projects.length === 0) return;

        const projectIds = projects.map((record) => record.id);
        await database.projectShorts.bulkDelete(projectIds);

        const relatedExports = await database.projectExports
          .filter((record) => !!record.shortProjectId && projectIds.includes(record.shortProjectId))
          .toArray();
        await database.projectExports.bulkDelete(relatedExports.map((record) => record.id));
      });
    },

    async listProjectExports(projectId) {
      const records = projectId
        ? await database.projectExports.where("projectId").equals(projectId).toArray()
        : await database.projectExports.toArray();
      return sortProjectExports(records);
    },

    async putProjectExport(record) {
      await database.projectExports.put(record);
    },

    async deleteProject(projectId) {
      await database.transaction(
        "rw",
        [database.projects, database.projectAssets, database.assetTranscripts, database.projectShorts, database.projectExports],
        async () => {
          await database.projects.delete(projectId);

          const assets = await database.projectAssets.where("projectId").equals(projectId).toArray();
          await database.projectAssets.bulkDelete(assets.map((asset) => asset.id));
          await database.assetTranscripts.bulkDelete(assets.map((asset) => asset.id));

          const shorts = await database.projectShorts.where("projectId").equals(projectId).toArray();
          await database.projectShorts.bulkDelete(shorts.map((record) => record.id));

          const exports = await database.projectExports.where("projectId").equals(projectId).toArray();
          await database.projectExports.bulkDelete(exports.map((record) => record.id));
        }
      );
    },

    async listProjectHistory(projectId) {
      const [transcripts, assets] = await Promise.all([
        projectId
          ? database.assetTranscripts.where("projectId").equals(projectId).toArray()
          : database.assetTranscripts.toArray(),
        projectId
          ? database.projectAssets.where("projectId").equals(projectId).toArray()
          : database.projectAssets.toArray(),
      ]);

      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

      return sortHistoryItems(
        transcripts
          .map((record) => {
            const asset = assetsById.get(record.assetId);
            if (!asset) return null;
            return toHistoryItem(record, asset);
          })
          .filter((item): item is ProjectHistoryItem => item != null)
      ) as ProjectHistoryItem[];
    },
  };
}
