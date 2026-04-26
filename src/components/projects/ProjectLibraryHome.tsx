"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, Film, Link as LinkIcon, Pencil, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DragDropZone } from "@/components/DragDropZone";
import { YouTubeImportDialog } from "@/components/projects/YouTubeImportDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";

function formatRelativeDate(timestamp: number) {
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function ProjectLibraryHome() {
  const router = useRouter();
  const [isYouTubeDialogOpen, setIsYouTubeDialogOpen] = useState(false);
  const { startYouTubeImport } = useBackgroundTasks();
  const { projects, assetsByProjectId, exportsByProjectId, isLoading, error, createEmptyProject, createProjectFromFile, renameProject, deleteProject } = useProjectLibrary();

  useEffect(() => {
    if (!isLoading) {
      if (projects.length > 0 && !sessionStorage.getItem("hasAutoRedirected")) {
        sessionStorage.setItem("hasAutoRedirected", "true");
        const latestProject = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        router.push(`/projects/${latestProject.id}`);
      } else if (projects.length === 0 && !sessionStorage.getItem("hasAutoRedirected")) {
        sessionStorage.setItem("hasAutoRedirected", "true");
      }
    }
  }, [isLoading, projects, router]);

  const handleCreateProject = async (file: File) => {
    try {
      const project = await createProjectFromFile(file);
      toast.success(`Proyecto creado: ${project.name}`);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "No se pudo crear el proyecto");
    }
  };

  const handleCreateEmptyProject = async () => {
    try {
      const project = await createEmptyProject();
      toast.success(`Proyecto creado: ${project.name}`);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "No se pudo crear el proyecto");
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmed = window.confirm("Delete this project and all its assets, transcripts, shorts, and exports?");
    if (!confirmed) return;
    await deleteProject(projectId);
    toast.success("Proyecto eliminado");
  };

  const handleCreateProjectFromYouTube = async (url: string, signal: AbortSignal) => {
    if (signal.aborted) return;
    startYouTubeImport({
      url,
      onComplete: ({ projectId }) => {
        toast.success("Proyecto importado desde YouTube");
        router.push(`/projects/${projectId}`);
      },
    });
  };

  const handleRenameProject = async (projectId: string, currentName: string) => {
    const nextName = window.prompt("Nuevo nombre del proyecto", currentName)?.trim();
    if (!nextName || nextName === currentName) return;

    try {
      await renameProject(projectId, nextName);
      toast.success("Proyecto renombrado");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "No se pudo renombrar el proyecto");
    }
  };

  return (
    <main className="flex-1 w-full bg-transparent p-4 sm:p-6 lg:p-8 animate-in fade-in duration-500">
      <div className="flex w-full flex-col gap-8">
        <header className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between pb-4">
          <div className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-white/90">Project Library</h1>
              <p className="max-w-2xl text-sm text-white/50">
                Crea un proyecto vacío o empieza desde un video, audio o URL. Gestiona assets, transcripciones, shorts y la timeline centralizadamente.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-black/20 px-5 py-3 text-sm text-white/60 shadow-sm">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">Total</div>
            <div className="mt-1 text-xl font-semibold text-white/90">{projects.length}</div>
            <div className="text-xs">proyecto{projects.length === 1 ? "" : "s"}</div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
          <Card className="border-white/10 bg-white/[0.03] text-white shadow-[0_18px_70px_rgba(0,0,0,0.38)]">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-cyan-200" />
                Crear Proyecto
              </CardTitle>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => void handleCreateEmptyProject()}
                >
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  Proyecto vacío
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => setIsYouTubeDialogOpen(true)}
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Importar URL
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DragDropZone onFileSelect={handleCreateProject} disabled={false} />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03] text-white shadow-[0_18px_70px_rgba(0,0,0,0.38)]">
            <CardHeader>
              <CardTitle className="text-xl">Biblioteca de Proyectos</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-white/55">Loading projects…</div>
              ) : error ? (
                <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-8 text-sm text-red-100">{error}</div>
              ) : projects.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-10 text-center text-white/50">
                  Tu primer upload creará el primer proyecto y te llevará a su workspace.
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.map((project) => {
                    const assets = assetsByProjectId.get(project.id) ?? [];
                    const exports = exportsByProjectId.get(project.id) ?? [];
                    const sourceCount = assets.filter((asset) => asset.role === "source").length;
                    const derivedCount = assets.filter((asset) => asset.role === "derived").length;
                    return (
                      <div
                        key={project.id}
                        className="rounded-[1.4rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">
                                {project.aspectRatio}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-white/55">
                              <span>{sourceCount} source asset{sourceCount === 1 ? "" : "s"}</span>
                              <span>{derivedCount} derived asset{derivedCount === 1 ? "" : "s"}</span>
                              <span>{exports.length} export{exports.length === 1 ? "" : "s"}</span>
                              <span>Updated {formatRelativeDate(project.updatedAt)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button asChild className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                              <Link href={`/projects/${project.id}`}>
                                <Film className="mr-2 h-4 w-4" />
                                Open Workspace
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              className="rounded-xl text-white/60 hover:bg-white/10 hover:text-white"
                              onClick={() => void handleRenameProject(project.id, project.name)}
                              aria-label={`Renombrar ${project.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              className="rounded-xl text-white/60 hover:bg-red-500/10 hover:text-red-100"
                              onClick={() => void handleDeleteProject(project.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
      <YouTubeImportDialog
        open={isYouTubeDialogOpen}
        onOpenChange={setIsYouTubeDialogOpen}
        title="Crear proyecto desde YouTube"
        description="Descarga el vídeo, lo normaliza a MP4 y lo guarda como source del proyecto."
        confirmLabel="Importar y crear proyecto"
        onImport={handleCreateProjectFromYouTube}
      />
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
