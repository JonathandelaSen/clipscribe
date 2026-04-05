import { useCallback, useEffect, useMemo, useState } from "react";

import { createEditorAssetRecord, normalizeLegacyEditorProjectRecord } from "@/lib/editor/storage";
import { readMediaMetadata } from "@/lib/editor/media";
import { PROJECT_LIBRARY_UPDATED_EVENT, notifyProjectLibraryUpdated } from "@/lib/projects/events";
import { getActiveProjectSourceAsset, getSelectableProjectSourceAssets } from "@/lib/projects/source-assets";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import type {
  ContentProjectRecord,
  ProjectAssetRecord,
  ProjectExportRecord,
  ProjectVoiceoverRecord,
  ProjectYouTubeUploadRecord,
} from "@/lib/projects/types";
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
    saveYouTubeUpload,
    setActiveSourceAsset,
    addAssets,
    renameAsset,
    deleteAsset,
  };
}
