"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Film, Sparkles, Trash2 } from "lucide-react";
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(251,146,60,0.16),transparent_28%),linear-gradient(180deg,#04070d,#090e18_52%,#04070d)] px-4 py-6 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_80%_0%,rgba(251,146,60,0.18),transparent_28%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-cyan-100">
                <FolderKanban className="h-4 w-4" />
                Content Projects
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Todo tu contenido vive dentro de proyectos</h1>
                <p className="max-w-3xl text-sm leading-6 text-white/60 sm:text-base">
                  Sube un video o audio para crear el proyecto raíz. Desde ahí podrás gestionar assets, transcripciones, shorts, timeline y exports sin saltar entre herramientas desconectadas.
                </p>
              </div>
            </div>
            <div className="rounded-[1.6rem] border border-white/10 bg-black/20 px-5 py-4 text-sm text-white/65 backdrop-blur-xl">
              <div className="text-[11px] uppercase tracking-[0.28em] text-white/40">Biblioteca</div>
              <div className="mt-2 text-2xl font-semibold text-white">{projects.length}</div>
              <div>proyecto{projects.length === 1 ? "" : "s"} guardado{projects.length === 1 ? "" : "s"}</div>
            </div>
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
