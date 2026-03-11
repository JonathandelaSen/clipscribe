"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, Film, FolderOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useEditorLibrary } from "@/hooks/useEditorLibrary";
import { createEmptyEditorProject } from "@/lib/editor/storage";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";

function formatRelativeDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export function EditorProjectLibrary() {
  const router = useRouter();
  const { projects, exportsByProjectId, isLoading, error, upsertProject, deleteProject } = useEditorLibrary();

  const handleCreateProject = async () => {
    const project = createEmptyEditorProject();
    await upsertProject(project);
    router.push(`/creator/editor/${project.id}`);
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmed = window.confirm("Delete this project and its export history?");
    if (!confirmed) return;
    await deleteProject(projectId);
    toast.success("Project deleted");
  };

  return (
    <main className="min-h-[calc(100vh-[var(--header-height,0px)])] px-4 py-6 sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(38,211,194,0.22),transparent_36%),radial-gradient(circle_at_right,rgba(245,158,11,0.16),transparent_30%),linear-gradient(180deg,rgba(7,11,17,0.96),rgba(2,6,23,0.94))] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.45)] sm:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_42%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <Link
                href="/creator"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Creator
              </Link>
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-cyan-100">
                  <Film className="h-4 w-4" />
                  Timeline Studio
                </div>
                <div>
                  <h1 className="font-[var(--font-geist-sans)] text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                    Projects and export history
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65 sm:text-base">
                    Browser-local timeline projects with clip sequencing, caption track support, and export audits.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleCreateProject}
              className="h-12 rounded-2xl border border-cyan-300/20 bg-cyan-300/90 px-6 text-sm font-semibold text-slate-950 hover:bg-cyan-200"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
          <Card className="border-white/10 bg-white/[0.03] text-white shadow-[0_18px_70px_rgba(0,0,0,0.38)]">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Project Library</CardTitle>
                <CardDescription className="text-white/55">
                  Open any saved timeline and continue editing from where you left off.
                </CardDescription>
              </div>
              <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                {projects.length} saved
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-white/55">
                  Loading local projects…
                </div>
              ) : error ? (
                <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-8 text-sm text-red-100">
                  {error}
                </div>
              ) : projects.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-8 text-center">
                  <FolderOpen className="mx-auto mb-4 h-12 w-12 text-white/20" />
                  <div className="text-lg font-medium text-white">No projects yet</div>
                  <p className="mt-2 text-sm text-white/50">
                    Create a timeline project to start arranging clips, audio, and subtitles.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.map((project) => {
                    const exportCount = exportsByProjectId.get(project.id)?.length ?? 0;
                    return (
                      <div
                        key={project.id}
                        className="group rounded-[1.6rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5 transition-colors hover:border-cyan-300/30"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">
                                {project.aspectRatio}
                              </span>
                              <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/55">
                                {project.timeline.videoClips.length} clips
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-white/55">
                              <span>Updated {formatRelativeDate(project.updatedAt)}</span>
                              <span>{exportCount} export record{exportCount === 1 ? "" : "s"}</span>
                              <span>{project.timeline.audioTrack ? "Audio bed attached" : "No audio bed"}</span>
                            </div>
                            {project.latestExport ? (
                              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/8 px-4 py-3 text-sm text-emerald-50/85">
                                Last export: {project.latestExport.resolution} · {project.latestExport.aspectRatio} · {formatRelativeDate(project.latestExport.createdAt)}
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/45">
                                No exports yet. Open the project to render the first timeline output.
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              asChild
                              variant="outline"
                              className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                            >
                              <Link href={`/creator/editor/${project.id}`}>Open</Link>
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

          <Card className="border-white/10 bg-white/[0.03] text-white shadow-[0_18px_70px_rgba(0,0,0,0.38)]">
            <CardHeader>
              <CardTitle className="text-xl">V1 Capabilities</CardTitle>
              <CardDescription className="text-white/55">
                The new editor is intentionally focused: fast, browser-local, and project based.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-white/70">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-2 flex items-center gap-2 font-medium text-white">
                  <Clapperboard className="h-4 w-4 text-cyan-200" />
                  Timeline editing
                </div>
                Sequence multiple clips, trim or split them, attach one audio bed, and keep a live caption track.
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-2 font-medium text-white">Exports</div>
                Export `16:9`, `9:16`, `1:1`, or `4:5` at `720p`, `1080p`, or experimental `4K`.
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-2 font-medium text-white">Persistence</div>
                Projects and export records are saved in this browser only. Old export entries are stored as metadata, not archived video files.
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
