import test from "node:test";
import assert from "node:assert/strict";

import { deleteTranscriptVersionFromHistoryItem } from "../../../src/lib/transcriber/core/history-deletion";
import type { HistoryItem } from "../../../src/lib/history";

function buildItem(): HistoryItem {
  return {
    id: "asset_1",
    mediaId: "asset_1",
    filename: "clip.mp4",
    createdAt: 1,
    updatedAt: 1,
    timestamp: 1,
    activeTranscriptVersionId: "tx_2",
    transcripts: [
      {
        id: "tx_1",
        versionNumber: 1,
        label: "Transcript v1",
        status: "completed",
        createdAt: 1,
        updatedAt: 1,
        requestedLanguage: "en",
        subtitles: [],
      },
      {
        id: "tx_2",
        versionNumber: 2,
        label: "Transcript v2",
        status: "completed",
        createdAt: 2,
        updatedAt: 2,
        requestedLanguage: "es",
        subtitles: [],
      },
    ],
  };
}

test("deleteTranscriptVersionFromHistoryItem removes one version and reassigns active transcript", () => {
  const result = deleteTranscriptVersionFromHistoryItem(buildItem(), "tx_2");

  assert.ok(result);
  assert.equal(result?.deletedHistoryRecord, false);
  assert.equal(result?.nextItem?.transcripts.length, 1);
  assert.equal(result?.nextItem?.activeTranscriptVersionId, "tx_1");
});

test("deleteTranscriptVersionFromHistoryItem removes the whole transcript record when deleting the last version", () => {
  const singleVersionItem: HistoryItem = {
    ...buildItem(),
    activeTranscriptVersionId: "tx_1",
    transcripts: [buildItem().transcripts[0]],
  };

  const result = deleteTranscriptVersionFromHistoryItem(singleVersionItem, "tx_1");

  assert.ok(result);
  assert.equal(result?.deletedHistoryRecord, true);
  assert.equal(result?.nextItem, null);
});
