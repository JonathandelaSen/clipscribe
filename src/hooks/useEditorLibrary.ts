import { useCallback, useEffect, useMemo, useState } from "react";

import { createDexieEditorRepository, groupEditorExportsByProjectId } from "@/lib/repositories/editor-repo";
import { normalizeLegacyEditorExportRecord, normalizeLegacyEditorProjectRecord } from "@/lib/editor/storage";
import type { EditorAssetRecord, EditorExportRecord, EditorProjectRecord } from "@/lib/editor/types";
import { PROJECT_LIBRARY_UPDATED_EVENT } from "@/lib/projects/events";

const editorRepository = createDexieEditorRepository();

export function useEditorLibrary() {
  const [projects, setProjects] = useState<EditorProjectRecord[]>([]);
  const [exports, setExports] = useState<EditorExportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const allProjects = await editorRepository.listProjects();
      const allExports = await Promise.all(allProjects.map((project) => editorRepository.listProjectExports(project.id)));
      setProjects(allProjects.map((project) => normalizeLegacyEditorProjectRecord(project)));
      setExports(allExports.flat().map((record) => normalizeLegacyEditorExportRecord(record)));
    } catch (err) {
      console.error("Failed to load editor library", err);
      setError(err instanceof Error ? err.message : "Failed to load editor library");
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const upsertProject = useCallback(async (record: EditorProjectRecord) => {
    await editorRepository.putProject(record);
    const normalizedRecord = normalizeLegacyEditorProjectRecord(record);
    setProjects((prev) => {
      const next = prev.filter((project) => project.id !== normalizedRecord.id);
      next.push(normalizedRecord);
      return next.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    });
  }, []);

  const importProject = useCallback(async (record: EditorProjectRecord, assets: EditorAssetRecord[]) => {
    await editorRepository.putProjectWithAssets(record, assets);
    const normalizedRecord = normalizeLegacyEditorProjectRecord(record);
    setProjects((prev) => {
      const next = prev.filter((project) => project.id !== normalizedRecord.id);
      next.push(normalizedRecord);
      return next.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    });
  }, []);

  const upsertExport = useCallback(async (record: EditorExportRecord) => {
    await editorRepository.putExport(record);
    const normalizedRecord = normalizeLegacyEditorExportRecord(record);
    setExports((prev) => {
      const next = prev.filter((item) => item.id !== normalizedRecord.id);
      next.push(normalizedRecord);
      return next.sort((a, b) => b.createdAt - a.createdAt);
    });
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    await editorRepository.deleteProject(projectId);
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    setExports((prev) => prev.filter((record) => record.projectId !== projectId));
  }, []);

  const exportsByProjectId = useMemo(() => groupEditorExportsByProjectId(exports), [exports]);

  return {
    projects,
    exports,
    exportsByProjectId,
    isLoading,
    error,
    refresh,
    upsertProject,
    importProject,
    upsertExport,
    deleteProject,
  };
}

export function useEditorProject(projectId: string | undefined) {
  const [project, setProject] = useState<EditorProjectRecord | null>(null);
  const [assets, setAssets] = useState<EditorAssetRecord[]>([]);
  const [exports, setExports] = useState<EditorExportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setAssets([]);
      setExports([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [projectRecord, projectAssets, projectExports] = await Promise.all([
        editorRepository.getProject(projectId),
        editorRepository.listProjectAssets(projectId),
        editorRepository.listProjectExports(projectId),
      ]);
      setProject(projectRecord ? normalizeLegacyEditorProjectRecord(projectRecord) : null);
      setAssets(projectAssets);
      setExports(projectExports.map((record) => normalizeLegacyEditorExportRecord(record)));
    } catch (err) {
      console.error("Failed to load editor project", err);
      setError(err instanceof Error ? err.message : "Failed to load editor project");
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

  const saveProject = useCallback(async (record: EditorProjectRecord) => {
    await editorRepository.putProject(record);
    setProject(normalizeLegacyEditorProjectRecord(record));
  }, []);

  const saveAssets = useCallback(async (records: EditorAssetRecord[]) => {
    await editorRepository.bulkPutAssets(records);
    setAssets((prev) => {
      const next = new Map(prev.map((item) => [item.id, item]));
      for (const record of records) {
        next.set(record.id, record);
      }
      return [...next.values()];
    });
  }, []);

  const deleteAsset = useCallback(async (assetId: string) => {
    await editorRepository.deleteAsset(assetId);
    setAssets((prev) => prev.filter((asset) => asset.id !== assetId));
  }, []);

  const saveExport = useCallback(async (record: EditorExportRecord) => {
    await editorRepository.putExport(record);
    const normalizedRecord = normalizeLegacyEditorExportRecord(record);
    setExports((prev) => {
      const next = prev.filter((item) => item.id !== normalizedRecord.id);
      next.push(normalizedRecord);
      return next.sort((a, b) => b.createdAt - a.createdAt);
    });
  }, []);

  const resolveAssetFile = useCallback(async (assetId: string) => {
    return editorRepository.getAssetFile(assetId);
  }, []);

  return {
    project,
    assets,
    exports,
    isLoading,
    error,
    refresh,
    saveProject,
    saveAssets,
    deleteAsset,
    saveExport,
    resolveAssetFile,
  };
}
