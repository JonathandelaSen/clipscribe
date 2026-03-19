"use client";

import { Loader2, X } from "lucide-react";

import type { BackgroundTaskRecord } from "@/lib/background-tasks/types";
import { isBackgroundTaskActive } from "@/lib/background-tasks/core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getBackgroundTaskStatusLabel } from "@/components/tasks/BackgroundTaskProvider";

function statusTone(task: BackgroundTaskRecord) {
  if (task.status === "failed") return "text-red-200 bg-red-500/12 border-red-400/18";
  if (task.status === "completed") return "text-emerald-100 bg-emerald-500/10 border-emerald-400/16";
  if (task.status === "canceled") return "text-amber-100 bg-amber-500/10 border-amber-300/16";
  return "text-cyan-100 bg-cyan-500/10 border-cyan-300/18";
}

export function BackgroundTaskBanner({
  task,
  onCancel,
}: {
  task: BackgroundTaskRecord;
  onCancel?: () => void;
}) {
  return (
    <div className={cn("rounded-[1.2rem] border p-4 shadow-[0_16px_50px_rgba(0,0,0,0.28)]", statusTone(task))}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/70">
              {isBackgroundTaskActive(task) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {getBackgroundTaskStatusLabel(task.status)}
            </span>
            <div className="text-sm text-white/55">{task.kind.replace(/-/g, " ")}</div>
          </div>
          <div>
            <div className="text-base font-semibold text-white">{task.title}</div>
            {task.message ? <div className="mt-1 text-sm text-white/68">{task.message}</div> : null}
          </div>
        </div>

        <div className="flex min-w-[220px] flex-col gap-3">
          {task.progress != null ? (
            <>
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-white/45">
                <span>Progress</span>
                <span>{Math.round(task.progress)}%</span>
              </div>
              <Progress
                value={task.progress}
                className="h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[linear-gradient(90deg,rgba(34,211,238,0.95),rgba(251,191,36,0.95))]"
              />
            </>
          ) : null}
          {onCancel && task.canCancel ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                onClick={onCancel}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
