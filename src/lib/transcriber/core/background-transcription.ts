import { makeId, syncOriginalSubtitleVersion, type SubtitleChunk, type TranscriptVersion } from "../../history";
import { updateTranscriptInHistoryItems, upsertTranscribingTranscriptProject } from "./history-updates";
import { ensureProjectAssetForTranscription, type TranscribeProjectAssetOptions } from "./project-asset";
import { historyItemToTranscriptRecord } from "./history-records";
import type { ProjectRepository } from "../../repositories/project-repo";

type WorkerProgressPayload = {
  file: string;
  name: string;
  progress: number;
  status?: string;
};

type WorkerEventPayload = {
  status: "progress" | "ready" | "info" | "chunk_progress" | "update" | "chunk" | "complete" | "error";
  data?: WorkerProgressPayload & { language?: string };
  output?: unknown;
  error?: string;
  message?: string;
  progress?: number;
};

type TranscriptionWorker = {
  addEventListener: (type: "message", listener: (event: MessageEvent<WorkerEventPayload>) => void) => void;
  removeEventListener?: (type: "message", listener: (event: MessageEvent<WorkerEventPayload>) => void) => void;
  postMessage: (message: { type: "transcribe"; audio: Float32Array; duration: number; language?: string }) => void;
  terminate: () => void;
};

type TranscriptTaskRef = {
  projectId: string;
  assetId: string;
  transcriptVersionId: string;
};

export interface BackgroundTranscriptionTaskHandle {
  promise: Promise<void>;
  cancel: () => void;
}

export interface BackgroundTranscriptionTaskOptions extends TranscribeProjectAssetOptions {
  file: File;
  language: string;
}

export interface BackgroundTranscriptionDependencies {
  decodeAudio: (file: File) => Promise<Float32Array>;
  createWorker: () => TranscriptionWorker;
  repository: ProjectRepository;
}

export interface BackgroundTranscriptionCallbacks {
  onTaskUpdate: (update: {
    status?: "preparing" | "running" | "finalizing";
    progress?: number | null;
    message?: string;
  }) => void;
}

function getDetectedLanguage(output: unknown, fallbackLanguage?: string) {
  const primaryOutput = Array.isArray(output) ? output[0] : output;
  if (primaryOutput && typeof primaryOutput === "object" && "language" in primaryOutput) {
    const candidate = primaryOutput.language;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return fallbackLanguage || "unknown";
}

function getTextOutput(output: unknown) {
  const primaryOutput = Array.isArray(output) ? output[0] : output;
  if (primaryOutput && typeof primaryOutput === "object" && "text" in primaryOutput) {
    return typeof primaryOutput.text === "string" ? primaryOutput.text : undefined;
  }
  return undefined;
}

function getChunkOutput(output: unknown) {
  const primaryOutput = Array.isArray(output) ? output[0] : output;
  if (primaryOutput && typeof primaryOutput === "object" && "chunks" in primaryOutput && Array.isArray(primaryOutput.chunks)) {
    return primaryOutput.chunks as SubtitleChunk[];
  }
  return undefined;
}

async function updateTranscriptVersion(
  repository: ProjectRepository,
  task: TranscriptTaskRef,
  updater: (transcript: TranscriptVersion) => TranscriptVersion
) {
  const record = await repository.getAssetTranscript(task.assetId);
  if (!record) return;

  const nextHistory = updateTranscriptInHistoryItems(
    [
      {
        id: record.assetId,
        mediaId: record.assetId,
        filename: "",
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        timestamp: record.timestamp,
        activeTranscriptVersionId: record.activeTranscriptVersionId,
        transcripts: record.transcripts,
      },
    ],
    {
      projectId: task.assetId,
      transcriptVersionId: task.transcriptVersionId,
      now: Date.now(),
      updater,
    }
  );
  const nextItem = nextHistory[0];
  if (!nextItem) return;
  await repository.putAssetTranscript(historyItemToTranscriptRecord(nextItem, task.projectId));
}

export function startBackgroundTranscriptionTask(
  options: BackgroundTranscriptionTaskOptions,
  dependencies: BackgroundTranscriptionDependencies,
  callbacks: BackgroundTranscriptionCallbacks
): BackgroundTranscriptionTaskHandle {
  let worker: TranscriptionWorker | null = null;
  let isCanceled = false;
  let activeTask: TranscriptTaskRef | null = null;
  let hasSettled = false;
  let resolveWorkerRun: (() => void) | null = null;
  let messageListener: ((event: MessageEvent<WorkerEventPayload>) => void) | null = null;

  const persistCanceledTask = async () => {
    if (!activeTask) return;
    await updateTranscriptVersion(dependencies.repository, activeTask, (transcript) => ({
      ...transcript,
      status: "stopped",
      updatedAt: Date.now(),
    }));
  };

  const cancel = () => {
    isCanceled = true;
    if (worker && messageListener && worker.removeEventListener) {
      worker.removeEventListener("message", messageListener);
      messageListener = null;
    }
    if (worker) {
      worker.terminate();
      worker = null;
    }
    void persistCanceledTask().finally(() => {
      resolveWorkerRun?.();
      resolveWorkerRun = null;
    });
  };

  const promise = (async () => {
    callbacks.onTaskUpdate({
      status: "preparing",
      progress: 2,
      message: "Preparing audio",
    });

    const audioData = await dependencies.decodeAudio(options.file);
    if (isCanceled) return;

    const duration = audioData.length / 16000;
    const { projectId, assetId } = await ensureProjectAssetForTranscription(
      dependencies.repository,
      options.file,
      options,
      duration
    );
    if (isCanceled) return;

    const transcriptVersionId = makeId("tx");
    activeTask = { projectId, assetId, transcriptVersionId };

    const now = Date.now();
    const history = await dependencies.repository.listProjectHistory(projectId);
    const nextHistory = upsertTranscribingTranscriptProject(history, {
      now,
      projectId: assetId,
      transcriptVersionId,
      fileName: options.file.name,
      requestedLanguage: options.language,
    });
    const nextItem = nextHistory.find((item) => item.id === assetId);
    if (!nextItem) {
      throw new Error("Failed to create the transcription history entry.");
    }
    await dependencies.repository.putAssetTranscript(historyItemToTranscriptRecord(nextItem, projectId));

    callbacks.onTaskUpdate({
      status: "preparing",
      progress: 5,
      message: "Loading transcription model",
    });

    worker = dependencies.createWorker();

    await new Promise<void>((resolve, reject) => {
      resolveWorkerRun = resolve;
      messageListener = (event: MessageEvent<WorkerEventPayload>) => {
        if (hasSettled || isCanceled) return;
        const payload = event.data;

        if (payload.status === "progress") {
          callbacks.onTaskUpdate({
            status: "preparing",
            progress: typeof payload.data?.progress === "number" ? Math.round(payload.data.progress) : null,
            message: payload.data?.name ? `Loading ${payload.data.name}` : "Loading transcription model",
          });
          return;
        }

        if (payload.status === "ready") {
          callbacks.onTaskUpdate({
            status: "running",
            progress: 0,
            message: "Transcribing audio",
          });
          return;
        }

        if (payload.status === "chunk_progress") {
          callbacks.onTaskUpdate({
            status: "running",
            progress: typeof payload.progress === "number" ? payload.progress : 0,
            message: "Transcribing audio",
          });
          return;
        }

        if (payload.status === "complete") {
          hasSettled = true;
          if (worker && messageListener && worker.removeEventListener) {
            worker.removeEventListener("message", messageListener);
            messageListener = null;
          }
          callbacks.onTaskUpdate({
            status: "finalizing",
            progress: 96,
            message: "Saving transcript",
          });

          void updateTranscriptVersion(dependencies.repository, activeTask!, (transcript) => {
            const now = Date.now();
            const textOutput = getTextOutput(payload.output);
            const chunkOutput = getChunkOutput(payload.output);
            const detectedLanguage = getDetectedLanguage(payload.output, options.language);
            let updated: TranscriptVersion = {
              ...transcript,
              status: "completed",
              transcript: textOutput ?? transcript.transcript,
              chunks: chunkOutput ?? transcript.chunks,
              detectedLanguage,
              error: undefined,
              updatedAt: now,
            };
            updated = syncOriginalSubtitleVersion(updated, {
              chunks: (chunkOutput ?? transcript.chunks ?? []) as SubtitleChunk[],
              language: detectedLanguage,
              now,
            });
            return updated;
          })
            .then(() => resolve())
            .catch(reject);
          return;
        }

        if (payload.status === "error") {
          hasSettled = true;
          if (worker && messageListener && worker.removeEventListener) {
            worker.removeEventListener("message", messageListener);
            messageListener = null;
          }
          void updateTranscriptVersion(dependencies.repository, activeTask!, (transcript) => ({
            ...transcript,
            status: "error",
            error: payload.error || "Transcription failed.",
            updatedAt: Date.now(),
          }))
            .then(() => reject(new Error(payload.error || "Transcription failed.")))
            .catch(reject);
        }
      };

      worker!.addEventListener("message", messageListener);
      worker!.postMessage({
        type: "transcribe",
        audio: audioData,
        duration,
        language: options.language,
      });
    });
  })().finally(() => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  });

  return {
    promise,
    cancel,
  };
}
