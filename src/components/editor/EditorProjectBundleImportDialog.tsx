"use client";

import { Film, Music4, RotateCcw, VolumeX } from "lucide-react";

import type { NormalizedEditorProjectBundleManifestV1 } from "@/lib/editor/bundle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatTrimWindow(startSeconds: number, endSeconds: number | null): string {
  return endSeconds == null
    ? `${startSeconds.toFixed(2)}s -> source end`
    : `${startSeconds.toFixed(2)}s -> ${endSeconds.toFixed(2)}s`;
}

export function EditorProjectBundleImportDialog({
  open,
  onOpenChange,
  manifest,
  rootDirectoryName,
  isImporting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest: NormalizedEditorProjectBundleManifestV1 | null;
  rootDirectoryName?: string;
  isImporting: boolean;
  onConfirm: () => void;
}) {
  if (!manifest) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.985),rgba(4,7,12,0.985))] p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.48)]">
        <DialogHeader className="border-b border-white/8 px-6 py-5 text-left">
          <DialogTitle className="text-2xl font-semibold tracking-tight text-white">Import bundle</DialogTitle>
          <DialogDescription className="text-sm text-white/55">
            {manifest.videoClips.length} clip{manifest.videoClips.length === 1 ? "" : "s"} · {manifest.audioItem ? "1 audio item" : "no audio"}{rootDirectoryName ? ` · ${rootDirectoryName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <section className="rounded-2xl border border-white/8 bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-lg font-semibold text-white">{manifest.name}</div>
              <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
                {manifest.aspectRatio}
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/8 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white/76">
              <Film className="h-4 w-4 text-cyan-200" />
              Clips
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {manifest.videoClips.map((clip, index) => (
                <div
                  key={`${clip.path}-${index}`}
                  className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-white/92">
                      {index + 1}. {clip.label}
                    </div>
                    {clip.reverse ? (
                      <div className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-amber-100">
                        <RotateCcw className="h-3 w-3" />
                        Reverse
                      </div>
                    ) : null}
                    {clip.muted ? (
                      <div className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] text-white/70">
                        <VolumeX className="h-3 w-3" />
                        Muted
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-white/52">
                    {formatTrimWindow(clip.trimStartSeconds, clip.trimEndSeconds)} · volume {(clip.volume * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </section>

          {manifest.audioItem ? (
            <section className="space-y-2 rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white/76">
                <Music4 className="h-4 w-4 text-amber-200" />
                Audio
              </div>
              <div className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5 text-sm text-white/82">
                <div className="font-medium">{manifest.audioItem.path}</div>
                <div className="mt-1 text-xs text-white/52">
                  {formatTrimWindow(manifest.audioItem.trimStartSeconds, manifest.audioItem.trimEndSeconds)} · starts at {manifest.audioItem.startOffsetSeconds.toFixed(2)}s · volume {(manifest.audioItem.volume * 100).toFixed(0)}%
                  {manifest.audioItem.muted ? " · muted" : ""}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="border-t border-white/8 px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            className="border border-white/10 bg-white/[0.03] text-white/72 hover:bg-white/[0.08] hover:text-white"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="border border-cyan-300/20 bg-cyan-300/90 text-slate-950 hover:bg-cyan-200"
            onClick={onConfirm}
            disabled={isImporting}
          >
            {isImporting ? "Importing..." : "Import Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

