"use client";

import { Clapperboard, Clock3, Film, Loader2, Mic, Scissors, X, type LucideIcon } from "lucide-react";

import { useBackgroundTasks, getBackgroundTaskStatusLabel } from "@/components/tasks/BackgroundTaskProvider";
import { isBackgroundTaskActive } from "@/lib/background-tasks/core";
import type { BackgroundTaskKind, BackgroundTaskRecord } from "@/lib/background-tasks/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TASK_ICONS: Record<BackgroundTaskKind, LucideIcon> = {
  transcription: Mic,
  "timeline-bake": Scissors,
  "timeline-export": Film,
  "short-export": Clapperboard,
};

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function statusClasses(task: BackgroundTaskRecord) {
  if (task.status === "failed") return "border-red-400/16 bg-red-500/10 text-red-100";
  if (task.status === "completed") return "border-emerald-400/16 bg-emerald-500/10 text-emerald-100";
  if (task.status === "canceled") return "border-amber-300/16 bg-amber-500/10 text-amber-100";
  return "border-cyan-300/18 bg-cyan-500/10 text-cyan-50";
}

function TaskRow({
  task,
  onCancel,
  onDismiss,
}: {
  task: BackgroundTaskRecord;
  onCancel?: () => void;
  onDismiss?: () => void;
}) {
  const Icon = TASK_ICONS[task.kind];

  return (
    <div className="rounded-[1.35rem] border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/75">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("border px-2.5 py-1", statusClasses(task))}>
                {isBackgroundTaskActive(task) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {getBackgroundTaskStatusLabel(task.status)}
              </Badge>
              <span className="text-[11px] uppercase tracking-[0.24em] text-white/42">{task.kind.replace(/-/g, " ")}</span>
            </div>
            <div className="truncate text-sm font-semibold text-white">{task.title}</div>
            {task.message ? <div className="text-sm text-white/60">{task.message}</div> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onCancel && task.canCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-xl text-white/55 hover:bg-white/10 hover:text-white"
              onClick={onDismiss}
              aria-label="Dismiss task"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {task.progress != null ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-white/42">
            <span>Progress</span>
            <span>{Math.round(task.progress)}%</span>
          </div>
          <Progress
            value={task.progress}
            className="h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-[linear-gradient(90deg,rgba(34,211,238,0.95),rgba(251,191,36,0.95))]"
          />
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between text-xs text-white/42">
        <span>{task.scope.projectId ? `Project ${task.scope.projectId.slice(0, 8)}` : "Global task"}</span>
        <span>{formatTimestamp(task.completedAt ?? task.updatedAt)}</span>
      </div>
    </div>
  );
}

export function BackgroundTasksButton() {
  const {
    tasks,
    activeTasks,
    isTaskDrawerOpen,
    setTaskDrawerOpen,
    cancelTask,
    dismissTask,
  } = useBackgroundTasks();

  const recentTasks = tasks.filter((task) => !isBackgroundTaskActive(task));

  return (
    <Sheet open={isTaskDrawerOpen} onOpenChange={setTaskDrawerOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-10 rounded-2xl border border-white/10 bg-white/5 px-4 text-white/70 hover:bg-white/10 hover:text-white"
        >
          {activeTasks.length > 0 ? <Loader2 className="h-4 w-4 animate-spin text-cyan-300" /> : <Clock3 className="h-4 w-4 text-cyan-300" />}
          Tasks
          <Badge variant="outline" className="border-white/15 bg-black/25 text-white">
            {activeTasks.length}
          </Badge>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-xl border-l border-white/10">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-white/8 px-6 py-5">
            <SheetTitle>Background Tasks</SheetTitle>
            <SheetDescription>
              Long-running transcription, short export, and editor jobs stay visible here while you move around the app.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <Tabs defaultValue="active" className="space-y-5">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="recent">Recent</TabsTrigger>
              </TabsList>

              <TabsContent value="active" className="space-y-4">
                {activeTasks.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-white/10 bg-black/20 p-8 text-center text-sm text-white/48">
                    No tasks are running right now.
                  </div>
                ) : (
                  activeTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onCancel={() => cancelTask(task.id)} />
                  ))
                )}
              </TabsContent>

              <TabsContent value="recent" className="space-y-4">
                {recentTasks.length === 0 ? (
                  <div className="rounded-[1.4rem] border border-dashed border-white/10 bg-black/20 p-8 text-center text-sm text-white/48">
                    Completed, failed, and canceled jobs will land here.
                  </div>
                ) : (
                  recentTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
