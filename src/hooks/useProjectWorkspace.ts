import { useCallback, useEffect, useMemo, useState } from "react";

import { createEditorAssetRecord, normalizeLegacyEditorProjectRecord } from "@/lib/editor/storage";
import { readMediaMetadata } from "@/lib/editor/media";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type { ContentProjectRecord, ProjectAssetRecord, ProjectExportRecord } from "@/lib/projects/types";
import type { CreatorShortProjectRecord } from "@/lib/creator/storage";

const projectRepository = createDexieProjectRepository();

export function useProjectWorkspace(projectId: string | undefined) {
  const [project, setProject] = useState<ContentProjectRecord | null>(null);
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([]);
  const [shortProjects, setShortProjects] = useState<CreatorShortProjectRecord[]>([]);
  const [exports, setExports] = useState<ProjectExportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setAssets([]);
      setShortProjects([]);
      setExports([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [projectRecord, projectAssets, shorts, projectExports] = await Promise.all([
        projectRepository.getProject(projectId),
        projectRepository.listProjectAssets(projectId),
        projectRepository.listShortProjects(projectId),
        projectRepository.listProjectExports(projectId),
      ]);
      setProject(projectRecord ? (normalizeLegacyEditorProjectRecord(projectRecord) as ContentProjectRecord) : null);
      setAssets(projectAssets);
      setShortProjects(shorts);
      setExports(projectExports);
    } catch (err) {
      console.error("Failed to load project workspace", err);
      setError(err instanceof Error ? err.message : "Failed to load project workspace");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sourceAssets = useMemo(
    () => assets.filter((asset) => asset.role === "source" && (asset.kind === "video" || asset.kind === "audio")),
    [assets]
  );

  const activeSourceAsset = useMemo(() => {
    if (!sourceAssets.length) return undefined;
    return sourceAssets.find((asset) => asset.id === project?.activeSourceAssetId) ?? sourceAssets[0];
  }, [project?.activeSourceAssetId, sourceAssets]);

  const saveProject = useCallback(async (record: ContentProjectRecord) => {
    await projectRepository.putProject(record);
    setProject(record);
  }, []);

  const setActiveSourceAsset = useCallback(
    async (assetId: string) => {
      if (!project) return;
      const nextProject: ContentProjectRecord = {
        ...project,
        activeSourceAssetId: assetId,
        updatedAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      await saveProject(nextProject);
    },
    [project, saveProject]
  );

  const addAssets = useCallback(
    async (files: FileList | File[]) => {
      if (!project) return [];
      const list = Array.from(files);
      const nextAssets: ProjectAssetRecord[] = [];
      for (const file of list) {
        const metadata = await readMediaMetadata(file);
        nextAssets.push(
          createEditorAssetRecord({
            projectId: project.id,
            role: metadata.kind === "image" ? "support" : "source",
            origin: "upload",
            kind: metadata.kind === "image" ? "image" : metadata.kind,
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
            now: Date.now(),
          }) as ProjectAssetRecord
        );
      }

      if (!nextAssets.length) return [];

      await projectRepository.bulkPutAssets(nextAssets);
      const nextActiveSourceAssetId =
        project.activeSourceAssetId ??
        nextAssets.find((asset) => asset.role === "source" && (asset.kind === "video" || asset.kind === "audio"))?.id;
      await saveProject({
        ...project,
        assetIds: [...project.assetIds, ...nextAssets.map((asset) => asset.id)],
        activeSourceAssetId: nextActiveSourceAssetId,
        updatedAt: Date.now(),
        lastOpenedAt: Date.now(),
      });
      await refresh();
      return nextAssets;
    },
    [project, refresh, saveProject]
  );

  const renameAsset = useCallback(
    async (assetId: string, filename: string) => {
      const asset = assets.find((item) => item.id === assetId);
      if (!asset) return;
      await projectRepository.bulkPutAssets([
        {
          ...asset,
          filename,
          updatedAt: Date.now(),
        },
      ]);
      await refresh();
    },
    [assets, refresh]
  );

  const deleteAsset = useCallback(
    async (assetId: string) => {
      if (!project) return;
      await projectRepository.deleteAsset(assetId);
      await saveProject({
        ...project,
        assetIds: project.assetIds.filter((id) => id !== assetId),
        activeSourceAssetId: project.activeSourceAssetId === assetId ? undefined : project.activeSourceAssetId,
        updatedAt: Date.now(),
        lastOpenedAt: Date.now(),
      });
      await refresh();
    },
    [project, refresh, saveProject]
  );

  return {
    project,
    assets,
    shortProjects,
    exports,
    sourceAssets,
    activeSourceAsset,
    isLoading,
    error,
    refresh,
    saveProject,
    setActiveSourceAsset,
    addAssets,
    renameAsset,
    deleteAsset,
  };
}
