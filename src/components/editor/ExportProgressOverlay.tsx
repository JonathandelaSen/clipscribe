"use client";

import { Film, Loader2, X } from "lucide-react";

import { isBrowserRenderCancelableStage, type BrowserRenderStage } from "@/lib/browser-render";
import type { EditorResolution } from "@/lib/editor/types";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type EditorProgressMode = "export" | "bake";

const PHASE_COPY: Record<
  EditorProgressMode,
  Record<BrowserRenderStage, { badge: string; title: string; description: string; helper: string; label: string }>
> = {
  export: {
    preparing: {
      badge: "Preparing",
      title: "Preparing assets and subtitles",
      description: "Setting up the browser render workspace, validating media, and staging caption frames.",
      helper: "Keep this tab open while Timeline Studio assembles the export pipeline.",
      label: "Timeline Export",
    },
    rendering: {
      badge: "Rendering",
      title: "Rendering your timeline",
      description: "",
      helper: "Editing is locked until the MP4 render finishes.",
      label: "Timeline Export",
    },
    handoff: {
      badge: "Finalizing",
      title: "Finalizing the MP4",
      description: "The video is being packaged for download and the export audit trail is being wrapped up.",
      helper: "The file is almost ready. Avoid refreshing or closing this tab now.",
      label: "Timeline Export",
    },
    complete: {
      badge: "Complete",
      title: "Export complete",
      description: "Handing off the finished file and saving the final export metadata before control returns.",
      helper: "One more moment while the editor closes out the export cleanly.",
      label: "Timeline Export",
    },
  },
  bake: {
    preparing: {
      badge: "Preparing",
      title: "Preparing the bake pass",
      description: "Staging the joined clips and building a temporary render timeline for the baked output.",
      helper: "Keep this tab open while FFmpeg.wasm prepares the bake workspace.",
      label: "Bake Clip",
    },
    rendering: {
      badge: "Rendering",
      title: "Baking the joined clip",
      description: "FFmpeg.wasm is rendering the selected joined block into one standalone clip.",
      helper: "Timeline interactions are paused until the baked clip is ready.",
      label: "Bake Clip",
    },
    handoff: {
      badge: "Finalizing",
      title: "Packaging the baked video",
      description: "The baked MP4 is being validated and prepared for insertion back into the timeline.",
      helper: "The rendered clip is almost ready. Avoid refreshing or closing this tab now.",
      label: "Bake Clip",
    },
    complete: {
      badge: "Complete",
      title: "Bake complete",
      description: "Wrapping up the baked clip so Timeline Studio can replace the joined block cleanly.",
      helper: "One more moment while the baked clip is inserted into your project.",
      label: "Bake Clip",
    },
  },
};

function clampProgress(progressPct: number) {
  return Math.min(100, Math.max(0, Math.round(progressPct)));
}

export function ExportProgressOverlay({
  open,
  mode,
  projectName,
  resolution,
  progressPct,
  stage,
  canCancel,
  onCancel,
}: {
  open: boolean;
  mode: EditorProgressMode;
  projectName: string;
  resolution: EditorResolution;
  progressPct: number;
  stage: BrowserRenderStage;
  canCancel?: boolean;
  onCancel?: () => void;
}) {
  const safeProgress = clampProgress(progressPct);
  const copy = PHASE_COPY[mode][stage];
  const showCancel = Boolean(canCancel && onCancel && isBrowserRenderCancelableStage(stage));

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.15),transparent_36%),linear-gradient(180deg,rgba(8,11,16,0.98),rgba(4,7,12,0.98))] p-0 text-white shadow-[0_28px_90px_rgba(0,0,0,0.6)] sm:max-w-[34rem]"
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_38%)]" />
        <div className="relative space-y-6 p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
              <Film className="h-3.5 w-3.5" />
              {copy.label}
            </div>
            <div
              aria-live="polite"
              className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-sm font-semibold text-amber-100"
            >
              {safeProgress}%
            </div>
          </div>

          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2 text-sm text-white/72">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{copy.badge}</span>
            </div>
            <DialogTitle className="text-2xl font-semibold tracking-[-0.03em] text-white">
              {copy.title}
            </DialogTitle>
            <DialogDescription className="max-w-2xl text-sm leading-6 text-white/62">
              {copy.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Progress
              value={safeProgress}
              className="h-3 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[linear-gradient(90deg,rgba(34,211,238,0.95),rgba(251,191,36,0.95))]"
            />
            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-white/46">
              <span>{copy.badge}</span>
              <span>{stage === "complete" ? "Locked until handoff finishes" : "Interaction temporarily blocked"}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-white/10 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">Project</div>
              <div className="mt-2 truncate text-sm font-medium text-white" title={projectName}>
                {projectName}
              </div>
            </div>
            <div className="rounded-[1rem] border border-white/10 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">Output</div>
              <div className="mt-2 text-sm font-medium text-white">{resolution}</div>
            </div>
            <div className="rounded-[1rem] border border-white/10 bg-black/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.24em] text-white/42">Engine</div>
              <div className="mt-2 text-sm font-medium text-white">FFmpeg.wasm</div>
            </div>
          </div>

          <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/66">
            {copy.helper}
          </div>

          <div className="flex items-center justify-end">
            {showCancel ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                onClick={onCancel}
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            ) : (
              <div className="text-xs uppercase tracking-[0.24em] text-white/38">Locked during handoff</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
