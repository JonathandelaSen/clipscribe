import type { AudioTranscriberDB } from "@/lib/db";
import type { CreatorShortExportRecord, CreatorShortProjectRecord } from "@/lib/creator/storage";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type { ProjectExportRecord } from "@/lib/projects/types";

export interface CreatorShortsRepository {
  listProjects(projectId?: string): Promise<CreatorShortProjectRecord[]>;
  listExports(projectId?: string): Promise<CreatorShortExportRecord[]>;
  putProject(record: CreatorShortProjectRecord): Promise<void>;
  putExport(record: CreatorShortExportRecord): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

export function sortCreatorShortProjects(records: CreatorShortProjectRecord[]): CreatorShortProjectRecord[] {
  return [...records].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function sortCreatorShortExports(records: CreatorShortExportRecord[]): CreatorShortExportRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

export function groupCreatorShortExportsByProjectId(exports: CreatorShortExportRecord[]): Map<string, CreatorShortExportRecord[]> {
  const map = new Map<string, CreatorShortExportRecord[]>();
  for (const exportRecord of exports) {
    const list = map.get(exportRecord.shortProjectId) ?? [];
    list.push(exportRecord);
    map.set(exportRecord.shortProjectId, list);
  }
  return map;
}

function toCreatorShortExportRecord(record: ProjectExportRecord): CreatorShortExportRecord {
  return {
    id: record.id,
    shortProjectId: record.shortProjectId || "",
    projectId: record.projectId,
    sourceAssetId: record.sourceAssetId,
    outputAssetId: record.outputAssetId,
    sourceFilename: record.sourceFilename ?? record.filename,
    platform: record.platform || "youtube_shorts",
    createdAt: record.createdAt,
    status: record.status,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    fileBlob: undefined,
    debugFfmpegCommand: record.debugFfmpegCommand,
    debugNotes: record.debugNotes,
    clip: record.clip!,
    plan: record.plan!,
    editor: record.editor!,
    error: record.error,
  };
}

export function createDexieCreatorShortsRepository(database?: AudioTranscriberDB): CreatorShortsRepository {
  const projectRepository = createDexieProjectRepository(database);
  return {
    async listProjects(projectId?: string) {
      const records = await projectRepository.listShortProjects(projectId);
      return sortCreatorShortProjects(records || []);
    },

    async listExports(projectId?: string) {
      const records = await projectRepository.listProjectExports(projectId);
      const shortExports = records
          .filter((record) => record.kind === "short" && record.shortProjectId && record.clip && record.plan && record.editor)
          .map((record) => toCreatorShortExportRecord(record));
      const hydrated = await Promise.all(
        shortExports.map(async (record) => {
          if (!record.outputAssetId) return record;
          const asset = await projectRepository.getAsset(record.outputAssetId);
          return {
            ...record,
            fileBlob: asset?.fileBlob,
          };
        })
      );
      return sortCreatorShortExports(hydrated);
    },

    async putProject(record) {
      await projectRepository.putShortProject(record);
    },

    async putExport(record) {
      await projectRepository.putProjectExport({
        id: record.id,
        kind: "short",
        projectId: record.projectId,
        shortProjectId: record.shortProjectId,
        sourceAssetId: record.sourceAssetId,
        outputAssetId: record.outputAssetId,
        createdAt: record.createdAt,
        status: record.status,
        filename: record.filename,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        platform: record.platform,
        error: record.error,
        debugFfmpegCommand: record.debugFfmpegCommand,
        debugNotes: record.debugNotes,
        clip: record.clip,
        plan: record.plan,
        editor: record.editor,
        sourceFilename: record.sourceFilename,
      } as ProjectExportRecord & { sourceFilename?: string });
    },

    async deleteProject(projectId) {
      await projectRepository.deleteShortProject(projectId);
    },
  };
}
