import { useCallback, useEffect, useState } from "react";

import { PROJECT_LIBRARY_UPDATED_EVENT, notifyProjectLibraryUpdated } from "@/lib/projects/events";
import { createEmptyContentProject, createProjectFromSourceFile } from "@/lib/projects/source-assets";
import { requestProjectYouTubeImport } from "@/lib/projects/youtube-import-client";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type { ContentProjectRecord, ProjectAssetRecord, ProjectExportRecord } from "@/lib/projects/types";

const projectRepository = createDexieProjectRepository();

export function useProjectLibrary() {
  const [projects, setProjects] = useState<ContentProjectRecord[]>([]);
  const [assetsByProjectId, setAssetsByProjectId] = useState<Map<string, ProjectAssetRecord[]>>(new Map());
  const [exportsByProjectId, setExportsByProjectId] = useState<Map<string, ProjectExportRecord[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const allProjects = await projectRepository.listProjects();
      const allAssets = await Promise.all(allProjects.map((project) => projectRepository.listProjectAssets(project.id)));
      const allExports = await Promise.all(allProjects.map((project) => projectRepository.listProjectExports(project.id)));

      setProjects(allProjects);
      setAssetsByProjectId(new Map(allProjects.map((project, index) => [project.id, allAssets[index] ?? []])));
      setExportsByProjectId(new Map(allProjects.map((project, index) => [project.id, allExports[index] ?? []])));
    } catch (err) {
      console.error("Failed to load project library", err);
      setError(err instanceof Error ? err.message : "Failed to load project library");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleProjectLibraryUpdated = () => {
      void refresh();
    };

    window.addEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleProjectLibraryUpdated);
    return () => {
      window.removeEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleProjectLibraryUpdated);
    };
  }, [refresh]);

  const createProjectFromFile = useCallback(async (file: File) => {
    const { project, asset } = await createProjectFromSourceFile({ file });

    await projectRepository.putProject(project);
    await projectRepository.bulkPutAssets([asset]);
    await refresh();
    notifyProjectLibraryUpdated();
    return project;
  }, [refresh]);

  const createEmptyProject = useCallback(async (name?: string) => {
    const project = createEmptyContentProject({ name });

    await projectRepository.putProject(project);
    await refresh();
    notifyProjectLibraryUpdated();
    return project;
  }, [refresh]);

  const createProjectFromYouTubeUrl = useCallback(async (url: string) => {
    const imported = await requestProjectYouTubeImport({ url });
    const { project, asset } = await createProjectFromSourceFile({
      file: imported.file,
      externalSource: imported.externalSource,
    });

    await projectRepository.putProject(project);
    await projectRepository.bulkPutAssets([asset]);
    await refresh();
    notifyProjectLibraryUpdated();
    return project;
  }, [refresh]);

  const deleteProject = useCallback(async (projectId: string) => {
    await projectRepository.deleteProject(projectId);
    await refresh();
    notifyProjectLibraryUpdated();
  }, [refresh]);

  const saveProject = useCallback(async (record: ContentProjectRecord) => {
    await projectRepository.putProject(record);
    await refresh();
    notifyProjectLibraryUpdated();
  }, [refresh]);

  const renameProject = useCallback(async (projectId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;

    const project = await projectRepository.getProject(projectId);
    if (!project || project.name === nextName) return;

    const now = Date.now();
    await projectRepository.putProject({
      ...project,
      name: nextName,
      updatedAt: now,
      lastOpenedAt: now,
    });
    await refresh();
    notifyProjectLibraryUpdated();
  }, [refresh]);

  return {
    projects,
    assetsByProjectId,
    exportsByProjectId,
    isLoading,
    error,
    refresh,
    createEmptyProject,
    createProjectFromFile,
    createProjectFromYouTubeUrl,
    saveProject,
    renameProject,
    deleteProject,
  };
}
