"use client";

import { AudioLines, ClipboardCopy, Film, FolderOpen, Layers3, Plus } from "lucide-react";

import type {
  ComposerAssetRecord,
  ComposerProjectRecord,
  ComposerQuality,
  ComposerRatio,
} from "@/lib/composer/types";
import type { ComposerBinTab } from "@/lib/composer/core/workspace-prefs";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { assetLabel, composerInsetClass, composerPanelClass, formatTime } from "@/components/composer/utils";
import { cn } from "@/lib/utils";

interface ComposerBinPanelProps {
  activeTab: ComposerBinTab;
  onTabChange: (value: ComposerBinTab) => void;
  recentProjects: ComposerProjectRecord[];
  activeProjectId: string;
  onOpenProject: (project: ComposerProjectRecord) => void;
  assets: ComposerAssetRecord[];
  isLoading: boolean;
  isUploadingAsset: boolean;
  onAudioImport: () => void;
  onVideoImport: () => void;
  onAddAssetToTimeline: (asset: ComposerAssetRecord) => void;
  onCopyAssetPreset: (asset: ComposerAssetRecord) => void;
  projectName: string;
  projectDurationSeconds: number;
  timelineItemCount: number;
  exportRatio: ComposerRatio;
  exportQuality: ComposerQuality;
}

export function ComposerBinPanel({
  activeTab,
  onTabChange,
  recentProjects,
  activeProjectId,
  onOpenProject,
  assets,
  isLoading,
  isUploadingAsset,
  onAudioImport,
  onVideoImport,
  onAddAssetToTimeline,
  onCopyAssetPreset,
  projectName,
  projectDurationSeconds,
  timelineItemCount,
  exportRatio,
  exportQuality,
}: ComposerBinPanelProps) {
  return (
    <section data-testid="composer-bin-panel" className={`${composerPanelClass} overflow-hidden`}>
      <div className="border-b border-[color:var(--composer-border)] px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--composer-muted)]">
          Project Bin
        </div>
        <div className="mt-1 text-sm font-medium text-[color:var(--composer-text)]">
          Media, drafts, and project metadata
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <div className={`${composerInsetClass} p-2`}>
          <div className="grid gap-2">
            <Button
              className="h-9 justify-start border border-[#8f6a2b] bg-[color:var(--composer-accent)] text-black hover:bg-[#ffbc5c]"
              onClick={onAudioImport}
              disabled={isUploadingAsset}
            >
              <AudioLines className="mr-2 size-4" />
              Import audio bed
            </Button>
            <Button
              variant="ghost"
              className="h-9 justify-start border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
              onClick={onVideoImport}
              disabled={isUploadingAsset}
            >
              <Film className="mr-2 size-4" />
              Import video clips
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as ComposerBinTab)} className="mt-3 flex min-h-0 flex-1 flex-col">
          <TabsList className="grid h-9 grid-cols-3 rounded-lg border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-muted)]">
            <TabsTrigger value="media" className="text-xs uppercase tracking-[0.22em] data-[state=active]:bg-[color:var(--composer-panel)] data-[state=active]:text-[color:var(--composer-text)]">
              Media
            </TabsTrigger>
            <TabsTrigger value="drafts" className="text-xs uppercase tracking-[0.22em] data-[state=active]:bg-[color:var(--composer-panel)] data-[state=active]:text-[color:var(--composer-text)]">
              Drafts
            </TabsTrigger>
            <TabsTrigger value="project" className="text-xs uppercase tracking-[0.22em] data-[state=active]:bg-[color:var(--composer-panel)] data-[state=active]:text-[color:var(--composer-text)]">
              Project
            </TabsTrigger>
          </TabsList>

          <TabsContent value="media" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full pr-1">
              <div className="space-y-2">
                {assets.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--composer-border)] px-3 py-6 text-sm leading-relaxed text-[color:var(--composer-muted)]">
                    Import a master audio track and at least one video clip. Every asset stays reusable inside this project.
                  </div>
                ) : (
                  assets.map((asset) => (
                    <div
                      key={asset.id}
                      className={`${composerInsetClass} p-3`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[color:var(--composer-text)]">
                            {asset.filename}
                          </div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                            {assetLabel(asset)}
                          </div>
                          <div className="mt-1 text-xs text-[color:var(--composer-muted)]">
                            {asset.type === "video"
                              ? `${asset.width ?? "?"}x${asset.height ?? "?"} • ${asset.hasAudio ? "embedded audio" : "silent clip"}`
                              : "Primary audio source"}
                          </div>
                        </div>
                        <span className="rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                          {asset.type}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
                          onClick={() => onAddAssetToTimeline(asset)}
                        >
                          <Plus className="mr-1.5 size-3.5" />
                          {asset.type === "audio" ? "Use as track" : "Insert"}
                        </Button>
                        {asset.type === "video" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 border border-[color:var(--composer-border)] bg-transparent text-[color:var(--composer-muted)] hover:bg-[color:var(--composer-panel)] hover:text-[color:var(--composer-text)]"
                            onClick={() => onCopyAssetPreset(asset)}
                          >
                            <ClipboardCopy className="mr-1.5 size-3.5" />
                            Copy preset
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="drafts" className="mt-3 min-h-0 flex-1">
            <ScrollArea className="h-full pr-1">
              <div className="space-y-2">
                {isLoading && recentProjects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--composer-border)] px-3 py-6 text-sm text-[color:var(--composer-muted)]">
                    Loading drafts…
                  </div>
                ) : recentProjects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[color:var(--composer-border)] px-3 py-6 text-sm text-[color:var(--composer-muted)]">
                    No drafts yet.
                  </div>
                ) : (
                  recentProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className={cn(
                        `${composerInsetClass} w-full px-3 py-3 text-left transition`,
                        activeProjectId === project.id
                          ? "border-[#4c90a5] bg-[#1d2c33]"
                          : "hover:border-[#46505a]"
                      )}
                      onClick={() => onOpenProject(project)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[color:var(--composer-text)]">
                            {project.name}
                          </div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                            {project.status}
                          </div>
                        </div>
                        <FolderOpen className="mt-0.5 size-4 text-[color:var(--composer-muted)]" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="project" className="mt-3 min-h-0 flex-1">
            <div className="grid gap-3">
              <div className={`${composerInsetClass} p-3`}>
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                  <Layers3 className="size-3.5" />
                  Active Project
                </div>
                <div className="text-sm font-medium text-[color:var(--composer-text)]">
                  {projectName}
                </div>
                <div className="mt-3 grid gap-2 text-sm text-[color:var(--composer-text)]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[color:var(--composer-muted)]">Duration</span>
                    <span>{formatTime(projectDurationSeconds)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[color:var(--composer-muted)]">Timeline items</span>
                    <span>{timelineItemCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[color:var(--composer-muted)]">Export ratio</span>
                    <span>{exportRatio}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[color:var(--composer-muted)]">Quality</span>
                    <span className="capitalize">{exportQuality}</span>
                  </div>
                </div>
              </div>

              <div className={`${composerInsetClass} p-3`}>
                <div className="mb-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                  Editing Notes
                </div>
                <div className="space-y-2 text-sm leading-relaxed text-[color:var(--composer-muted)]">
                  <p>V1 keeps one audio lane and one video lane.</p>
                  <p>Video clips stay reusable and linked to the same uploaded asset.</p>
                  <p>Use the timeline context menu or shortcuts to duplicate loop clips quickly.</p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
