import { useCallback, useEffect, useState } from "react";
import type { HistoryItem } from "@/lib/history";
import { createDexieHistoryRepository } from "@/lib/repositories/history-repo";
import { PROJECT_LIBRARY_UPDATED_EVENT } from "@/lib/projects/events";

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

  useEffect(() => {
    const handleUpdate = () => {
      void refresh();
    };
    window.addEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleUpdate);
    };
  }, [refresh]);

  return { history, isLoading, error, refresh };
}
