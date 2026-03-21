import { useCallback, useEffect, useMemo, useState } from "react";

import type { CreatorLLMRunRecord } from "@/lib/creator/types";
import {
  createDexieCreatorLLMRunsRepository,
  sortCreatorLLMRuns,
} from "@/lib/repositories/creator-llm-runs-repo";

const creatorLlmRunsRepository = createDexieCreatorLLMRunsRepository();

export function useCreatorLlmRuns(projectId?: string) {
  const [runs, setRuns] = useState<CreatorLLMRunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRuns(await creatorLlmRunsRepository.listRuns(projectId));
    } catch (err) {
      console.error("Failed to load creator LLM runs", err);
      setError(err instanceof Error ? err.message : "Failed to load creator LLM runs");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertRun = useCallback(async (record: CreatorLLMRunRecord) => {
    await creatorLlmRunsRepository.putRun(record);
    setRuns((prev) => sortCreatorLLMRuns([...prev.filter((item) => item.id !== record.id), record]));
  }, []);

  const deleteRun = useCallback(async (id: string) => {
    await creatorLlmRunsRepository.deleteRun(id);
    setRuns((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const deleteRuns = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await creatorLlmRunsRepository.deleteRuns(ids);
    setRuns((prev) => prev.filter((item) => !ids.includes(item.id)));
  }, []);

  const clearRuns = useCallback(async () => {
    await creatorLlmRunsRepository.clearRuns();
    setRuns([]);
  }, []);

  return useMemo(
    () => ({
      runs,
      isLoading,
      error,
      refresh,
      upsertRun,
      deleteRun,
      deleteRuns,
      clearRuns,
    }),
    [clearRuns, deleteRun, deleteRuns, error, isLoading, refresh, runs, upsertRun]
  );
}
