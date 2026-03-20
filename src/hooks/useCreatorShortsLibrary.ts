import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreatorShortExportRecord, CreatorShortProjectRecord } from "@/lib/creator/storage";
import {
  getAiSuggestionCreatorShortProjects,
  getManualCreatorShortProjects,
  groupCreatorShortProjectsBySuggestionGeneration,
  groupCreatorShortExportsByProjectId,
  sortCreatorShortExports,
  sortCreatorShortProjects,
} from "@/lib/creator/core/short-library";
import { createDexieCreatorShortsRepository } from "@/lib/repositories/creator-shorts-repo";

const creatorShortsRepository = createDexieCreatorShortsRepository();

export function useCreatorShortsLibrary(projectId?: string) {
  const [projects, setProjects] = useState<CreatorShortProjectRecord[]>([]);
  const [exports, setExports] = useState<CreatorShortExportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [allProjects, allExports] = await Promise.all([
        creatorShortsRepository.listProjects(projectId),
        creatorShortsRepository.listExports(projectId),
      ]);
      setProjects(allProjects);
      setExports(allExports);
    } catch (err) {
      console.error("Failed to load creator shorts library", err);
      setError(err instanceof Error ? err.message : "Failed to load creator shorts library");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsertProject = useCallback(async (record: CreatorShortProjectRecord) => {
    await creatorShortsRepository.putProject(record);
    setProjects((prev) => {
      const next = prev.filter((item) => item.id !== record.id);
      next.push(record);
      return sortCreatorShortProjects(next);
    });
  }, []);

  const upsertExport = useCallback(async (record: CreatorShortExportRecord) => {
    await creatorShortsRepository.putExport(record);
    setExports((prev) => {
      const next = prev.filter((item) => item.id !== record.id);
      next.push(record);
      return sortCreatorShortExports(next);
    });
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    await creatorShortsRepository.deleteProject(projectId);
    setProjects((prev) => prev.filter((item) => item.id !== projectId));
    setExports((prev) => prev.filter((item) => item.shortProjectId !== projectId));
  }, []);

  const deleteProjects = useCallback(async (projectIds: string[]) => {
    if (projectIds.length === 0) return;
    await creatorShortsRepository.deleteProjects(projectIds);
    setProjects((prev) => prev.filter((item) => !projectIds.includes(item.id)));
    setExports((prev) => prev.filter((item) => !item.shortProjectId || !projectIds.includes(item.shortProjectId)));
  }, []);

  const deleteSuggestionGeneration = useCallback(async (generationId: string) => {
    if (!generationId) return;
    const projectIds = projects
      .filter((item) => item.suggestionGenerationId === generationId)
      .map((item) => item.id);
    await creatorShortsRepository.deleteSuggestionGeneration(generationId);
    setProjects((prev) => prev.filter((item) => item.suggestionGenerationId !== generationId));
    setExports((prev) => prev.filter((item) => !item.shortProjectId || !projectIds.includes(item.shortProjectId)));
  }, [projects]);

  const exportsByProjectId = useMemo(() => {
    return groupCreatorShortExportsByProjectId(exports);
  }, [exports]);

  const manualProjects = useMemo(() => {
    return getManualCreatorShortProjects(projects);
  }, [projects]);

  const aiSuggestionProjects = useMemo(() => {
    return getAiSuggestionCreatorShortProjects(projects);
  }, [projects]);

  const aiSuggestionsByGeneration = useMemo(() => {
    return groupCreatorShortProjectsBySuggestionGeneration(projects);
  }, [projects]);

  const hasAiSuggestionsForSignature = useCallback(
    (signature: string) => aiSuggestionProjects.some((record) => record.suggestionSourceSignature === signature),
    [aiSuggestionProjects]
  );

  return {
    projects,
    manualProjects,
    aiSuggestionProjects,
    aiSuggestionsByGeneration,
    exports,
    exportsByProjectId,
    isLoading,
    error,
    refresh,
    upsertProject,
    upsertExport,
    deleteProject,
    deleteProjects,
    deleteSuggestionGeneration,
    hasAiSuggestionsForSignature,
  };
}
