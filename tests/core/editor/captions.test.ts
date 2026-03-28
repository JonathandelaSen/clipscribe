import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectCaptionTimeline,
  buildProjectSubtitleTimeline,
  getProjectSubtitleTrackEffectiveTimingMode,
  hydrateProjectSubtitleTrackFromLegacyCaptions,
  resolveCaptionSourceChunks,
} from "../../../src/lib/editor/core/captions";
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

test("buildProjectCaptionTimeline offsets trimmed clip subtitles into project time and ignores joined groups", () => {
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
  project.timeline.videoClipGroups = [
    {
      id: "group_1",
      kind: "joined",
      clipIds: [firstClip.id, secondClip.id],
      label: "A + B",
    },
  ];

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

test("buildProjectSubtitleTimeline applies global track offset and trim", () => {
  const project = createEmptyEditorProject();
  project.subtitles = {
    ...project.subtitles,
    source: {
      kind: "uploaded-srt",
    },
    label: "Imported SRT",
    chunks: [
      { text: "One", timestamp: [0, 1] },
      { text: "Two", timestamp: [1.5, 3] },
    ],
    offsetSeconds: 2,
    trimStartSeconds: 0.5,
    trimEndSeconds: 2.5,
  };

  const chunks = buildProjectSubtitleTimeline({
    project,
    historyMap: new Map(),
  });

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].timestamp, [2, 2.5]);
  assert.deepEqual(chunks[1].timestamp, [3, 4]);
});

test("buildProjectSubtitleTimeline can build word-timed pop captions for the global subtitle track", () => {
  const now = Date.now();
  const historyItem: HistoryItem = {
    id: "history_words",
    mediaId: "history_words",
    filename: "clip.mp4",
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    activeTranscriptVersionId: "tx_words",
    transcripts: [
      {
        id: "tx_words",
        versionNumber: 1,
        label: "Transcript",
        status: "completed",
        createdAt: now,
        updatedAt: now,
        requestedLanguage: "en",
        detectedLanguage: "en",
        transcript: "Hello brave world again",
        chunks: [],
        wordChunks: [
          { text: "Hello", timestamp: [0, 0.35] },
          { text: "brave", timestamp: [0.36, 0.72] },
          { text: "world", timestamp: [0.8, 1.12] },
          { text: "again", timestamp: [1.14, 1.5] },
        ],
        subtitles: [
          {
            id: "sub_words",
            versionNumber: 1,
            label: "Original subtitles",
            language: "en",
            sourceLanguage: "en",
            kind: "original",
            createdAt: now,
            updatedAt: now,
            shiftSeconds: 0,
            chunks: [{ text: "Hello brave world again", timestamp: [0, 1.5] }],
          },
        ],
      },
    ],
  };
  const project = createEmptyEditorProject();
  project.subtitles = {
    ...project.subtitles,
    source: {
      kind: "history-subtitle",
      sourceProjectId: historyItem.id,
      transcriptId: "tx_words",
      subtitleId: "sub_words",
    },
    label: "Original subtitles",
    language: "en",
    chunks: [{ text: "Hello brave world again", timestamp: [0, 1.5] }],
    subtitleTimingMode: "pair",
    trimEndSeconds: 1.5,
  };

  const chunks = buildProjectSubtitleTimeline({
    project,
    historyMap: new Map([[historyItem.id, historyItem]]),
  });

  assert.equal(getProjectSubtitleTrackEffectiveTimingMode({ project, historyMap: new Map([[historyItem.id, historyItem]]) }), "pair");
  assert.deepEqual(
    chunks.map((chunk) => ({ text: chunk.text, timestamp: chunk.timestamp })),
    [
      { text: "Hello brave", timestamp: [0, 0.72] },
      { text: "world again", timestamp: [0.8, 1.5] },
    ]
  );
});

test("global subtitle track falls back to segment timing when word timestamps are unavailable", () => {
  const project = createEmptyEditorProject();
  project.subtitles = {
    ...project.subtitles,
    source: {
      kind: "uploaded-srt",
    },
    label: "Imported SRT",
    chunks: [
      { text: "Hello brave", timestamp: [0, 1] },
      { text: "World again", timestamp: [1.1, 2.2] },
    ],
    subtitleTimingMode: "pair",
    trimEndSeconds: 2.2,
  };

  const historyMap = new Map<string, HistoryItem>();
  const chunks = buildProjectSubtitleTimeline({
    project,
    historyMap,
  });

  assert.equal(getProjectSubtitleTrackEffectiveTimingMode({ project, historyMap }), "segment");
  assert.deepEqual(
    chunks.map((chunk) => ({ text: chunk.text, timestamp: chunk.timestamp })),
    [
      { text: "Hello brave", timestamp: [0, 1] },
      { text: "World again", timestamp: [1.1, 2.2] },
    ]
  );
});

test("hydrateProjectSubtitleTrackFromLegacyCaptions promotes the first legacy asset caption source", () => {
  const now = Date.now();
  const historyItem: HistoryItem = {
    id: "history_legacy",
    mediaId: "history_legacy",
    filename: "clip.mp4",
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    activeTranscriptVersionId: "tx_legacy",
    transcripts: [
      {
        id: "tx_legacy",
        versionNumber: 1,
        label: "Transcript",
        status: "completed",
        createdAt: now,
        updatedAt: now,
        requestedLanguage: "en",
        detectedLanguage: "en",
        transcript: "Legacy",
        chunks: [],
        subtitles: [
          {
            id: "sub_legacy",
            versionNumber: 1,
            label: "Legacy subtitles",
            language: "en",
            sourceLanguage: "en",
            kind: "original",
            createdAt: now,
            updatedAt: now,
            shiftSeconds: 0,
            chunks: [{ text: "Legacy", timestamp: [0, 1] }],
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
    durationSeconds: 3,
    sourceType: "history",
    sourceAssetId: "history_legacy",
    sourceMediaId: "history_legacy",
    sourceProjectId: "history_legacy",
    captionSource: {
      kind: "asset-subtitle",
      sourceAssetId: "history_legacy",
      transcriptId: "tx_legacy",
      subtitleId: "sub_legacy",
      language: "en",
      label: "Legacy subtitles",
    },
  });

  const hydrated = hydrateProjectSubtitleTrackFromLegacyCaptions({
    project,
    assets: [asset],
    historyMap: new Map([[historyItem.id, historyItem]]),
  });

  assert.equal(hydrated.subtitles.source.kind, "history-subtitle");
  assert.equal(hydrated.subtitles.label, "Legacy subtitles");
  assert.equal(hydrated.subtitles.chunks.length, 1);
  assert.equal(hydrated.subtitles.trimEndSeconds, 1);
});
