import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeLegacyEditorProjectRecord } from "@/lib/editor/storage";
import { PROJECT_LIBRARY_UPDATED_EVENT, notifyProjectLibraryUpdated } from "@/lib/projects/events";
import {
  createProjectAssetFromFile,
  getActiveProjectSourceAsset,
  getSelectableProjectSourceAssets,
} from "@/lib/projects/source-assets";
import { requestProjectYouTubeImport } from "@/lib/projects/youtube-import-client";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type {
  ContentProjectRecord,
  ProjectAssetRecord,
  ProjectExportRecord,
  ProjectVoiceoverRecord,
  ProjectYouTubeUploadRecord,
} from "@/lib/projects/types";
import type { CreatorImageProjectRecord } from "@/lib/creator/types";
import type { CreatorShortProjectRecord } from "@/lib/creator/storage";
import type { ProjectVoiceoverDraft } from "@/lib/voiceover/types";
import { normalizeProjectVoiceoverDraft } from "@/lib/voiceover/utils";

const projectRepository = createDexieProjectRepository();

export function useProjectWorkspace(projectId: string | undefined) {
  const [project, setProject] = useState<ContentProjectRecord | null>(null);
  const [assets, setAssets] = useState<ProjectAssetRecord[]>([]);
  const [shortProjects, setShortProjects] = useState<CreatorShortProjectRecord[]>([]);
  const [exports, setExports] = useState<ProjectExportRecord[]>([]);
  const [voiceovers, setVoiceovers] = useState<ProjectVoiceoverRecord[]>([]);
  const [youtubeUploads, setYouTubeUploads] = useState<ProjectYouTubeUploadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setAssets([]);
      setShortProjects([]);
      setExports([]);
      setVoiceovers([]);
      setYouTubeUploads([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [projectRecord, projectAssets, shorts, projectExports, projectVoiceovers, projectYouTubeUploads] = await Promise.all([
        projectRepository.getProject(projectId),
        projectRepository.listProjectAssets(projectId),
        projectRepository.listShortProjects(projectId),
        projectRepository.listProjectExports(projectId),
        projectRepository.listProjectVoiceovers(projectId),
        projectRepository.listProjectYouTubeUploads(projectId),
      ]);
      setProject(projectRecord ? (normalizeLegacyEditorProjectRecord(projectRecord) as ContentProjectRecord) : null);
      setAssets(projectAssets);
      setShortProjects(shorts);
      setExports(projectExports);
      setVoiceovers(projectVoiceovers);
      setYouTubeUploads(projectYouTubeUploads);
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

  useEffect(() => {
    const handleProjectLibraryUpdated = () => {
      void refresh();
    };

    window.addEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleProjectLibraryUpdated);
    return () => {
      window.removeEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleProjectLibraryUpdated);
    };
  }, [refresh]);

  const sourceAssets = useMemo(
    () => getSelectableProjectSourceAssets(assets),
    [assets]
  );

  const activeSourceAsset = useMemo(() => {
    return getActiveProjectSourceAsset(sourceAssets, project?.activeSourceAssetId);
  }, [project?.activeSourceAssetId, sourceAssets]);

  const saveProject = useCallback(async (record: ContentProjectRecord) => {
    await projectRepository.putProject(record);
    setProject(record);
    notifyProjectLibraryUpdated();
  }, []);

  const saveVoiceoverDraft = useCallback(
    async (draft: ProjectVoiceoverDraft) => {
      if (!project) return;
      const now = Date.now();
      await saveProject({
        ...project,
        voiceoverDraft: normalizeProjectVoiceoverDraft({
          ...draft,
          updatedAt: now,
        }),
        updatedAt: now,
        lastOpenedAt: now,
      });
    },
    [project, saveProject]
  );

  const saveGeneratedVoiceover = useCallback(
    async (input: { asset: ProjectAssetRecord; voiceover: ProjectVoiceoverRecord }) => {
      if (!project) return;
      const now = Math.max(project.updatedAt, input.voiceover.createdAt, input.asset.updatedAt);
      await projectRepository.bulkPutAssets([input.asset]);
      await projectRepository.putProjectVoiceover(input.voiceover);
      await saveProject({
        ...project,
        assetIds: project.assetIds.includes(input.asset.id) ? project.assetIds : [...project.assetIds, input.asset.id],
        updatedAt: now,
        lastOpenedAt: now,
      });
      await refresh();
    },
    [project, refresh, saveProject]
  );

  const saveGeneratedImageAssets = useCallback(
    async (input: { assets: ProjectAssetRecord[]; imageRecord: CreatorImageProjectRecord }) => {
      if (!project || input.assets.length === 0) return;
      const now = Math.max(project.updatedAt, input.imageRecord.generatedAt, ...input.assets.map((asset) => asset.updatedAt));
      await projectRepository.bulkPutAssets(input.assets);
      await saveProject({
        ...project,
        assetIds: Array.from(new Set([...project.assetIds, ...input.assets.map((asset) => asset.id)])),
        aiImageHistory: [
          input.imageRecord,
          ...(project.aiImageHistory ?? []).filter((record) => record.id !== input.imageRecord.id),
        ].slice(0, 40),
        updatedAt: now,
        lastOpenedAt: now,
      });
      await refresh();
    },
    [project, refresh, saveProject]
  );

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

  const persistAddedAssets = useCallback(
    async (nextAssets: ProjectAssetRecord[]) => {
      if (!project || nextAssets.length === 0) return [];

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

  const addAssets = useCallback(
    async (files: FileList | File[]) => {
      if (!project) return [];
      const list = Array.from(files);
      const nextAssets: ProjectAssetRecord[] = [];
      for (const file of list) {
        nextAssets.push(await createProjectAssetFromFile({ projectId: project.id, file }));
      }

      return persistAddedAssets(nextAssets);
    },
    [persistAddedAssets, project]
  );

  const addYouTubeAsset = useCallback(
    async (url: string) => {
      if (!project) return undefined;
      const imported = await requestProjectYouTubeImport({
        url,
        projectId: project.id,
      });
      const asset = await createProjectAssetFromFile({
        projectId: project.id,
        file: imported.file,
        externalSource: imported.externalSource,
      });
      await persistAddedAssets([asset]);
      return asset;
    },
    [persistAddedAssets, project]
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

  const saveYouTubeUpload = useCallback(
    async (record: ProjectYouTubeUploadRecord) => {
      await projectRepository.putProjectYouTubeUpload(record);
      if (project) {
        await saveProject({
          ...project,
          updatedAt: Math.max(project.updatedAt, record.uploadedAt),
          lastOpenedAt: Math.max(project.lastOpenedAt, record.uploadedAt),
        });
      }
      await refresh();
    },
    [project, refresh, saveProject]
  );

  return {
    project,
    assets,
    shortProjects,
    exports,
    voiceovers,
    youtubeUploads,
    sourceAssets,
    activeSourceAsset,
    isLoading,
    error,
    refresh,
    saveProject,
    saveVoiceoverDraft,
    saveGeneratedVoiceover,
    saveGeneratedImageAssets,
    saveYouTubeUpload,
    setActiveSourceAsset,
    addAssets,
    addYouTubeAsset,
    renameAsset,
    deleteAsset,
  };
}
