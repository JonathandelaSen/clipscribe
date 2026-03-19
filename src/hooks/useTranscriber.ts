import { useCallback, useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import {
  makeId,
  shiftSubtitleChunks,
  sortSubtitleVersions,
  type HistoryItem,
  type SubtitleChunk,
  type SubtitleVersion,
} from "@/lib/history";
import { createDexieProjectRepository } from "@/lib/repositories/project-repo";
import { deleteTranscriptVersionFromHistoryItem } from "@/lib/transcriber/core/history-deletion";
import { historyItemToTranscriptRecord } from "@/lib/transcriber/core/history-records";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";

export type { HistoryItem } from "@/lib/history";

export interface TranscriberProgress {
  file: string;
  name: string;
  progress: number;
  status: string;
}

type TranscribeOptions = {
  projectId?: string;
  assetId?: string;
};

export function useTranscriber() {
  const projectRepository = useRef(createDexieProjectRepository());
  const { startTranscription, activeTasks } = useBackgroundTasks();

  const history = useLiveQuery(async () => projectRepository.current.listProjectHistory(), [], [] as HistoryItem[]);
  const historyItems = useMemo(() => history ?? [], [history]);

  const isBusy = useMemo(() => activeTasks.some((task) => task.kind === "transcription"), [activeTasks]);

  const transcribe = useCallback(
    async (file: File, language: string = "", options: TranscribeOptions = {}) => {
      if (!language) {
        throw new Error("Please select the media language before transcribing.");
      }

      return startTranscription({
        file,
        language,
        projectId: options.projectId,
        assetId: options.assetId,
      });
    },
    [startTranscription]
  );

  const deleteHistoryItem = useCallback(async (assetId: string) => {
    await projectRepository.current.deleteAssetTranscript(assetId);
  }, []);

  const renameHistoryItem = useCallback(async (assetId: string, newFilename: string) => {
    const asset = await projectRepository.current.getAsset(assetId);
    if (!asset) return;

    await projectRepository.current.bulkPutAssets([
      {
        ...asset,
        filename: newFilename,
        updatedAt: Date.now(),
      },
    ]);
  }, []);

  const createShiftedSubtitleVersion = useCallback(
    (assetId: string, transcriptVersionId: string, subtitleVersionId: string, shiftSeconds: number) => {
      const item = historyItems.find((current) => current.id === assetId);
      const projectId = (item as HistoryItem & { projectId?: string })?.projectId;
      if (!item || !projectId) return null;

      let createdId: string | null = null;
      const now = Date.now();
      const nextItem: HistoryItem = {
        ...item,
        transcripts: item.transcripts.map((transcript) => {
          if (transcript.id !== transcriptVersionId) return transcript;

          const source = transcript.subtitles.find((subtitle) => subtitle.id === subtitleVersionId);
          if (!source) return transcript;

          const nextVersionNumber = transcript.subtitles.reduce((max, subtitle) => Math.max(max, subtitle.versionNumber || 0), 0) + 1;
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
            ...transcript,
            subtitles: sortSubtitleVersions([...transcript.subtitles, shifted]),
            updatedAt: now,
          };
        }),
        updatedAt: now,
        timestamp: now,
      };

      void projectRepository.current.putAssetTranscript(historyItemToTranscriptRecord(nextItem, projectId));

      return createdId;
    },
    [historyItems]
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
      const item = historyItems.find((current) => current.id === assetId);
      const projectId = (item as HistoryItem & { projectId?: string })?.projectId;
      if (!item || !projectId) return null;

      let createdId: string | null = null;
      const now = Date.now();
      const nextItem: HistoryItem = {
        ...item,
        transcripts: item.transcripts.map((transcript) => {
          if (transcript.id !== transcriptVersionId) return transcript;

          const source = transcript.subtitles.find((subtitle) => subtitle.id === sourceSubtitleVersionId);
          const nextVersionNumber = transcript.subtitles.reduce((max, subtitle) => Math.max(max, subtitle.versionNumber || 0), 0) + 1;

          const translation: SubtitleVersion = {
            id: makeId("sub"),
            versionNumber: nextVersionNumber,
            label: `${targetLanguage.toUpperCase()} translation v${
              transcript.subtitles.filter((subtitle) => subtitle.language === targetLanguage).length + 1
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
            ...transcript,
            subtitles: sortSubtitleVersions([...transcript.subtitles, translation]),
            updatedAt: now,
          };
        }),
        updatedAt: now,
        timestamp: now,
      };

      void projectRepository.current.putAssetTranscript(historyItemToTranscriptRecord(nextItem, projectId));

      return createdId;
    },
    [historyItems]
  );

  const deleteTranscriptVersion = useCallback(
    async (assetId: string, transcriptVersionId: string) => {
      const item = historyItems.find((current) => current.id === assetId);
      if (!item) return;

      const projectId = (item as HistoryItem & { projectId?: string }).projectId;
      if (!projectId) return;

      const result = deleteTranscriptVersionFromHistoryItem(item, transcriptVersionId);
      if (!result) return;

      if (!result.nextItem) {
        await projectRepository.current.deleteAssetTranscript(assetId);
        return;
      }

      await projectRepository.current.putAssetTranscript(historyItemToTranscriptRecord(result.nextItem, projectId));
    },
    [historyItems]
  );

  return {
    transcript: "",
    chunks: [] as SubtitleChunk[],
    audioProgress: 0,
    isBusy,
    progressItems: [] as TranscriberProgress[],
    history: historyItems,
    debugLog: "",
    transcribe,
    deleteHistoryItem,
    renameHistoryItem,
    createShiftedSubtitleVersion,
    saveTranslation,
    deleteTranscriptVersion,
  };
}
