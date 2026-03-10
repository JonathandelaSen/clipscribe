import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ComposerAssetRecord,
  ComposerExportRecord,
  ComposerProjectRecord,
} from "@/lib/composer/types";
import {
  createDexieComposerRepository,
  sortComposerAssets,
  sortComposerExports,
  sortComposerProjects,
} from "@/lib/repositories/composer-repo";

const composerRepository = createDexieComposerRepository();

export function useComposerLibrary(activeProjectId?: string) {
  const [projects, setProjects] = useState<ComposerProjectRecord[]>([]);
  const [assets, setAssets] = useState<ComposerAssetRecord[]>([]);
  const [exports, setExports] = useState<ComposerExportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const projectsList = await composerRepository.listProjects();
      setProjects(projectsList);

      if (activeProjectId) {
        const [assetsList, exportsList] = await Promise.all([
          composerRepository.listAssets(activeProjectId),
          composerRepository.listExports(activeProjectId),
        ]);
        setAssets(assetsList);
        setExports(exportsList);
      } else {
        setAssets([]);
        setExports([]);
      }
    } catch (err) {
      console.error("Failed to load composer library", err);
      setError(err instanceof Error ? err.message : "Failed to load composer library");
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertProject = useCallback(async (record: ComposerProjectRecord) => {
    await composerRepository.putProject(record);
    setProjects((prev) => sortComposerProjects([...prev.filter((item) => item.id !== record.id), record]));
  }, []);

  const upsertAsset = useCallback(async (record: ComposerAssetRecord) => {
    await composerRepository.putAsset(record);
    setAssets((prev) => sortComposerAssets([...prev.filter((item) => item.id !== record.id), record]));
  }, []);

  const putAssetFile = useCallback(async (record: { id: string; file: File }) => {
    await composerRepository.putAssetFile(record);
  }, []);

  const upsertExport = useCallback(async (record: ComposerExportRecord) => {
    await composerRepository.putExport(record);
    setExports((prev) => sortComposerExports([...prev.filter((item) => item.id !== record.id), record]));
  }, []);

  const getAssetFile = useCallback(async (fileId: string) => composerRepository.getAssetFile(fileId), []);

  const recentProjects = useMemo(() => projects.slice(0, 6), [projects]);

  return {
    projects,
    recentProjects,
    assets,
    exports,
    isLoading,
    error,
    refresh,
    upsertProject,
    upsertAsset,
    putAssetFile,
    upsertExport,
    getAssetFile,
  };
}

