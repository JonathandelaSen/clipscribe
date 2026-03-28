"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Clapperboard, Download, Film, Languages, Loader2, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { AiMetadataHub } from "@/components/creator/AiMetadataHub";
import { ProjectYouTubeUploadList } from "@/components/creator/ProjectYouTubeUploadList";
import { CreatorHub } from "@/components/CreatorHub";
import { HistoryItemCard } from "@/components/HistoryItemCard";
import { LanguageSelector } from "@/components/LanguageSelector";
import { YouTubeUploadHub } from "@/components/creator/YouTubeUploadHub";
import { TimelineEditorWorkspace } from "@/components/editor/TimelineEditorWorkspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { isBackgroundTaskActive } from "@/lib/background-tasks/core";
import type { BackgroundTaskRecord } from "@/lib/background-tasks/types";
import { resolveYouTubePublishView } from "@/lib/creator/youtube-publish";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";
import { useTranscriber } from "@/hooks/useTranscriber";
import type { ProjectExportRecord } from "@/lib/projects/types";

type WorkspaceTab = "assets" | "transcripts" | "shorts" | "timeline" | "ai_metadata" | "publish" | "exports";

function formatRelativeDate(timestamp: number) {
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatDeleteBlockers(blockers: string[]) {
  return blockers.join(", ");
}

function formatTaskPercent(progress?: number | null) {
  return `${Math.round(progress ?? 0)}%`;
}

function transcriptionProgressLabel(progressTask?: BackgroundTaskRecord) {
  if (!progressTask || !isBackgroundTaskActive(progressTask)) {
    return undefined;
  }

  const percent = formatTaskPercent(progressTask.progress);
  if (progressTask.status === "queued" || progressTask.status === "preparing") {
    return `Preparing ${percent}`;
  }
  if (progressTask.status === "finalizing") {
    return `Finalizing ${percent}`;
  }
  if (progressTask.status === "running") {
    return `Transcribing ${percent}`;
  }
  return "Transcribing...";
}

function transcribeButtonLabel(isRetranscribe: boolean, progressTask?: BackgroundTaskRecord) {
  const progressLabel = transcriptionProgressLabel(progressTask);
  if (!progressLabel) {
    return isRetranscribe ? "Retranscribe Active Source" : "Transcribe Active Source";
  }
  return progressLabel;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const viewParam = searchParams.get("view");
  const initialAssetId = searchParams.get("assetId") ?? undefined;
  const initialExportId = searchParams.get("exportId") ?? undefined;
  const selectedUploadId = searchParams.get("uploadId") ?? undefined;
  const currentTab: WorkspaceTab =
    tabParam === "transcripts" || tabParam === "shorts" || tabParam === "timeline" || tabParam === "ai_metadata" || tabParam === "publish" || tabParam === "exports" ? tabParam : "assets";
  const publishView = resolveYouTubePublishView({
    requestedView: viewParam,
    assetId: initialAssetId,
    exportId: initialExportId,
  });

  const {
    project,
    assets,
    shortProjects,
    exports,
    youtubeUploads,
    activeSourceAsset,
    isLoading,
    error,
    refresh,
    addAssets,
    renameAsset,
    deleteAsset,
    saveYouTubeUpload,
    setActiveSourceAsset,
  } = useProjectWorkspace(projectId);
  const assetInputRef = useRef<HTMLInputElement | null>(null);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("es");
  const {
    history,
    transcribe,
    createShiftedSubtitleVersion,
    saveTranslation,
    deleteTranscriptVersion,
  } = useTranscriber();
  const { getTaskForResource } = useBackgroundTasks();

  const projectHistory = useMemo(
    () => history.filter((item) => (item as typeof item & { projectId?: string }).projectId === projectId),
    [history, projectId]
  );
  const activeHistoryItem = useMemo(
    () => projectHistory.find((item) => item.id === activeSourceAsset?.id),
    [activeSourceAsset?.id, projectHistory]
  );
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const activeTranscriptionTask = useMemo(
    () =>
      activeSourceAsset
        ? getTaskForResource({
            kind: "transcription",
            projectId,
            assetId: activeSourceAsset.id,
          })
        : undefined,
    [activeSourceAsset, getTaskForResource, projectId]
  );
  const isActiveSourceTranscribing = Boolean(activeTranscriptionTask && isBackgroundTaskActive(activeTranscriptionTask));
  const activeTranscriptionLabel = useMemo(
    () => transcriptionProgressLabel(activeTranscriptionTask),
    [activeTranscriptionTask]
  );
  const assetDeleteBlockersById = useMemo(() => {
    return new Map(
      assets.map((asset) => {
        const blockers: string[] = [];
        const hasTranscript = projectHistory.some((item) => item.id === asset.id && item.transcripts.length > 0);
        const usedInShorts = shortProjects.some((item) => item.sourceAssetId === asset.id);
        const usedInTimeline = Boolean(
          project &&
            (
              project.timeline.videoClips.some((clip) => clip.assetId === asset.id) ||
              project.timeline.audioItems.some((item) => item.assetId === asset.id) ||
              project.timeline.imageItems.some((item) => item.assetId === asset.id)
            )
        );
        const isDerivedOutput = exports.some((record) => record.outputAssetId === asset.id);
        const activeTranscription = getTaskForResource({
          kind: "transcription",
          projectId,
          assetId: asset.id,
        });
        if (hasTranscript) blockers.push("transcripts");
        if (usedInShorts) blockers.push("shorts");
        if (usedInTimeline) blockers.push("timeline");
        if (isDerivedOutput) blockers.push("exports");
        if (activeTranscription && isBackgroundTaskActive(activeTranscription)) blockers.push("background task");
        return [asset.id, blockers] as const;
      })
    );
  }, [assets, exports, getTaskForResource, project, projectHistory, projectId, shortProjects]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAddAssets = async (files: FileList | null) => {
    if (!files) return;
    try {
      const added = await addAssets(files);
      toast.success(`${added.length} asset${added.length === 1 ? "" : "s"} añadido${added.length === 1 ? "" : "s"} al proyecto`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "No se pudieron añadir los assets");
    }
  };

  const handleStartTranscription = async () => {
    if (!project || !activeSourceAsset?.fileBlob) return;
    try {
      await transcribe(activeSourceAsset.fileBlob, transcriptionLanguage, {
        projectId: project.id,
        assetId: activeSourceAsset.id,
      });
      toast.success("Transcripción iniciada");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar la transcripción");
    }
  };

  const handleRenameAsset = async (assetId: string, currentName: string) => {
    const nextName = window.prompt("New asset name", currentName)?.trim();
    if (!nextName || nextName === currentName) return;
    await renameAsset(assetId, nextName);
    toast.success("Asset renombrado");
  };

  const handleDeleteAsset = async (assetId: string) => {
    const blockers = assetDeleteBlockersById.get(assetId) ?? [];
    if (blockers.length > 0) {
      toast.error(`Este asset todavía no se puede borrar: ${formatDeleteBlockers(blockers)}.`);
      return;
    }

    const confirmed = window.confirm("Delete this asset from the project?");
    if (!confirmed) return;
    await deleteAsset(assetId);
    toast.success("Asset eliminado");
  };

  const handleRetranscribe = async (assetId: string, language: string) => {
    if (!project) return;
    const asset = assetsById.get(assetId);
    if (!asset?.fileBlob) {
      toast.error("The original media file is no longer available for this asset.");
      return;
    }

    try {
      await transcribe(asset.fileBlob, language, {
        projectId: project.id,
        assetId,
      });
      toast.success("Nueva transcripción en cola");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar la nueva transcripción");
    }
  };

  const handleYouTubeUploadSuccess = async (record: (typeof youtubeUploads)[number]) => {
    if (!project) return;
    await saveYouTubeUpload(record);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "publish");
    nextParams.set("view", "list");
    nextParams.set("uploadId", record.id);
    nextParams.delete("assetId");
    nextParams.delete("exportId");
    router.replace(`/projects/${encodeURIComponent(project.id)}?${nextParams.toString()}`);
  };

  if (isLoading) {
    return (
      <main className="px-4 py-10 flex-1">
        <div className="mx-auto max-w-6xl rounded-3xl border border-white/10 bg-black/30 p-8 text-white/60">Loading project…</div>
      </main>
    );
  }

  if (!project || error) {
    return (
      <main className="px-4 py-10 flex-1">
        <div className="mx-auto max-w-6xl rounded-3xl border border-red-400/20 bg-red-500/10 p-8 text-red-100">
          {error || "Project not found."}
        </div>
      </main>
    );
  }

  return (
    <main className={cn(
      "flex-1 w-full bg-transparent flex flex-col h-full",
      currentTab === "publish" ? "" : "animate-in fade-in duration-500",
      currentTab === "timeline" ? "p-0" : "p-4 sm:p-6 lg:p-8"
    )}>
      <input ref={assetInputRef} type="file" multiple className="hidden" accept="audio/*,video/*,image/*,.mkv" onChange={(e) => void handleAddAssets(e.target.files)} />
      <div className={cn(
        "flex w-full flex-col flex-1",
        currentTab === "timeline" ? "" : "gap-6 pt-2"
      )}>

        <div className={cn(
          "flex-1 w-full",
          currentTab === "publish" ? "" : "animate-in fade-in slide-in-from-bottom-2 duration-300"
        )}>
          {currentTab === "assets" && (
            <Card className="border-white/10 bg-white/[0.03] text-white">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Project Assets</CardTitle>
                <Button className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={() => assetInputRef.current?.click()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Assets
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {assets.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-white/50">
                    Añade el primer asset de apoyo o fuente adicional para este proyecto.
                  </div>
                ) : (
                  assets.map((asset) => {
                    const deleteBlockers = assetDeleteBlockersById.get(asset.id) ?? [];
                    const canDeleteAsset = deleteBlockers.length === 0;
                    const deleteLabel = canDeleteAsset
                      ? `Delete ${asset.filename}`
                      : `Cannot delete yet: ${formatDeleteBlockers(deleteBlockers)}`;
                    return (
                      <div key={asset.id} className="flex flex-col gap-4 rounded-[1.4rem] border border-white/10 bg-black/20 p-5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-semibold text-white">{asset.filename}</div>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">{asset.kind}</span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">{asset.role}</span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">{asset.origin}</span>
                            {project.activeSourceAssetId === asset.id && (
                              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100">
                                active source
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-white/55">
                            Updated {formatRelativeDate(asset.updatedAt)}
                            {asset.durationSeconds > 0 ? ` · ${asset.durationSeconds.toFixed(1)}s` : ""}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {(asset.kind === "video" || asset.kind === "audio") && (
                            <Button
                              variant="outline"
                              className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => void setActiveSourceAsset(asset.id)}
                            >
                              <Languages className="mr-2 h-4 w-4" />
                              Use as Source
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                            onClick={() => void handleRenameAsset(asset.id, asset.filename)}
                          >
                            Rename
                          </Button>
                          <div title={deleteLabel}>
                            <Button
                              variant="ghost"
                              className="rounded-xl text-white/60 hover:bg-red-500/10 hover:text-red-100 disabled:border disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-white/28"
                              onClick={() => void handleDeleteAsset(asset.id)}
                              disabled={!canDeleteAsset}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}

          {currentTab === "transcripts" && (
            <div className="space-y-6">
              <Card className="border-white/10 bg-white/[0.03] text-white">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Source Transcript Workspace</CardTitle>
                  <Button
                    className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                    onClick={() => void handleStartTranscription()}
                    disabled={!activeSourceAsset?.fileBlob || isActiveSourceTranscribing}
                  >
                    {isActiveSourceTranscribing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {transcribeButtonLabel(Boolean(activeHistoryItem), activeTranscriptionTask)}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-5">
                  {activeSourceAsset ? (
                    <>
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
                        Fuente activa: <span className="font-medium text-white/90">{activeSourceAsset.filename}</span>
                      </div>
                      <LanguageSelector
                        value={transcriptionLanguage}
                        onValueChange={setTranscriptionLanguage}
                        disabled={isActiveSourceTranscribing}
                        required
                      />
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-white/50">
                      Este proyecto todavía no tiene un source asset de audio o video.
                    </div>
                  )}
                </CardContent>
              </Card>

              {activeHistoryItem ? (
                <HistoryItemCard
                  item={activeHistoryItem}
                  audioProgress={isActiveSourceTranscribing ? activeTranscriptionTask?.progress ?? undefined : undefined}
                  audioProgressLabel={isActiveSourceTranscribing ? activeTranscriptionLabel : undefined}
                  autoExpand
                  isRetranscribing={isActiveSourceTranscribing}
                  retranscribeStatusLabel={activeTranscriptionLabel}
                  onRetranscribe={(assetId, language) => {
                    void handleRetranscribe(assetId, language);
                  }}
                  onCreateShiftedSubtitleVersion={createShiftedSubtitleVersion}
                  onSaveTranslation={saveTranslation}
                  onDeleteTranscriptVersion={deleteTranscriptVersion}
                />
              ) : (
                <Card className="border-white/10 bg-white/[0.03] text-white">
                  <CardContent className="p-8 text-center text-white/50">
                    Este source asset todavía no tiene transcript. Inicia una transcripción para crear el historial versionado.
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {currentTab === "shorts" && (
            <CreatorHub
              lockedTool="clip_lab"
              projectId={project.id}
              initialSourceAssetId={activeSourceAsset?.id}
              initialView="start"
              sourceAssetFallback={
                activeSourceAsset
                  ? {
                      id: activeSourceAsset.id,
                      filename: activeSourceAsset.filename,
                      durationSeconds: activeSourceAsset.durationSeconds,
                      projectId: project.id,
                    }
                  : undefined
              }
            />
          )}

          {currentTab === "timeline" && (
            <TimelineEditorWorkspace projectId={project.id} />
          )}

          {currentTab === "ai_metadata" && (
            <AiMetadataHub projectId={project.id} />
          )}

          {currentTab === "publish" && (
            publishView === "new" ? (
              <YouTubeUploadHub
                projectId={project.id}
                initialAssetId={initialAssetId}
                initialExportId={initialExportId}
                embedded
                onUploadSuccess={handleYouTubeUploadSuccess}
              />
            ) : (
              <ProjectYouTubeUploadList
                projectId={project.id}
                uploads={youtubeUploads}
                selectedUploadId={selectedUploadId}
              />
            )
          )}

          {currentTab === "exports" && (
            <Card className="border-white/10 bg-white/[0.03] text-white">
              <CardHeader>
                <CardTitle>Project Exports</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {exports.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-white/50">
                    Los renders de shorts y timeline aparecerán aquí como historial unificado del proyecto.
                  </div>
                ) : (
                  exports.map((record: ProjectExportRecord) => {
                    const outputAsset = record.outputAssetId ? assetsById.get(record.outputAssetId) : undefined;
                    return (
                      <div key={record.id} className="flex flex-col gap-3 rounded-[1.4rem] border border-white/10 bg-black/20 p-5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-semibold text-white">{record.filename}</div>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">{record.kind}</span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">{record.status}</span>
                          </div>
                          <div className="text-sm text-white/55">
                            {formatRelativeDate(record.createdAt)}
                            {record.sizeBytes ? ` · ${(record.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
                            {record.aspectRatio ? ` · ${record.aspectRatio}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {outputAsset?.fileBlob && record.status === "completed" && outputAsset.kind === "video" && (
                            <Button
                              asChild
                              variant="outline"
                              className="rounded-xl border-cyan-300/20 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/15"
                            >
                              <Link href={`/projects/${encodeURIComponent(project.id)}?tab=publish&view=new&exportId=${encodeURIComponent(record.id)}`}>
                                <Upload className="mr-2 h-4 w-4" />
                                Publish to YouTube
                              </Link>
                            </Button>
                          )}
                          {outputAsset?.fileBlob && (
                            <Button
                              variant="outline"
                              className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => {
                                const url = URL.createObjectURL(outputAsset.fileBlob!);
                                const anchor = document.createElement("a");
                                anchor.href = url;
                                anchor.download = outputAsset.filename;
                                anchor.click();
                                URL.revokeObjectURL(url);
                              }}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              Download
                            </Button>
                          )}
                          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/55">
                            {record.kind === "short" ? <Clapperboard className="inline h-4 w-4" /> : <Film className="inline h-4 w-4" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
