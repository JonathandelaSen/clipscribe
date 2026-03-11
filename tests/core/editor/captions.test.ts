import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectCaptionTimeline, resolveCaptionSourceChunks } from "../../../src/lib/editor/core/captions";
import { createDefaultVideoClip, createEmptyEditorProject, createEditorAssetRecord } from "../../../src/lib/editor/storage";
import type { HistoryItem } from "../../../src/lib/history";

test("resolveCaptionSourceChunks reads embedded SRT chunks directly", () => {
  const chunks = resolveCaptionSourceChunks(
    {
      kind: "embedded-srt",
      label: "Imported SRT",
      chunks: [{ text: "Hello", timestamp: [0, 1] }],
    },
    new Map()
  );

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "Hello");
});

test("buildProjectCaptionTimeline offsets trimmed clip subtitles into project time", () => {
  const now = Date.now();
  const historyItem: HistoryItem = {
    id: "history_1",
    mediaId: "history_1",
    filename: "clip.mp4",
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    activeTranscriptVersionId: "tx_1",
    transcripts: [
      {
        id: "tx_1",
        versionNumber: 1,
        label: "Transcript v1",
        status: "completed",
        createdAt: now,
        updatedAt: now,
        requestedLanguage: "en",
        detectedLanguage: "en",
        transcript: "One two",
        chunks: [],
        subtitles: [
          {
            id: "sub_1",
            versionNumber: 1,
            label: "Original subtitles",
            language: "en",
            sourceLanguage: "en",
            kind: "original",
            createdAt: now,
            updatedAt: now,
            shiftSeconds: 0,
            chunks: [
              { text: "Hello", timestamp: [0, 2] },
              { text: "World", timestamp: [2, 4] },
            ],
          },
        ],
      },
    ],
  };
  const project = createEmptyEditorProject();
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    durationSeconds: 10,
    sourceType: "history",
    sourceMediaId: "history_1",
    sourceProjectId: "history_1",
    captionSource: {
      kind: "history-subtitle",
      sourceProjectId: "history_1",
      transcriptId: "tx_1",
      subtitleId: "sub_1",
      language: "en",
      label: "Original subtitles",
    },
  });
  const firstClip = {
    ...createDefaultVideoClip({ assetId: asset.id, label: "A", durationSeconds: 10 }),
    trimStartSeconds: 1,
    trimEndSeconds: 4,
  };
  const secondClip = createDefaultVideoClip({ assetId: asset.id, label: "B", durationSeconds: 10 });
  project.assetIds = [asset.id];
  project.timeline.videoClips = [firstClip, secondClip];

  const chunks = buildProjectCaptionTimeline({
    project,
    assets: [asset],
    historyMap: new Map([[historyItem.id, historyItem]]),
  });

  assert.equal(chunks.length, 4);
  assert.deepEqual(chunks[0].timestamp, [0, 1]);
  assert.deepEqual(chunks[1].timestamp, [1, 3]);
  assert.deepEqual(chunks[2].timestamp, [3, 5]);
});
