import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectYouTubeImportHeaders } from "../../../src/lib/projects/youtube-import-contract";
import { postProjectYouTubeImport } from "../../../src/lib/server/project-youtube-import-route";

test("postProjectYouTubeImport requires a URL", async () => {
  const response = await postProjectYouTubeImport(
    new Request("http://localhost/api/projects/youtube/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "url is required.");
});

test("postProjectYouTubeImport returns binary video metadata headers on success", async () => {
  const response = await postProjectYouTubeImport(
    new Request("http://localhost/api/projects/youtube/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=abc123",
      }),
    }),
    {
      importVideo: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        filename: "imported-source.mp4",
        mimeType: "video/mp4",
        sizeBytes: 3,
        durationSeconds: 7.25,
        width: 1920,
        height: 1080,
        videoId: "abc123",
        title: "Imported Source",
        channelTitle: "ClipScribe",
      }),
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  const metadata = parseProjectYouTubeImportHeaders(response.headers, "fallback.mp4");
  assert.equal(metadata.filename, "imported-source.mp4");
  assert.equal(metadata.videoId, "abc123");
  assert.equal(metadata.title, "Imported Source");
  assert.equal(metadata.channelTitle, "ClipScribe");
  assert.equal(metadata.durationSeconds, 7.25);
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("postProjectYouTubeImport maps service failures to 422", async () => {
  const response = await postProjectYouTubeImport(
    new Request("http://localhost/api/projects/youtube/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://www.youtube.com/watch?v=abc123",
      }),
    }),
    {
      importVideo: async () => {
        throw new Error("boom");
      },
    }
  );

  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error, "boom");
});
