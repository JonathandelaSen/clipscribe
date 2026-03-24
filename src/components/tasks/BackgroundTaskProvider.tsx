"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { decodeAudio } from "@/lib/audio";
import { backgroundTaskReducer, getTaskForResource as findTaskForResource, isBackgroundTaskActive } from "@/lib/background-tasks/core";
import type {
  BackgroundTaskKind,
  BackgroundTaskRecord,
  BackgroundTaskScope,
  BackgroundTaskStatus,
} from "@/lib/background-tasks/types";
import { makeId } from "@/lib/history";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import { projectHistoryItemToTranscriptRecord } from "@/lib/transcriber/core/history-records";
import { markInterruptedTranscriptsAsErrored } from "@/lib/transcriber/core/history-updates";
import { startBackgroundTranscriptionTask } from "@/lib/transcriber/core/background-transcription";

type ManagedTaskContext = {
  taskId: string;
  update: (patch: Partial<BackgroundTaskRecord>) => void;
  setCancel: (cancel: (() => void) | undefined) => void;
  isCanceled: () => boolean;
};

type StartManagedTaskOptions = {
  kind: BackgroundTaskKind;
  title: string;
  message?: string;
  scope: BackgroundTaskScope;
  run: (context: ManagedTaskContext) => Promise<void>;
};

type StartTranscriptionOptions = {
  file: File;
  language: string;
  projectId?: string;
  assetId?: string;
};

type StartEditorTaskOptions = {
  projectId: string;
  title: string;
  message?: string;
  run: (context: ManagedTaskContext) => Promise<void>;
};

type BackgroundTaskHandle = {
  cancelRequested: boolean;
  cancel?: () => void;
};

type BackgroundTasksContextValue = {
  tasks: BackgroundTaskRecord[];
  activeTasks: BackgroundTaskRecord[];
  isTaskDrawerOpen: boolean;
  setTaskDrawerOpen: (open: boolean) => void;
  startTranscription: (options: StartTranscriptionOptions) => string;
  startTimelineExport: (options: StartEditorTaskOptions) => string;
  startTimelineBake: (options: StartEditorTaskOptions) => string;
  startShortExport: (options: StartEditorTaskOptions) => string;
  cancelTask: (taskId: string) => void;
  dismissTask: (taskId: string) => void;
  getTaskForResource: (scope: BackgroundTaskScope & { kind?: BackgroundTaskKind }) => BackgroundTaskRecord | undefined;
};

const BackgroundTasksContext = createContext<BackgroundTasksContextValue | null>(null);

export function BackgroundTaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, dispatch] = useReducer(backgroundTaskReducer, []);
  const [isTaskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const taskHandlesRef = useRef(new Map<string, BackgroundTaskHandle>());
  const tasksRef = useRef<BackgroundTaskRecord[]>([]);
  const projectRepositoryRef = useRef(createDexieProjectRepository());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    let isDisposed = false;

    const repairInterruptedTranscripts = async () => {
      const history = await projectRepositoryRef.current.listProjectHistory();
      if (isDisposed || history.length === 0) return;
      const nextHistory = markInterruptedTranscriptsAsErrored(history, {
        now: Date.now(),
      }) as typeof history;

      await Promise.all(
        nextHistory.map(async (item, index) => {
          const current = history[index];
          if (!current) return;
          const didChange = current.transcripts.some((transcript, transcriptIndex) => {
            const nextTranscript = item.transcripts[transcriptIndex];
            return transcript.status !== nextTranscript?.status || transcript.error !== nextTranscript?.error;
          });
          if (!didChange) return;
          await projectRepositoryRef.current.putAssetTranscript(projectHistoryItemToTranscriptRecord(item));
        })
      );
    };

    void repairInterruptedTranscripts();

    return () => {
      isDisposed = true;
    };
  }, []);

  const cancelTask = useCallback((taskId: string) => {
    const handle = taskHandlesRef.current.get(taskId);
    if (!handle || handle.cancelRequested) return;

    handle.cancelRequested = true;
    try {
      handle.cancel?.();
    } catch (error) {
      console.error("Failed to cancel background task", error);
    }

    dispatch({
      type: "cancel",
      taskId,
      now: Date.now(),
      patch: {
        message: "Canceled by user",
      },
    });
  }, []);

  const dismissTask = useCallback((taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (!task || isBackgroundTaskActive(task)) return;
    dispatch({ type: "dismiss", taskId });
  }, []);

  const startManagedTask = useCallback((options: StartManagedTaskOptions) => {
    const existingTask = findTaskForResource(tasksRef.current, {
      kind: options.kind,
      projectId: options.scope.projectId,
      assetId: options.scope.assetId,
    });

    if (existingTask && isBackgroundTaskActive(existingTask)) {
      return existingTask.id;
    }

    const now = Date.now();
    const taskId = makeId("task");
    const handle: BackgroundTaskHandle = {
      cancelRequested: false,
    };
    taskHandlesRef.current.set(taskId, handle);

    dispatch({
      type: "enqueue",
      task: {
        id: taskId,
        kind: options.kind,
        title: options.title,
        message: options.message,
        status: "queued",
        progress: 0,
        canCancel: true,
        scope: options.scope,
        startedAt: now,
        updatedAt: now,
      },
    });

    const context: ManagedTaskContext = {
      taskId,
      update: (patch) => {
        if (handle.cancelRequested && patch.status !== "canceled") return;
        dispatch({
          type: "patch",
          taskId,
          now: Date.now(),
          patch,
        });
      },
      setCancel: (cancel) => {
        handle.cancel = cancel;
        if (handle.cancelRequested) {
          try {
            cancel?.();
          } catch (error) {
            console.error("Failed to cancel background task", error);
          }
        }
      },
      isCanceled: () => handle.cancelRequested,
    };

    void Promise.resolve()
      .then(() => options.run(context))
      .then(() => {
        if (handle.cancelRequested) return;
        dispatch({
          type: "complete",
          taskId,
          now: Date.now(),
          patch: {
            message:
              options.kind === "transcription"
                ? "Transcript ready"
                : options.kind === "short-export"
                  ? "Short export ready"
                  : "Task complete",
          },
        });
      })
      .catch((error) => {
        if (handle.cancelRequested) return;
        dispatch({
          type: "fail",
          taskId,
          now: Date.now(),
          error: error instanceof Error ? error.message : "Task failed",
        });
      })
      .finally(() => {
        taskHandlesRef.current.delete(taskId);
      });

    return taskId;
  }, []);

  const startTranscription = useCallback(
    (options: StartTranscriptionOptions) => {
      return startManagedTask({
        kind: "transcription",
        title: `Transcribing ${options.file.name}`,
        message: `Queued in ${options.language.toUpperCase()}`,
        scope: {
          projectId: options.projectId,
          assetId: options.assetId,
        },
        run: async (context) => {
          const task = startBackgroundTranscriptionTask(
            options,
            {
              decodeAudio,
              repository: projectRepositoryRef.current,
              createWorker: () =>
                new Worker(new URL("../../lib/worker.ts", import.meta.url), {
                  type: "module",
                }),
            },
            {
              onTaskUpdate: (update) => {
                context.update(update);
              },
            }
          );

          context.setCancel(task.cancel);
          await task.promise;
        },
      });
    },
    [startManagedTask]
  );

  const startTimelineExport = useCallback(
    (options: StartEditorTaskOptions) =>
      startManagedTask({
        kind: "timeline-export",
        title: options.title,
        message: options.message,
        scope: {
          projectId: options.projectId,
        },
        run: options.run,
      }),
    [startManagedTask]
  );

  const startTimelineBake = useCallback(
    (options: StartEditorTaskOptions) =>
      startManagedTask({
        kind: "timeline-bake",
        title: options.title,
        message: options.message,
        scope: {
          projectId: options.projectId,
        },
        run: options.run,
      }),
    [startManagedTask]
  );

  const startShortExport = useCallback(
    (options: StartEditorTaskOptions) =>
      startManagedTask({
        kind: "short-export",
        title: options.title,
        message: options.message,
        scope: {
          projectId: options.projectId,
        },
        run: options.run,
      }),
    [startManagedTask]
  );

  const activeTasks = useMemo(() => tasks.filter(isBackgroundTaskActive), [tasks]);

  const getTaskForResource = useCallback(
    (scope: BackgroundTaskScope & { kind?: BackgroundTaskKind }) => findTaskForResource(tasksRef.current, scope),
    []
  );

  const value = useMemo<BackgroundTasksContextValue>(
    () => ({
      tasks,
      activeTasks,
      isTaskDrawerOpen,
      setTaskDrawerOpen,
      startTranscription,
      startTimelineExport,
      startTimelineBake,
      startShortExport,
      cancelTask,
      dismissTask,
      getTaskForResource,
    }),
    [
      tasks,
      activeTasks,
      isTaskDrawerOpen,
      startTranscription,
      startTimelineExport,
      startTimelineBake,
      startShortExport,
      cancelTask,
      dismissTask,
      getTaskForResource,
    ]
  );

  return <BackgroundTasksContext.Provider value={value}>{children}</BackgroundTasksContext.Provider>;
}

export function useBackgroundTasks() {
  const context = useContext(BackgroundTasksContext);
  if (!context) {
    throw new Error("useBackgroundTasks must be used inside BackgroundTaskProvider.");
  }
  return context;
}

export function getBackgroundTaskStatusLabel(status: BackgroundTaskStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing";
    case "running":
      return "Running";
    case "finalizing":
      return "Finalizing";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}
