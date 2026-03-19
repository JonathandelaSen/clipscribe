import type { AudioTranscriberDB } from "@/lib/db";
import { sortHistoryItems, type HistoryItem } from "@/lib/history";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";

export interface HistoryRepository {
  listHistory(projectId?: string): Promise<HistoryItem[]>;
}

export function createDexieHistoryRepository(database?: AudioTranscriberDB): HistoryRepository {
  const projectRepository = createDexieProjectRepository(database);

  return {
    async listHistory(projectId?: string) {
      return sortHistoryItems(await projectRepository.listProjectHistory(projectId));
    },
  };
}
