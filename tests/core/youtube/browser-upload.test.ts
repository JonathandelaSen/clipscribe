import assert from "node:assert/strict";
import test from "node:test";

import { publishToYouTubeFromBrowser } from "../../../src/lib/youtube/browser-upload";

class FakeUploadRequest {
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";

  open() {}
  setRequestHeader() {}
  send(body: Blob) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: body.size,
      total: body.size,
    });
    this.status = 200;
    this.responseText = JSON.stringify({ id: "video_123" });
    this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}

function createFetchStub(options?: { failThumbnail?: boolean; failCaption?: boolean }) {
  let statusCalls = 0;

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/upload/youtube/v3/videos") && init?.method === "POST") {
      return new Response("", {
        status: 200,
        headers: { Location: "https://upload.example/video" },
      });
    }

    if (url === "https://upload.example/caption" && init?.method === "PUT") {
      if (options?.failCaption) {
        return new Response("caption failed", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    }

    if (url.includes("/upload/youtube/v3/captions") && init?.method === "POST") {
      return new Response("", {
        status: 200,
        headers: { Location: "https://upload.example/caption" },
      });
    }

    if (url.includes("/upload/youtube/v3/thumbnails/set") && init?.method === "POST") {
      if (options?.failThumbnail) {
        return new Response("thumbnail failed", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    }

    if (url.includes("/youtube/v3/videos?part=processingDetails,status")) {
      statusCalls += 1;
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "video_123",
              status: {
                uploadStatus: "uploaded",
                privacyStatus: "private",
              },
              processingDetails: {
                processingStatus: statusCalls > 1 ? "succeeded" : "processing",
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };
}

const draft = {
  title: "Launch cut",
  description: "Description",
  privacyStatus: "private" as const,
  tags: ["launch", "workflow"],
  defaultLanguage: "en",
  notifySubscribers: false,
  embeddable: true,
  license: "youtube" as const,
  publicStatsViewable: true,
  selfDeclaredMadeForKids: false,
  containsSyntheticMedia: false,
  localizations: [],
};

test("publishToYouTubeFromBrowser completes the happy path and polls processing", async () => {
  const progressMessages: string[] = [];

  const result = await publishToYouTubeFromBrowser(
    {
      accessToken: "access_token",
      draft,
      videoFile: new File(["video"], "clip.mp4", { type: "video/mp4" }),
      thumbnail: {
        file: new File(["thumb"], "thumb.png", { type: "image/png" }),
        filename: "thumb.png",
        mimeType: "image/png",
      },
      caption: {
        file: new File(["caption"], "captions.srt", { type: "application/x-subrip" }),
        filename: "captions.srt",
        language: "en",
        name: "English",
        isDraft: false,
      },
      onProgress: (progress) => progressMessages.push(progress.message),
    },
    {
      fetchImpl: createFetchStub(),
      createUploadRequest: () => new FakeUploadRequest(),
      wait: async () => {},
    }
  );

  assert.equal(result.videoId, "video_123");
  assert.equal(result.thumbnail.state, "applied");
  assert.equal(result.caption.state, "applied");
  assert.equal(result.processing.processingStatus, "succeeded");
  assert.ok(progressMessages.some((message) => /Uploading video bytes/i.test(message)));
});

test("publishToYouTubeFromBrowser keeps the video result even when thumbnail upload fails", async () => {
  const result = await publishToYouTubeFromBrowser(
    {
      accessToken: "access_token",
      draft,
      videoFile: new File(["video"], "clip.mp4", { type: "video/mp4" }),
      thumbnail: {
        file: new File(["thumb"], "thumb.png", { type: "image/png" }),
        filename: "thumb.png",
        mimeType: "image/png",
      },
    },
    {
      fetchImpl: createFetchStub({ failThumbnail: true }),
      createUploadRequest: () => new FakeUploadRequest(),
      wait: async () => {},
    }
  );

  assert.equal(result.videoId, "video_123");
  assert.equal(result.thumbnail.state, "failed");
  assert.match(result.thumbnail.error || "", /thumbnail failed/i);
  assert.equal(result.caption.state, "skipped");
  assert.equal(result.processing.processingStatus, "succeeded");
});
