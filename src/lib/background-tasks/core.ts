import type {
  BackgroundTaskRecord,
  BackgroundTaskResourceMatch,
  BackgroundTaskStatus,
} from "@/lib/background-tasks/types";

export type BackgroundTaskAction =
  | { type: "enqueue"; task: BackgroundTaskRecord }
  | { type: "patch"; taskId: string; now: number; patch: Partial<BackgroundTaskRecord> }
  | { type: "complete"; taskId: string; now: number; patch?: Partial<BackgroundTaskRecord> }
  | { type: "fail"; taskId: string; now: number; error: string; patch?: Partial<BackgroundTaskRecord> }
  | { type: "cancel"; taskId: string; now: number; patch?: Partial<BackgroundTaskRecord> }
  | { type: "dismiss"; taskId: string };

const ACTIVE_STATUSES = new Set<BackgroundTaskStatus>(["queued", "preparing", "running", "finalizing"]);

function sortTasks(tasks: BackgroundTaskRecord[]) {
  return [...tasks].sort((a, b) => {
    const aTime = a.completedAt ?? a.updatedAt;
    const bTime = b.completedAt ?? b.updatedAt;
    return bTime - aTime;
  });
}

function patchTask(
  tasks: BackgroundTaskRecord[],
  taskId: string,
  patch: Partial<BackgroundTaskRecord> & { updatedAt?: number }
) {
  return sortTasks(
    tasks.map((task) => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        ...patch,
      };
    })
  );
}

export function isBackgroundTaskActive(task: BackgroundTaskRecord) {
  return ACTIVE_STATUSES.has(task.status);
}

export function backgroundTaskReducer(tasks: BackgroundTaskRecord[], action: BackgroundTaskAction): BackgroundTaskRecord[] {
  switch (action.type) {
    case "enqueue":
      return sortTasks([action.task, ...tasks.filter((task) => task.id !== action.task.id)]);
    case "patch":
      return patchTask(tasks, action.taskId, {
        ...action.patch,
        updatedAt: action.now,
      });
    case "complete":
      return patchTask(tasks, action.taskId, {
        ...action.patch,
        status: "completed",
        progress: action.patch?.progress ?? 100,
        completedAt: action.now,
        updatedAt: action.now,
        canCancel: false,
      });
    case "fail":
      return patchTask(tasks, action.taskId, {
        ...action.patch,
        status: "failed",
        error: action.error,
        completedAt: action.now,
        updatedAt: action.now,
        canCancel: false,
      });
    case "cancel":
      return patchTask(tasks, action.taskId, {
        ...action.patch,
        status: "canceled",
        completedAt: action.now,
        updatedAt: action.now,
        canCancel: false,
      });
    case "dismiss":
      return tasks.filter((task) => task.id !== action.taskId);
    default:
      return tasks;
  }
}

export function getTaskForResource(tasks: BackgroundTaskRecord[], match: BackgroundTaskResourceMatch) {
  const matches = tasks.filter((task) => {
    if (match.kind && task.kind !== match.kind) return false;
    if (match.projectId && task.scope.projectId !== match.projectId) return false;
    if (match.assetId && task.scope.assetId !== match.assetId) return false;
    return true;
  });

  const activeMatch = matches.find(isBackgroundTaskActive);
  return activeMatch ?? matches[0];
}
