import {
  YOUTUBE_UPLOAD_CAPTION_URL,
  YOUTUBE_UPLOAD_THUMBNAIL_URL,
  YOUTUBE_UPLOAD_VIDEO_URL,
  YOUTUBE_VIDEO_INSERT_PARTS,
} from "./constants";
import type {
  YouTubeCaptionUpload,
  YouTubeLocalizationInput,
  YouTubePublishResult,
  YouTubeThumbnailUpload,
  YouTubeUploadDraft,
} from "./types";

type MutableVideoSnippet = {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
};

type MutableVideoStatus = {
  privacyStatus: string;
  embeddable: boolean;
  license: string;
  publicStatsViewable: boolean;
  selfDeclaredMadeForKids: boolean;
  containsSyntheticMedia: boolean;
  publishAt?: string;
};

type MutableVideoRecordingDetails = {
  recordingDate?: string;
};

export interface YouTubeInsertRequest {
  initUrl: string;
  body: {
    snippet: MutableVideoSnippet;
    status: MutableVideoStatus;
    recordingDetails?: MutableVideoRecordingDetails;
    localizations?: Record<string, { title: string; description: string }>;
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLocalization(input: YouTubeLocalizationInput): YouTubeLocalizationInput | null {
  const locale = trimOptional(input.locale)?.toLowerCase();
  const title = trimOptional(input.title);
  const description = trimOptional(input.description) ?? "";
  if (!locale || !title) return null;
  return {
    locale,
    title,
    description,
  };
}

export function parseYouTubeTagsInput(value: string): string[] {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeYouTubeRegionCode(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "US";
  const match = raw.match(/(?:^|[-_])([A-Za-z]{2})(?:$|[-_])/);
  return (match?.[1] || raw.slice(-2)).toUpperCase();
}

export function buildYouTubeVideoInsertRequest(draft: YouTubeUploadDraft): YouTubeInsertRequest {
  const title = trimOptional(draft.title);
  const description = trimOptional(draft.description);
  if (!title) {
    throw new Error("A YouTube title is required.");
  }
  if (!description) {
    throw new Error("A YouTube description is required.");
  }

  const snippet: MutableVideoSnippet = {
    title,
    description,
  };
  const tags = draft.tags.map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0) snippet.tags = tags;
  const categoryId = trimOptional(draft.categoryId);
  if (categoryId) snippet.categoryId = categoryId;
  const defaultLanguage = trimOptional(draft.defaultLanguage);
  if (defaultLanguage) snippet.defaultLanguage = defaultLanguage;

  const status: MutableVideoStatus = {
    privacyStatus: draft.privacyStatus,
    embeddable: Boolean(draft.embeddable),
    license: draft.license,
    publicStatsViewable: Boolean(draft.publicStatsViewable),
    selfDeclaredMadeForKids: Boolean(draft.selfDeclaredMadeForKids),
    containsSyntheticMedia: Boolean(draft.containsSyntheticMedia),
  };
  const publishAt = trimOptional(draft.publishAt);
  if (publishAt) status.publishAt = new Date(publishAt).toISOString();

  const recordingDate = trimOptional(draft.recordingDate);
  const recordingDetails = recordingDate
    ? {
        recordingDate: new Date(`${recordingDate}T00:00:00.000Z`).toISOString(),
      }
    : undefined;

  const localizations = draft.localizations
    .map((entry) => normalizeLocalization(entry))
    .filter((entry): entry is YouTubeLocalizationInput => !!entry)
    .reduce<Record<string, { title: string; description: string }>>((acc, entry) => {
      acc[entry.locale] = {
        title: entry.title,
        description: entry.description,
      };
      return acc;
    }, {});

  const initUrl = new URL(YOUTUBE_UPLOAD_VIDEO_URL);
  initUrl.searchParams.set("uploadType", "resumable");
  initUrl.searchParams.set("part", YOUTUBE_VIDEO_INSERT_PARTS.join(","));
  initUrl.searchParams.set("notifySubscribers", String(Boolean(draft.notifySubscribers)));

  return {
    initUrl: initUrl.toString(),
    body: {
      snippet,
      status,
      ...(recordingDetails ? { recordingDetails } : {}),
      ...(Object.keys(localizations).length > 0 ? { localizations } : {}),
    },
  };
}

export function buildYouTubeThumbnailUploadUrl(videoId: string): string {
  const url = new URL(YOUTUBE_UPLOAD_THUMBNAIL_URL);
  url.searchParams.set("videoId", videoId);
  return url.toString();
}

export function buildYouTubeCaptionInitRequest(videoId: string, caption: YouTubeCaptionUpload) {
  const url = new URL(YOUTUBE_UPLOAD_CAPTION_URL);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet");
  return {
    initUrl: url.toString(),
    body: {
      snippet: {
        videoId,
        language: caption.language.trim(),
        name: caption.name.trim(),
        isDraft: Boolean(caption.isDraft),
      },
    },
  };
}

export function createYouTubeResultUrls(videoId: string): Pick<YouTubePublishResult, "watchUrl" | "studioUrl"> {
  return {
    watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/edit`,
  };
}

export function validateYouTubeThumbnail(thumbnail: YouTubeThumbnailUpload | null): void {
  if (!thumbnail) return;
  if (!/^image\/(png|jpeg|jpg|webp)$/i.test(thumbnail.mimeType)) {
    throw new Error("Thumbnail must be a PNG, JPG, or WebP image.");
  }
}

export function validateYouTubeCaption(caption: YouTubeCaptionUpload | null): void {
  if (!caption) return;
  const language = caption.language.trim();
  if (!language) {
    throw new Error("Caption language is required when a caption file is attached.");
  }
}
