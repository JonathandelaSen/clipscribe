"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Clapperboard, Download, Film, FolderOpen, Languages, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CreatorHub } from "@/components/CreatorHub";
import { HistoryItemCard } from "@/components/HistoryItemCard";
import { LanguageSelector } from "@/components/LanguageSelector";
import { TimelineEditorWorkspace } from "@/components/editor/TimelineEditorWorkspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace";
import { useTranscriber } from "@/hooks/useTranscriber";
import type { ProjectExportRecord } from "@/lib/projects/types";

type WorkspaceTab = "assets" | "transcripts" | "shorts" | "timeline" | "exports";

function formatRelativeDate(timestamp: number) {
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const currentTab: WorkspaceTab =
    tabParam === "transcripts" || tabParam === "shorts" || tabParam === "timeline" || tabParam === "exports" ? tabParam : "assets";

  const {
    project,
    assets,
    shortProjects,
    exports,
    sourceAssets,
    activeSourceAsset,
    isLoading,
    error,
    refresh,
    addAssets,
    renameAsset,
    deleteAsset,
    setActiveSourceAsset,
  } = useProjectWorkspace(projectId);
  const assetInputRef = useRef<HTMLInputElement | null>(null);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState("es");
  const {
    history,
    isBusy,
    transcribe,
    createShiftedSubtitleVersion,
    saveTranslation,
  } = useTranscriber();

  const projectHistory = useMemo(
    () => history.filter((item) => (item as typeof item & { projectId?: string }).projectId === projectId),
    [history, projectId]
  );
  const activeHistoryItem = useMemo(
    () => projectHistory.find((item) => item.id === activeSourceAsset?.id),
    [activeSourceAsset?.id, projectHistory]
  );
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  useEffect(() => {
    void refresh();
  }, [currentTab, refresh]);

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/projects/${projectId}?${params.toString()}`);
  };

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
      const audioData = await import("@/lib/audio").then((module) => module.decodeAudio(activeSourceAsset.fileBlob!));
      await transcribe(audioData, activeSourceAsset.fileBlob, transcriptionLanguage, {
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
    const hasTranscript = projectHistory.some((item) => item.id === assetId && item.transcripts.length > 0);
    const usedInShorts = shortProjects.some((item) => item.sourceAssetId === assetId);
    const usedInTimeline = Boolean(
      project &&
        (
          project.timeline.videoClips.some((clip) => clip.assetId === assetId) ||
          project.timeline.audioItems.some((item) => item.assetId === assetId) ||
          project.timeline.imageItems.some((item) => item.assetId === assetId)
        )
    );
    const isDerivedOutput = exports.some((record) => record.outputAssetId === assetId);

    if (hasTranscript || usedInShorts || usedInTimeline || isDerivedOutput) {
      toast.error("Este asset está referenciado por transcripts, shorts, timeline o exports y no se puede borrar todavía.");
      return;
    }

    const confirmed = window.confirm("Delete this asset from the project?");
    if (!confirmed) return;
    await deleteAsset(assetId);
    toast.success("Asset eliminado");
  };

  if (isLoading) {
    return (
      <main className="min-h-screen px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl rounded-3xl border border-white/10 bg-black/30 p-8 text-white/60">Loading project…</div>
      </main>
    );
  }

  if (!project || error) {
    return (
      <main className="min-h-screen px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl rounded-3xl border border-red-400/20 bg-red-500/10 p-8 text-red-100">
          {error || "Project not found."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,146,60,0.14),transparent_24%),linear-gradient(180deg,#03060c,#090f18_48%,#03060c)] px-4 py-6 sm:px-8 lg:px-10">
      <input ref={assetInputRef} type="file" multiple className="hidden" accept="audio/*,video/*,image/*,.mkv" onChange={(e) => void handleAddAssets(e.target.files)} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_82%_0%,rgba(251,146,60,0.18),transparent_28%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Projects
              </Link>
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-cyan-100">
                  <FolderOpen className="h-4 w-4" />
                  Project Workspace
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-white">{project.name}</h1>
                <p className="max-w-3xl text-sm text-white/60">
                  Un solo proyecto para organizar assets, transcripts, shorts, timeline y exports.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => assetInputRef.current?.click()}
                className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Assets
              </Button>
              {sourceAssets.length > 0 && (
                <Select value={activeSourceAsset?.id} onValueChange={(value) => void setActiveSourceAsset(value)}>
                  <SelectTrigger className="w-[260px] rounded-xl border-white/10 bg-white/5 text-white">
                    <SelectValue placeholder="Select active source" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-zinc-950 text-white">
                    {sourceAssets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {asset.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </header>

        <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-5 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            <TabsTrigger value="assets" className="rounded-xl py-3">Assets</TabsTrigger>
            <TabsTrigger value="transcripts" className="rounded-xl py-3">Transcripts</TabsTrigger>
            <TabsTrigger value="shorts" className="rounded-xl py-3">Shorts</TabsTrigger>
            <TabsTrigger value="timeline" className="rounded-xl py-3">Timeline</TabsTrigger>
            <TabsTrigger value="exports" className="rounded-xl py-3">Exports</TabsTrigger>
          </TabsList>

          <TabsContent value="assets" className="mt-6">
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
                  assets.map((asset) => (
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
                        <Button
                          variant="ghost"
                          className="rounded-xl text-white/60 hover:bg-red-500/10 hover:text-red-100"
                          onClick={() => void handleDeleteAsset(asset.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transcripts" className="mt-6">
            <div className="space-y-6">
              <Card className="border-white/10 bg-white/[0.03] text-white">
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Source Transcript Workspace</CardTitle>
                  <Button
                    className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                    onClick={() => void handleStartTranscription()}
                    disabled={!activeSourceAsset?.fileBlob || isBusy}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {activeHistoryItem ? "Retranscribe Active Source" : "Transcribe Active Source"}
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
                        disabled={isBusy}
                        required
                        helperText="La transcripción se guardará como historial versionado del asset fuente activo."
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
                  autoExpand
                  onCreateShiftedSubtitleVersion={createShiftedSubtitleVersion}
                  onSaveTranslation={saveTranslation}
                />
              ) : (
                <Card className="border-white/10 bg-white/[0.03] text-white">
                  <CardContent className="p-8 text-center text-white/50">
                    Este source asset todavía no tiene transcript. Inicia una transcripción para crear el historial versionado.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="shorts" className="mt-6">
            <CreatorHub lockedTool="clip_lab" projectId={project.id} initialSourceAssetId={activeSourceAsset?.id} initialView="start" />
          </TabsContent>

          <TabsContent value="timeline" className="mt-6">
            <TimelineEditorWorkspace projectId={project.id} />
          </TabsContent>

          <TabsContent value="exports" className="mt-6">
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
          </TabsContent>
        </Tabs>
      </div>
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
