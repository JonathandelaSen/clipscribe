import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYouTubeCaptionInitRequest,
  buildYouTubeVideoInsertRequest,
  parseYouTubeTagsInput,
} from "../../../src/lib/youtube/drafts";

test("parseYouTubeTagsInput trims commas and drops empty tags", () => {
  assert.deepEqual(parseYouTubeTagsInput("alpha, beta ,, gamma , "), ["alpha", "beta", "gamma"]);
});

test("buildYouTubeVideoInsertRequest maps required and advanced metadata", () => {
  const result = buildYouTubeVideoInsertRequest({
    title: "Launch video",
    description: "Final launch description",
    privacyStatus: "private",
    tags: ["alpha", " ", "beta"],
    categoryId: "22",
    defaultLanguage: "en",
    notifySubscribers: false,
    embeddable: true,
    license: "youtube",
    publicStatsViewable: true,
    publishAt: "2026-03-17T10:30",
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: true,
    recordingDate: "2026-03-10",
    localizations: [
      { locale: "es", title: "Titulo", description: "Descripcion" },
      { locale: " ", title: "", description: "" },
    ],
  });

  assert.match(result.initUrl, /uploadType=resumable/);
  assert.match(result.initUrl, /part=snippet%2Cstatus%2CrecordingDetails%2Clocalizations/);
  assert.match(result.initUrl, /notifySubscribers=false/);
  assert.deepEqual(result.body.snippet.tags, ["alpha", "beta"]);
  assert.equal(result.body.snippet.categoryId, "22");
  assert.equal(result.body.snippet.defaultLanguage, "en");
  assert.equal(result.body.status.embeddable, true);
  assert.equal(result.body.status.license, "youtube");
  assert.equal(result.body.status.publicStatsViewable, true);
  assert.equal(result.body.status.selfDeclaredMadeForKids, false);
  assert.equal(result.body.status.containsSyntheticMedia, true);
  assert.equal(result.body.status.publishAt, new Date("2026-03-17T10:30").toISOString());
  assert.equal(result.body.recordingDetails?.recordingDate, "2026-03-10T00:00:00.000Z");
  assert.deepEqual(result.body.localizations, {
    es: {
      title: "Titulo",
      description: "Descripcion",
    },
  });
});

test("buildYouTubeVideoInsertRequest omits unset optional fields", () => {
  const result = buildYouTubeVideoInsertRequest({
    title: "Quick post",
    description: "Description",
    privacyStatus: "private",
    tags: [],
    localizations: [],
  });

  assert.doesNotMatch(result.initUrl, /notifySubscribers=/);
  assert.equal("tags" in result.body.snippet, false);
  assert.equal("categoryId" in result.body.snippet, false);
  assert.equal("defaultLanguage" in result.body.snippet, false);
  assert.equal("embeddable" in result.body.status, false);
  assert.equal("license" in result.body.status, false);
  assert.equal("publicStatsViewable" in result.body.status, false);
  assert.equal("selfDeclaredMadeForKids" in result.body.status, false);
  assert.equal("containsSyntheticMedia" in result.body.status, false);
  assert.equal("recordingDetails" in result.body, false);
  assert.equal("localizations" in result.body, false);
});

test("buildYouTubeVideoInsertRequest preserves explicit false values", () => {
  const result = buildYouTubeVideoInsertRequest({
    title: "Explicit false",
    description: "Description",
    privacyStatus: "private",
    tags: [],
    notifySubscribers: false,
    embeddable: false,
    publicStatsViewable: false,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false,
    localizations: [],
  });

  assert.match(result.initUrl, /notifySubscribers=false/);
  assert.equal(result.body.status.embeddable, false);
  assert.equal(result.body.status.publicStatsViewable, false);
  assert.equal(result.body.status.selfDeclaredMadeForKids, false);
  assert.equal(result.body.status.containsSyntheticMedia, false);
});

test("buildYouTubeCaptionInitRequest creates resumable caption metadata", () => {
  const result = buildYouTubeCaptionInitRequest("video_123", {
    file: new Blob(["1"], { type: "application/x-subrip" }),
    filename: "captions.srt",
    language: "en",
    name: "English",
    isDraft: true,
  });

  assert.match(result.initUrl, /uploadType=resumable/);
  assert.match(result.initUrl, /part=snippet/);
  assert.deepEqual(result.body, {
    snippet: {
      videoId: "video_123",
      language: "en",
      name: "English",
      isDraft: true,
    },
  });
});
