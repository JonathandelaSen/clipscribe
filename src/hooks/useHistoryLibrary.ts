import { useCallback, useEffect, useState } from "react";
import type { HistoryItem } from "@/lib/history";
import { createDexieHistoryRepository } from "@/lib/repositories/history-repo";

const historyRepository = createDexieHistoryRepository();

export function useHistoryLibrary(projectId?: string) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setHistory(await historyRepository.listHistory(projectId));
    } catch (err) {
      console.error("Failed to load history", err);
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { history, isLoading, error, refresh };
}
