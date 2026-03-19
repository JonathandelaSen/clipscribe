import { useCallback, useEffect, useState } from "react";

import { createEmptyEditorProject, createEditorAssetRecord } from "@/lib/editor/storage";
import { readMediaMetadata } from "@/lib/editor/media";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type { ContentProjectRecord, ProjectAssetRecord, ProjectExportRecord } from "@/lib/projects/types";

const projectRepository = createDexieProjectRepository();

function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

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

  const createProjectFromFile = useCallback(async (file: File) => {
    const metadata = await readMediaMetadata(file);
    const now = Date.now();
    const project = createEmptyEditorProject({
      now,
      name: fileStem(file.name) || "Untitled Project",
    }) as ContentProjectRecord;
    const asset = createEditorAssetRecord({
      projectId: project.id,
      role: "source",
      origin: "upload",
      kind: metadata.kind === "image" ? "video" : metadata.kind,
      filename: file.name,
      mimeType:
        file.type ||
        (metadata.kind === "video"
          ? "video/mp4"
          : metadata.kind === "image"
            ? "image/png"
            : "audio/mpeg"),
      sizeBytes: file.size,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      hasAudio: metadata.hasAudio,
      sourceType: "upload",
      captionSource: { kind: "none" },
      fileBlob: file,
      now,
    });
    project.assetIds = [asset.id];
    project.activeSourceAssetId = asset.id;

    await projectRepository.putProject(project);
    await projectRepository.bulkPutAssets([asset]);
    await refresh();
    return project;
  }, [refresh]);

  const deleteProject = useCallback(async (projectId: string) => {
    await projectRepository.deleteProject(projectId);
    await refresh();
  }, [refresh]);

  return {
    projects,
    assetsByProjectId,
    exportsByProjectId,
    isLoading,
    error,
    refresh,
    createProjectFromFile,
    deleteProject,
  };
}
