import { useState, useEffect, useRef, useCallback } from "react";
import {
  makeId,
  shiftSubtitleChunks,
  sortHistoryItems,
  sortSubtitleVersions,
  syncOriginalSubtitleVersion,
  type HistoryItem,
  type SubtitleChunk,
  type SubtitleVersion,
  type TranscriptVersion,
} from "@/lib/history";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import {
  markInterruptedTranscriptsAsErrored,
  updateTranscriptInHistoryItems,
  upsertTranscribingTranscriptProject,
} from "@/lib/transcriber/core/history-updates";
import { upsertProgressItem } from "@/lib/transcriber/core/progress";
import { createEditorAssetRecord, createEmptyEditorProject } from "@/lib/editor/storage";
import type { AssetTranscriptRecord, ContentProjectRecord, ProjectAssetRecord } from "@/lib/projects/types";

export type { HistoryItem } from "@/lib/history";

export interface TranscriberProgress {
  file: string;
  name: string;
  progress: number;
  status: string;
}

type ActiveTask = {
  projectId: string;
  assetId: string;
  transcriptVersionId: string;
};

type TranscribeOptions = {
  projectId?: string;
  assetId?: string;
};

function inferAssetKind(file: File): ProjectAssetRecord["kind"] {
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) return "video";
  return "audio";
}

function historyItemToTranscriptRecord(item: HistoryItem, projectId: string): AssetTranscriptRecord {
  return {
    assetId: item.id,
    projectId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    timestamp: item.timestamp,
    activeTranscriptVersionId: item.activeTranscriptVersionId,
    transcripts: item.transcripts,
  };
}

export function useTranscriber() {
  const projectRepository = useRef(createDexieProjectRepository());
  const [transcript, setTranscript] = useState<string>("");
  const [chunks, setChunks] = useState<SubtitleChunk[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [progressItems, setProgressItems] = useState<TranscriberProgress[]>([]);
  const [audioProgress, setAudioProgress] = useState<number>(0);
  const [debugLog, setDebugLog] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const currentTaskRef = useRef<ActiveTask | null>(null);
  const worker = useRef<Worker | null>(null);
  const initializedStorage = useRef(false);

  const refreshHistory = useCallback(async () => {
    const stored = await projectRepository.current.listProjectHistory();
    const normalized = markInterruptedTranscriptsAsErrored(sortHistoryItems(stored || []), {
      now: Date.now(),
    });
    setHistory(normalized);
    return normalized;
  }, []);

  const persistHistoryItem = useCallback(async (item: HistoryItem, projectId: string) => {
    await projectRepository.current.putAssetTranscript(historyItemToTranscriptRecord(item, projectId));
  }, []);

  const mutateHistory = useCallback(
    async (updater: (prev: HistoryItem[]) => HistoryItem[], options?: { projectId?: string; assetId?: string }) => {
      let nextItems: HistoryItem[] = [];
      setHistory((prev) => {
        nextItems = sortHistoryItems(updater(prev));
        return nextItems;
      });

      if (options?.assetId) {
        const nextItem = nextItems.find((item) => item.id === options.assetId);
        if (nextItem && options.projectId) {
          await persistHistoryItem(nextItem, options.projectId);
        }
      }
    },
    [persistHistoryItem]
  );

  const updateTranscriptInHistory = useCallback(
    async (
      assetId: string,
      projectId: string,
      transcriptVersionId: string,
      updater: (transcript: TranscriptVersion) => TranscriptVersion
    ) => {
      await mutateHistory(
        (prev) =>
          updateTranscriptInHistoryItems(prev, {
            projectId: assetId,
            transcriptVersionId,
            now: Date.now(),
            updater,
          }),
        { projectId, assetId }
      );
    },
    [mutateHistory]
  );

  const appendLog = useCallback((message: string) => {
    if (process.env.NEXT_PUBLIC_ENABLE_LOGS === "true") {
      setDebugLog((prev) => (prev ? `${prev}\n${message}` : message));
    }
  }, []);

  useEffect(() => {
    if (initializedStorage.current) return;

    let cancelled = false;

    projectRepository.current
      .listProjectHistory()
      .then((stored) => {
        if (cancelled) return;
        const normalized = markInterruptedTranscriptsAsErrored(sortHistoryItems(stored || []), {
          now: Date.now(),
        });
        setHistory(normalized);
        initializedStorage.current = true;
      })
      .catch((e) => {
        console.error("Failed to load transcripts from DB", e);
        initializedStorage.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const ensureProjectAsset = useCallback(
    async (file: File, options: TranscribeOptions, durationSeconds: number) => {
      if (options.projectId && options.assetId) {
        const existingAsset = await projectRepository.current.getAsset(options.assetId);
        if (!existingAsset) {
          throw new Error("Selected source asset no longer exists.");
        }

        const updatedAsset: ProjectAssetRecord = {
          ...existingAsset,
          filename: file.name,
          mimeType: file.type || existingAsset.mimeType,
          sizeBytes: file.size,
          durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : existingAsset.durationSeconds,
          fileBlob: file,
          updatedAt: Date.now(),
        };
        await projectRepository.current.bulkPutAssets([updatedAsset]);
        return { projectId: existingAsset.projectId, assetId: existingAsset.id };
      }

      const now = Date.now();
      const project = createEmptyEditorProject({
        id: options.projectId,
        now,
        name: file.name.replace(/\.[^.]+$/, "") || "Untitled Project",
      }) as ContentProjectRecord;
      const asset = createEditorAssetRecord({
        id: options.assetId,
        projectId: project.id,
        role: "source",
        origin: "upload",
        kind: inferAssetKind(file),
        filename: file.name,
        mimeType: file.type || (file.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "audio/mpeg"),
        sizeBytes: file.size,
        durationSeconds,
        hasAudio: true,
        sourceType: "upload",
        captionSource: { kind: "none" },
        fileBlob: file,
        now,
      });

      project.activeSourceAssetId = asset.id;
      project.assetIds = [asset.id];

      await projectRepository.current.putProject(project);
      await projectRepository.current.bulkPutAssets([asset]);
      return { projectId: project.id, assetId: asset.id };
    },
    []
  );

  const initWorker = useCallback(() => {
    if (worker.current) return;

    worker.current = new Worker(new URL("../lib/worker.ts", import.meta.url), {
      type: "module",
    });

    worker.current.addEventListener("message", (e) => {
      const { status, data, output, error, duration } = e.data;
      const task = currentTaskRef.current;

      const updateCurrentTranscript = async (updater: (tx: TranscriptVersion) => TranscriptVersion) => {
        if (!task) return;
        await updateTranscriptInHistory(task.assetId, task.projectId, task.transcriptVersionId, updater);
      };

      switch (status) {
        case "progress":
          if (data?.name) {
            appendLog(`PROGRESS: ${data.name} ${Math.round(data.progress || 0)}%`);
          }
          setProgressItems((prev) => upsertProgressItem(prev, data));
          break;
        case "ready":
          appendLog("READY: Model loaded");
          setProgressItems([]);
          break;
        case "info":
          appendLog(`INFO: ${e.data.message}`);
          break;
        case "chunk_progress":
          setAudioProgress(e.data.progress);
          break;
        case "chunk":
        case "update": {
          const currentOutput = output && output[0] ? output[0] : output;
          appendLog(`UPDATE: ${JSON.stringify(currentOutput).substring(0, 100)}`);
          if (currentOutput?.text) {
            const nextText = String(currentOutput.text);
            const nextChunks = Array.isArray(currentOutput.chunks) ? (currentOutput.chunks as SubtitleChunk[]) : [];
            setTranscript(nextText);
            setChunks(nextChunks);

            void updateCurrentTranscript((tx) => {
              const now = Date.now();
              let updated: TranscriptVersion = {
                ...tx,
                transcript: nextText,
                chunks: nextChunks,
                updatedAt: now,
              };
              updated = syncOriginalSubtitleVersion(updated, {
                chunks: nextChunks,
                language: updated.detectedLanguage ?? updated.requestedLanguage,
                now,
              });
              return updated;
            });
          }
          if (duration && currentOutput?.chunks && currentOutput.chunks.length > 0) {
            const lastChunk = currentOutput.chunks[currentOutput.chunks.length - 1];
            if (lastChunk.timestamp && lastChunk.timestamp[1] !== null) {
              setAudioProgress(Math.min(100, Math.round((lastChunk.timestamp[1] / duration) * 100)));
            }
          }
          break;
        }
        case "complete": {
          appendLog(`COMPLETE: ${JSON.stringify(output).substring(0, 100)}`);
          setIsBusy(false);
          setAudioProgress(100);

          const finalOutput = output && output[0] ? output[0] : output;
          const finalText = finalOutput?.text ? String(finalOutput.text) : undefined;
          const finalChunks = Array.isArray(finalOutput?.chunks) ? (finalOutput.chunks as SubtitleChunk[]) : undefined;
          const detectedLanguage =
            (finalOutput?.language ? String(finalOutput.language) : undefined) ||
            (data?.language ? String(data.language) : undefined);

          if (finalText) setTranscript(finalText);
          if (finalChunks) setChunks(finalChunks);

          void updateCurrentTranscript((tx) => {
            const now = Date.now();
            let updated: TranscriptVersion = {
              ...tx,
              status: "completed",
              transcript: finalText ?? tx.transcript,
              chunks: finalChunks ?? tx.chunks,
              detectedLanguage: detectedLanguage ?? tx.detectedLanguage ?? tx.requestedLanguage,
              error: undefined,
              updatedAt: now,
            };
            updated = syncOriginalSubtitleVersion(updated, {
              chunks: (finalChunks ?? tx.chunks ?? []) as SubtitleChunk[],
              language: updated.detectedLanguage,
              now,
            });
            return updated;
          }).finally(() => {
            void refreshHistory();
          });

          currentTaskRef.current = null;
          break;
        }
        case "error":
          appendLog(`ERROR: ${error}`);
          setIsBusy(false);
          console.error("Worker error:", error);
          if (task) {
            void updateTranscriptInHistory(task.assetId, task.projectId, task.transcriptVersionId, (tx) => ({
              ...tx,
              status: "error",
              error: String(error),
              updatedAt: Date.now(),
            })).finally(() => {
              void refreshHistory();
            });
          }
          currentTaskRef.current = null;
          break;
      }
    });
  }, [appendLog, refreshHistory, updateTranscriptInHistory]);

  useEffect(() => {
    initWorker();
    return () => {
      // Avoid auto-termination because StrictMode mounts twice and model loading is expensive.
    };
  }, [initWorker]);

  const transcribe = useCallback(
    async (audioData: Float32Array, file: File, language: string = "", options: TranscribeOptions = {}) => {
      if (!language) {
        throw new Error("Please select the media language before transcribing.");
      }
      initWorker();

      setIsBusy(true);
      setTranscript("");
      setChunks([]);
      setAudioProgress(0);
      setProgressItems([]);
      setDebugLog("");
      appendLog("Starting...");

      const duration = audioData.length / 16000;
      const { projectId, assetId } = await ensureProjectAsset(file, options, duration);
      const transcriptVersionId = makeId("tx");
      currentTaskRef.current = { projectId, assetId, transcriptVersionId };

      const now = Date.now();
      const nextHistory = upsertTranscribingTranscriptProject(history, {
        now,
        projectId: assetId,
        transcriptVersionId,
        fileName: file.name,
        requestedLanguage: language,
      });

      setHistory(sortHistoryItems(nextHistory));
      const nextItem = nextHistory.find((item) => item.id === assetId);
      if (nextItem) {
        await persistHistoryItem(nextItem, projectId);
      }

      worker.current?.postMessage({
        type: "transcribe",
        audio: audioData,
        duration,
        language,
      });
    },
    [appendLog, ensureProjectAsset, history, initWorker, persistHistoryItem]
  );

  const stopTranscription = useCallback(() => {
    if (worker.current) {
      worker.current.terminate();
      worker.current = null;
    }

    const task = currentTaskRef.current;
    setIsBusy(false);
    setProgressItems([]);
    appendLog("STOPPED by user.");

    if (task) {
      void updateTranscriptInHistory(task.assetId, task.projectId, task.transcriptVersionId, (tx) => ({
        ...tx,
        status: "stopped",
        updatedAt: Date.now(),
      })).finally(() => {
        void refreshHistory();
      });
    }

    currentTaskRef.current = null;
  }, [appendLog, refreshHistory, updateTranscriptInHistory]);

  const deleteHistoryItem = useCallback((id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
    projectRepository.current.deleteAsset(id).catch(console.error);
  }, []);

  const renameHistoryItem = useCallback((id: string, newFilename: string) => {
    setHistory((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              filename: newFilename,
              updatedAt: Date.now(),
              timestamp: Date.now(),
            }
          : item
      )
    );

    projectRepository.current
      .getAsset(id)
      .then((asset) => {
        if (!asset) return;
        return projectRepository.current.bulkPutAssets([
          {
            ...asset,
            filename: newFilename,
            updatedAt: Date.now(),
          },
        ]);
      })
      .catch(console.error);
  }, []);

  const createShiftedSubtitleVersion = useCallback(
    (assetId: string, transcriptVersionId: string, subtitleVersionId: string, shiftSeconds: number) => {
      const currentItem = history.find((item) => item.id === assetId);
      let createdId: string | null = null;
      const projectId = (currentItem as HistoryItem & { projectId?: string })?.projectId;
      if (!projectId) return null;

      void updateTranscriptInHistory(assetId, projectId, transcriptVersionId, (tx) => {
        const source = tx.subtitles.find((sub) => sub.id === subtitleVersionId);
        if (!source) return tx;

        const now = Date.now();
        const nextVersionNumber = tx.subtitles.reduce((max, sub) => Math.max(max, sub.versionNumber || 0), 0) + 1;
        const direction = shiftSeconds >= 0 ? "+" : "";
        const shifted: SubtitleVersion = {
          id: makeId("sub"),
          versionNumber: nextVersionNumber,
          label: `${source.language.toUpperCase()} shift ${direction}${shiftSeconds}s`,
          language: source.language,
          sourceLanguage: source.sourceLanguage ?? source.language,
          kind: "shifted",
          createdAt: now,
          updatedAt: now,
          shiftSeconds: Number((source.shiftSeconds + shiftSeconds).toFixed(3)),
          derivedFromSubtitleVersionId: source.id,
          chunks: shiftSubtitleChunks(source.chunks, shiftSeconds),
        };
        createdId = shifted.id;

        return {
          ...tx,
          subtitles: sortSubtitleVersions([...tx.subtitles, shifted]),
          updatedAt: now,
        };
      }).finally(() => {
        void refreshHistory();
      });

      return createdId;
    },
    [history, refreshHistory, updateTranscriptInHistory]
  );

  const saveTranslation = useCallback(
    (
      assetId: string,
      transcriptVersionId: string,
      sourceSubtitleVersionId: string,
      targetLanguage: string,
      sourceLanguage: string,
      translatedChunks: SubtitleChunk[]
    ) => {
      const currentItem = history.find((item) => item.id === assetId);
      let createdId: string | null = null;
      const projectId = (currentItem as HistoryItem & { projectId?: string })?.projectId;
      if (!projectId) return null;

      void updateTranscriptInHistory(assetId, projectId, transcriptVersionId, (tx) => {
        const source = tx.subtitles.find((sub) => sub.id === sourceSubtitleVersionId);
        const now = Date.now();
        const nextVersionNumber = tx.subtitles.reduce((max, sub) => Math.max(max, sub.versionNumber || 0), 0) + 1;

        const translation: SubtitleVersion = {
          id: makeId("sub"),
          versionNumber: nextVersionNumber,
          label: `${targetLanguage.toUpperCase()} translation v${
            tx.subtitles.filter((sub) => sub.language === targetLanguage).length + 1
          }`,
          language: targetLanguage,
          sourceLanguage,
          kind: "translation",
          createdAt: now,
          updatedAt: now,
          shiftSeconds: source?.shiftSeconds ?? 0,
          derivedFromSubtitleVersionId: source?.id,
          chunks: translatedChunks,
        };
        createdId = translation.id;

        return {
          ...tx,
          subtitles: sortSubtitleVersions([...tx.subtitles, translation]),
          updatedAt: now,
        };
      }).finally(() => {
        void refreshHistory();
      });

      return createdId;
    },
    [history, refreshHistory, updateTranscriptInHistory]
  );

  return {
    transcript,
    chunks,
    audioProgress,
    isBusy,
    progressItems,
    history,
    debugLog,
    transcribe,
    stopTranscription,
    deleteHistoryItem,
    renameHistoryItem,
    createShiftedSubtitleVersion,
    saveTranslation,
  };
}
