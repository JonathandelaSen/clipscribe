import { db, type AudioTranscriberDB } from "../db";
import type { CreatorLLMRunRecord } from "../creator/types";

export interface CreatorLLMRunsRepository {
  listRuns(projectId?: string): Promise<CreatorLLMRunRecord[]>;
  putRun(record: CreatorLLMRunRecord): Promise<void>;
  deleteRun(id: string): Promise<void>;
  deleteRuns(ids: string[]): Promise<void>;
  clearRuns(): Promise<void>;
}

export function sortCreatorLLMRuns(records: CreatorLLMRunRecord[]): CreatorLLMRunRecord[] {
  return [...records].sort((left, right) => right.startedAt - left.startedAt);
}

export function createDexieCreatorLLMRunsRepository(database: AudioTranscriberDB = db): CreatorLLMRunsRepository {
  return {
    async listRuns(projectId) {
      const records = projectId
        ? await database.creatorLlmRuns.where("projectId").equals(projectId).toArray()
        : await database.creatorLlmRuns.toArray();
      return sortCreatorLLMRuns(records);
    },

    async putRun(record) {
      await database.creatorLlmRuns.put(record);
    },

    async deleteRun(id) {
      await database.creatorLlmRuns.delete(id);
    },

    async deleteRuns(ids) {
      if (ids.length === 0) return;
      await database.creatorLlmRuns.bulkDelete(ids);
    },

    async clearRuns() {
      await database.creatorLlmRuns.clear();
    },
  };
}
