"use client";

import { MonitorX, FolderOpen, Download, Film } from "lucide-react";

import type { ComposerExportRecord, ComposerProjectRecord } from "@/lib/composer/types";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { composerInsetClass, composerPanelClass, formatBytes } from "@/components/composer/utils";

interface ComposerCompactFallbackProps {
  recentProjects: ComposerProjectRecord[];
  activeProjectId: string;
  onOpenProject: (project: ComposerProjectRecord) => void;
  exports: ComposerExportRecord[];
  onDownloadExport: (record: ComposerExportRecord) => void;
}

export function ComposerCompactFallback({
  recentProjects,
  activeProjectId,
  onOpenProject,
  exports,
  onDownloadExport,
}: ComposerCompactFallbackProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--composer-app)] p-4 text-[color:var(--composer-text)] lg:hidden">
      <div className={`${composerPanelClass} mx-auto w-full max-w-3xl overflow-hidden`}>
        <div className="border-b border-[color:var(--composer-border)] px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)]">
              <MonitorX className="size-5 text-[color:var(--composer-accent-secondary)]" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-[color:var(--composer-muted)]">
                Desktop Required
              </div>
              <h1 className="mt-2 text-xl font-semibold">
                Timeline Composer needs a larger workspace
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--composer-muted)]">
                This editor is optimized for desktop or tablet landscape. You can still review recent drafts and download saved exports here.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
          <section className={`${composerInsetClass} min-h-0 p-3`}>
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
              <FolderOpen className="size-3.5" />
              Recent Drafts
            </div>
            <ScrollArea className="max-h-[320px] pr-2">
              <div className="space-y-2">
                {recentProjects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--composer-border)] px-3 py-4 text-sm text-[color:var(--composer-muted)]">
                    No draft created yet.
                  </div>
                ) : (
                  recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        activeProjectId === project.id
                          ? "border-[#4c90a5] bg-[#1d2c33]"
                          : "border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] hover:border-[#46505a]"
                      }`}
                      onClick={() => onOpenProject(project)}
                    >
                      <div className="truncate text-sm font-medium">{project.name}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[color:var(--composer-muted)]">
                        {project.status}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </section>

          <section className={`${composerInsetClass} min-h-0 p-3`}>
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
              <Film className="size-3.5" />
              Saved Exports
            </div>
            <ScrollArea className="max-h-[320px] pr-2">
              <div className="space-y-2">
                {exports.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--composer-border)] px-3 py-4 text-sm text-[color:var(--composer-muted)]">
                    No export available for the active project.
                  </div>
                ) : (
                  exports.map((record) => (
                    <div
                      key={record.id}
                      className="rounded-lg border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] px-3 py-3"
                    >
                      <div className="truncate text-sm font-medium">{record.filename}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[color:var(--composer-muted)]">
                        {record.ratio} • {record.quality} • {record.resolution}
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--composer-muted)]">
                        {formatBytes(record.sizeBytes)}
                      </div>
                      <Button
                        size="sm"
                        className="mt-3 h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
                        onClick={() => onDownloadExport(record)}
                        disabled={!record.fileBlob}
                      >
                        <Download className="mr-1.5 size-3.5" />
                        Download
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </section>
        </div>
      </div>
    </div>
  );
}

