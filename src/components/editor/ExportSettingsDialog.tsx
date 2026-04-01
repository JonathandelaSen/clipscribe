"use client";

import { Film, FolderOpen, Loader2 } from "lucide-react";

import {
  EDITOR_EXPORT_ENGINE_LABEL,
  EDITOR_EXPORT_OUTPUT_LABEL,
} from "@/lib/editor/export-capabilities";
import type { EditorResolution } from "@/lib/editor/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RESOLUTION_OPTIONS: EditorResolution[] = ["720p", "1080p", "4K"];

export function ExportSettingsDialog({
  open,
  onOpenChange,
  resolution,
  destinationName,
  canUseSavePicker,
  isPickingDestination,
  isSubmitting,
  blockingReasons,
  onResolutionChange,
  onPickDestination,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resolution: EditorResolution;
  destinationName?: string | null;
  canUseSavePicker: boolean;
  isPickingDestination: boolean;
  isSubmitting: boolean;
  blockingReasons: string[];
  onResolutionChange: (resolution: EditorResolution) => void;
  onPickDestination: () => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
}) {
  const isBlocked = blockingReasons.length > 0;
  const destinationCopy = canUseSavePicker
    ? destinationName || "Choose where the MP4 will be written."
    : "This browser will download the MP4 when the export finishes.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.14),transparent_32%),linear-gradient(180deg,rgba(8,11,16,0.985),rgba(4,7,12,0.985))] p-0 text-white shadow-[0_28px_90px_rgba(0,0,0,0.58)] sm:max-w-[40rem]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_38%)]" />
        <DialogHeader className="relative border-b border-white/8 px-6 py-5 text-left">
          <DialogTitle className="text-2xl font-semibold tracking-[-0.03em] text-white">
            Export timeline
          </DialogTitle>
          <DialogDescription className="text-sm text-white/58">
            Choose the resolution and destination before the export starts.
          </DialogDescription>
        </DialogHeader>

        <div className="relative space-y-5 px-6 py-5">
          <section className="rounded-[1.15rem] border border-white/10 bg-black/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white/86">
              <Film className="h-4 w-4 text-cyan-200" />
              Output
            </div>
            <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/78">
              {EDITOR_EXPORT_OUTPUT_LABEL}
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.24em] text-white/40">Resolution</div>
                <Select value={resolution} onValueChange={(value) => onResolutionChange(value as EditorResolution)}>
                  <SelectTrigger className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white">
                    <SelectValue placeholder="Resolution" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-slate-950 text-white">
                    {RESOLUTION_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.24em] text-white/40">Renderer</div>
                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-white/78">
                  {EDITOR_EXPORT_ENGINE_LABEL}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[1.15rem] border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-white/86">
                  <FolderOpen className="h-4 w-4 text-emerald-200" />
                  Save to
                </div>
                <div className="mt-2 text-sm text-white/58">
                  {destinationCopy}
                </div>
              </div>
              {canUseSavePicker ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => void onPickDestination()}
                  disabled={isPickingDestination || isSubmitting}
                >
                  {isPickingDestination ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
                  {destinationName ? "Change destination" : "Save to..."}
                </Button>
              ) : null}
            </div>
            {!canUseSavePicker ? (
              <div className="mt-3 rounded-xl border border-cyan-300/16 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50/82">
                Native save picking is unavailable here, so Timeline Studio will fall back to a regular browser download.
              </div>
            ) : null}
          </section>

          {isBlocked ? (
            <section className="rounded-[1.15rem] border border-red-400/18 bg-red-500/10 px-4 py-3 text-sm text-red-50/88">
              <div className="text-[10px] uppercase tracking-[0.24em] text-red-100/72">Blocked</div>
              <div className="mt-2 space-y-1.5">
                {blockingReasons.map((reason) => (
                  <div key={reason}>{reason}</div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="relative border-t border-white/8 px-6 py-4 sm:justify-between">
          <div className="text-xs uppercase tracking-[0.24em] text-white/38">
            {EDITOR_EXPORT_ENGINE_LABEL} · {resolution}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-white/15 bg-transparent text-white hover:bg-white/5"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-xl border border-amber-300/15 bg-amber-300/90 text-slate-950 hover:bg-amber-200"
              onClick={() => void onConfirm()}
              disabled={isBlocked || isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
              Start export
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
