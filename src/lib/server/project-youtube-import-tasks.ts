import { makeId } from "@/lib/history";
import {
  importProjectYouTubeVideo,
  type ImportedProjectYouTubeVideo,
} from "@/lib/server/project-youtube-import";

type TaskStatus = "queued" | "preparing" | "running" | "finalizing" | "completed" | "failed" | "canceled";

export interface ProjectYouTubeImportTaskSnapshot {
  id: string;
  status: TaskStatus;
  progress: number | null;
  message?: string;
  logLines: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

type ProjectYouTubeImportTaskRecord = ProjectYouTubeImportTaskSnapshot & {
  controller: AbortController;
  result?: ImportedProjectYouTubeVideo;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const TASK_RETENTION_MS = 10 * 60 * 1000;
const MAX_LOG_LINES = 120;
const taskStore = new Map<string, ProjectYouTubeImportTaskRecord>();

function scheduleCleanup(taskId: string) {
  const task = taskStore.get(taskId);
  if (!task) return;
  if (task.cleanupTimer) {
    clearTimeout(task.cleanupTimer);
  }
  task.cleanupTimer = setTimeout(() => {
    taskStore.delete(taskId);
  }, TASK_RETENTION_MS);
}

function trimLogLines(lines: string[]) {
  return lines.slice(-MAX_LOG_LINES);
}

function patchTask(taskId: string, patch: Partial<ProjectYouTubeImportTaskRecord>) {
  const task = taskStore.get(taskId);
  if (!task) return;
  const nextTask: ProjectYouTubeImportTaskRecord = {
    ...task,
    ...patch,
    updatedAt: Date.now(),
  };
  taskStore.set(taskId, nextTask);
}

function createInitialTask(taskId: string): ProjectYouTubeImportTaskRecord {
  const now = Date.now();
  return {
    id: taskId,
    status: "queued",
    progress: 0,
    message: "Queued",
    logLines: [],
    createdAt: now,
    updatedAt: now,
    controller: new AbortController(),
  };
}

export function startProjectYouTubeImportTask(url: string) {
  const taskId = makeId("ytimport");
  const task = createInitialTask(taskId);
  taskStore.set(taskId, task);

  void importProjectYouTubeVideo(
    {
      url,
      signal: task.controller.signal,
    },
    {
      onProgress: (update) => {
        const nextStatus: TaskStatus =
          update.phase === "metadata"
            ? "preparing"
            : update.phase === "download"
              ? "running"
              : "finalizing";
        const current = taskStore.get(taskId);
        const nextLogs = update.logLine ? trimLogLines([...(current?.logLines ?? []), update.logLine]) : current?.logLines;
        patchTask(taskId, {
          status: nextStatus,
          progress: update.progress ?? current?.progress ?? 0,
          message: update.message ?? current?.message,
          logLines: nextLogs,
        });
      },
    }
  )
    .then((result) => {
      patchTask(taskId, {
        status: "completed",
        progress: 100,
        message: "YouTube import ready.",
        result,
      });
      scheduleCleanup(taskId);
    })
    .catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        patchTask(taskId, {
          status: "canceled",
          message: "Canceled by user.",
        });
      } else {
        patchTask(taskId, {
          status: "failed",
          error: error instanceof Error ? error.message : "YouTube import failed.",
          message: "Import failed.",
        });
      }
      scheduleCleanup(taskId);
    });

  return taskId;
}

export function getProjectYouTubeImportTask(taskId: string): ProjectYouTubeImportTaskSnapshot | undefined {
  const task = taskStore.get(taskId);
  if (!task) return undefined;
  const { controller: _controller, result: _result, cleanupTimer: _cleanupTimer, ...snapshot } = task;
  void _controller;
  void _result;
  void _cleanupTimer;
  return snapshot;
}

export function cancelProjectYouTubeImportTask(taskId: string) {
  const task = taskStore.get(taskId);
  if (!task) return false;
  if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
    return false;
  }
  task.controller.abort();
  return true;
}

export function consumeProjectYouTubeImportTaskResult(taskId: string): ImportedProjectYouTubeVideo | undefined {
  const task = taskStore.get(taskId);
  if (!task || task.status !== "completed" || !task.result) return undefined;
  return task.result;
}
