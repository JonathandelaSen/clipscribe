"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DragDropZone } from "@/components/DragDropZone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
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
  const { projects, assetsByProjectId, exportsByProjectId, isLoading, error, createProjectFromFile, deleteProject } = useProjectLibrary();

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

  const handleDeleteProject = async (projectId: string) => {
    const confirmed = window.confirm("Delete this project and all its assets, transcripts, shorts, and exports?");
    if (!confirmed) return;
    await deleteProject(projectId);
    toast.success("Proyecto eliminado");
  };

  return (
    <main className="flex-1 w-full bg-transparent p-4 sm:p-6 lg:p-8 animate-in fade-in duration-500">
      <div className="flex w-full flex-col gap-8">
        <header className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between pb-4">
          <div className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-white/90">Project Library</h1>
              <p className="max-w-2xl text-sm text-white/50">
                Sube un video o audio para crear un proyecto. Gestiona assets, transcripciones, shorts y la timeline centralizadamente.
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-cyan-200" />
                Crear Proyecto
              </CardTitle>
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
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
