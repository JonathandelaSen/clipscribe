import type { AudioTranscriberDB } from "@/lib/db";
import { toCreatorShortPlan, toCreatorViralClip } from "@/lib/creator/shorts-compat";
import type { CreatorShortExportRecord, CreatorShortProjectRecord } from "@/lib/creator/storage";
import {
  sortCreatorShortExports,
  sortCreatorShortProjects,
} from "@/lib/creator/core/short-library";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type { ProjectExportRecord } from "@/lib/projects/types";

export interface CreatorShortsRepository {
  listProjects(projectId?: string): Promise<CreatorShortProjectRecord[]>;
  listExports(projectId?: string): Promise<CreatorShortExportRecord[]>;
  putProject(record: CreatorShortProjectRecord): Promise<void>;
  putExport(record: CreatorShortExportRecord): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  deleteProjects(projectIds: string[]): Promise<void>;
  deleteSuggestionGeneration(generationId: string): Promise<void>;
}

function toCreatorShortExportRecord(record: ProjectExportRecord): CreatorShortExportRecord {
  return {
    id: record.id,
    shortProjectId: record.shortProjectId || "",
    projectId: record.projectId,
    sourceAssetId: record.sourceAssetId,
    outputAssetId: record.outputAssetId,
    sourceFilename: record.sourceFilename ?? record.filename,

    createdAt: record.createdAt,
    status: record.status,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    fileBlob: undefined,
    debugFfmpegCommand: record.debugFfmpegCommand,
    debugNotes: record.debugNotes,
    clip: record.clip ?? toCreatorViralClip(record.short!),
    plan: record.plan ?? toCreatorShortPlan(record.short!),
    short: record.short!,
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
          .filter((record) => record.kind === "short" && record.shortProjectId && record.short && record.editor)
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

        error: record.error,
        debugFfmpegCommand: record.debugFfmpegCommand,
        debugNotes: record.debugNotes,
        clip: record.clip,
        plan: record.plan,
        short: record.short,
        editor: record.editor,
        sourceFilename: record.sourceFilename,
      } as ProjectExportRecord & { sourceFilename?: string });
    },

    async deleteProject(projectId) {
      await projectRepository.deleteShortProject(projectId);
    },

    async deleteProjects(projectIds) {
      await projectRepository.deleteShortProjects(projectIds);
    },

    async deleteSuggestionGeneration(generationId) {
      await projectRepository.deleteShortProjectsBySuggestionGenerationId(generationId);
    },
  };
}
