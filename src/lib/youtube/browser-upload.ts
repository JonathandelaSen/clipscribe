import {
  YOUTUBE_POLL_ATTEMPTS,
  YOUTUBE_POLL_INTERVAL_MS,
} from "./constants";
import { createYouTubeApiClient } from "./api";
import {
  buildYouTubeCaptionInitRequest,
  buildYouTubeThumbnailUploadUrl,
  buildYouTubeVideoInsertRequest,
  createYouTubeResultUrls,
  validateYouTubeCaption,
  validateYouTubeThumbnail,
} from "./drafts";
import type {
  YouTubeBrowserUploadProgress,
  YouTubeCaptionUpload,
  YouTubePublishResult,
  YouTubeThumbnailUpload,
  YouTubeUploadDraft,
} from "./types";

type FetchImpl = typeof fetch;

interface UploadRequestLike {
  upload: {
    onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  responseText: string;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
}

interface UploadDeps {
  fetchImpl?: FetchImpl;
  createUploadRequest?: () => UploadRequestLike;
  wait?: (ms: number) => Promise<void>;
}

export interface BrowserYouTubePublishInput {
  accessToken: string;
  draft: YouTubeUploadDraft;
  videoFile: File;
  thumbnail?: YouTubeThumbnailUpload | null;
  caption?: YouTubeCaptionUpload | null;
  onProgress?: (progress: YouTubeBrowserUploadProgress) => void;
}

function emitProgress(
  callback: BrowserYouTubePublishInput["onProgress"],
  phase: YouTubeBrowserUploadProgress["phase"],
  percent: number,
  message: string
) {
  callback?.({
    phase,
    percent,
    message,
  });
}

function createDefaultUploadRequest(): UploadRequestLike {
  return new XMLHttpRequest() as unknown as UploadRequestLike;
}

async function initializeResumableUpload(
  url: string,
  body: unknown,
  file: Blob,
  accessToken: string,
  fetchImpl: FetchImpl
): Promise<string> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(file.size),
      "X-Upload-Content-Type": file.type || "application/octet-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(errorBody || `Failed to initialize YouTube upload (${response.status})`);
  }

  const location = response.headers.get("Location");
  if (!location) {
    throw new Error("YouTube did not return a resumable upload URL.");
  }

  return location;
}

function uploadBlobToResumableSession(input: {
  uploadUrl: string;
  blob: Blob;
  accessToken: string;
  onProgress?: BrowserYouTubePublishInput["onProgress"];
  createUploadRequest?: () => UploadRequestLike;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = (input.createUploadRequest ?? createDefaultUploadRequest)();
    request.open("PUT", input.uploadUrl);
    request.setRequestHeader("Authorization", `Bearer ${input.accessToken}`);
    request.setRequestHeader("Content-Type", input.blob.type || "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 72) + 18;
      emitProgress(input.onProgress, "uploading", percent, "Uploading video bytes to YouTube");
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(request.responseText || `Upload failed (${request.status})`));
        return;
      }
      resolve(request.responseText ? JSON.parse(request.responseText) : {});
    };
    request.onerror = () => reject(new Error("Browser upload failed before YouTube returned a response."));
    request.onabort = () => reject(new Error("Browser upload was canceled."));
    request.send(input.blob);
  });
}

async function uploadThumbnail(
  videoId: string,
  accessToken: string,
  thumbnail: YouTubeThumbnailUpload | null | undefined,
  fetchImpl: FetchImpl
) {
  if (!thumbnail) {
    return { ok: true } as const;
  }

  const response = await fetchImpl(buildYouTubeThumbnailUploadUrl(videoId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": thumbnail.mimeType || "application/octet-stream",
    },
    body: thumbnail.file,
  });

  if (!response.ok) {
    return {
      ok: false,
      error: (await response.text()) || `Thumbnail upload failed (${response.status})`,
    } as const;
  }

  return { ok: true } as const;
}

async function uploadCaption(
  videoId: string,
  accessToken: string,
  caption: YouTubeCaptionUpload | null | undefined,
  fetchImpl: FetchImpl
) {
  if (!caption) {
    return { ok: true } as const;
  }

  const init = buildYouTubeCaptionInitRequest(videoId, caption);
  const uploadUrl = await initializeResumableUpload(init.initUrl, init.body, caption.file, accessToken, fetchImpl);
  const response = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": caption.file.type || "application/octet-stream",
    },
    body: caption.file,
  });

  if (!response.ok) {
    return {
      ok: false,
      error: (await response.text()) || `Caption upload failed (${response.status})`,
    } as const;
  }

  return { ok: true } as const;
}

export async function publishToYouTubeFromBrowser(
  input: BrowserYouTubePublishInput,
  deps: UploadDeps = {}
): Promise<YouTubePublishResult> {
  validateYouTubeThumbnail(input.thumbnail ?? null);
  validateYouTubeCaption(input.caption ?? null);

  const fetchImpl = deps.fetchImpl ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const init = buildYouTubeVideoInsertRequest(input.draft);

  emitProgress(input.onProgress, "initializing", 8, "Preparing resumable YouTube upload");
  const uploadUrl = await initializeResumableUpload(init.initUrl, init.body, input.videoFile, input.accessToken, fetchImpl);

  emitProgress(input.onProgress, "uploading", 18, "Uploading video bytes to YouTube");
  const uploaded = (await uploadBlobToResumableSession({
    uploadUrl,
    blob: input.videoFile,
    accessToken: input.accessToken,
    onProgress: input.onProgress,
    createUploadRequest: deps.createUploadRequest,
  })) as {
    id?: string;
  };

  if (typeof uploaded.id !== "string" || !uploaded.id) {
    throw new Error("YouTube upload succeeded but the video id was missing from the response.");
  }

  emitProgress(input.onProgress, "thumbnail", 84, "Applying optional YouTube thumbnail");
  const thumbnail = await uploadThumbnail(uploaded.id, input.accessToken, input.thumbnail, fetchImpl);

  emitProgress(input.onProgress, "caption", 90, "Applying optional caption track");
  const caption = await uploadCaption(uploaded.id, input.accessToken, input.caption, fetchImpl);

  const apiClient = createYouTubeApiClient(fetchImpl);
  emitProgress(input.onProgress, "processing", 95, "Checking YouTube processing state");
  let processing = await apiClient.getVideoProcessingStatus(input.accessToken, uploaded.id);

  for (let attempt = 1; attempt < YOUTUBE_POLL_ATTEMPTS; attempt += 1) {
    if (processing.processingStatus === "succeeded" || processing.processingStatus === "failed") {
      break;
    }
    await wait(YOUTUBE_POLL_INTERVAL_MS);
    processing = await apiClient.getVideoProcessingStatus(input.accessToken, uploaded.id);
  }

  emitProgress(input.onProgress, "complete", 100, "YouTube upload flow finished");
  return {
    ok: true,
    videoId: uploaded.id,
    ...createYouTubeResultUrls(uploaded.id),
    processing,
    thumbnail,
    caption,
  };
}
