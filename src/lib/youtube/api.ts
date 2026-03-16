import {
  YOUTUBE_CATEGORIES_PART,
  YOUTUBE_DATA_API_BASE_URL,
  YOUTUBE_DEFAULT_REGION_CODE,
  YOUTUBE_LANGUAGES_PART,
  YOUTUBE_STATUS_POLL_PARTS,
} from "./constants";
import type {
  YouTubeCategoryOption,
  YouTubeChannelSummary,
  YouTubeLanguageOption,
  YouTubeOptionCatalog,
  YouTubeVideoProcessingStatus,
} from "./types";

type FetchImpl = typeof fetch;

interface YouTubeListResponse<T> {
  items?: T[];
  error?: {
    message?: string;
  };
}

function buildAuthorizedHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

async function fetchYouTubeJson<T>(url: string, accessToken: string, fetchImpl: FetchImpl = fetch): Promise<T> {
  const response = await fetchImpl(url, {
    headers: buildAuthorizedHeaders(accessToken),
    cache: "no-store",
  });
  const data = (await response.json()) as T & {
    error?: {
      message?: string;
    };
  };
  if (!response.ok) {
    throw new Error(data.error?.message || `YouTube request failed (${response.status})`);
  }
  return data;
}

export function createYouTubeApiClient(fetchImpl: FetchImpl = fetch) {
  return {
    async listMyChannels(accessToken: string): Promise<YouTubeChannelSummary[]> {
      const url = `${YOUTUBE_DATA_API_BASE_URL}/channels?part=snippet&mine=true`;
      const data = await fetchYouTubeJson<
        YouTubeListResponse<{
          id?: string;
          snippet?: {
            title?: string;
            description?: string;
            customUrl?: string;
            thumbnails?: {
              default?: { url?: string };
              medium?: { url?: string };
              high?: { url?: string };
            };
          };
        }>
      >(url, accessToken, fetchImpl);

      return (data.items ?? [])
        .filter((item) => typeof item.id === "string" && typeof item.snippet?.title === "string")
        .map((item) => ({
          id: item.id!,
          title: item.snippet!.title!,
          description: item.snippet?.description,
          customUrl: item.snippet?.customUrl,
          thumbnailUrl:
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url,
        }));
    },

    async listVideoCategories(accessToken: string, regionCode = YOUTUBE_DEFAULT_REGION_CODE): Promise<YouTubeCategoryOption[]> {
      const url = `${YOUTUBE_DATA_API_BASE_URL}/videoCategories?part=${YOUTUBE_CATEGORIES_PART}&regionCode=${encodeURIComponent(regionCode)}`;
      const data = await fetchYouTubeJson<
        YouTubeListResponse<{
          id?: string;
          snippet?: {
            title?: string;
            assignable?: boolean;
          };
        }>
      >(url, accessToken, fetchImpl);

      return (data.items ?? [])
        .filter((item) => typeof item.id === "string" && typeof item.snippet?.title === "string")
        .map((item) => ({
          id: item.id!,
          title: item.snippet!.title!,
          assignable: item.snippet?.assignable !== false,
        }))
        .filter((item) => item.assignable);
    },

    async listI18nLanguages(accessToken: string): Promise<YouTubeLanguageOption[]> {
      const url = `${YOUTUBE_DATA_API_BASE_URL}/i18nLanguages?part=${YOUTUBE_LANGUAGES_PART}`;
      const data = await fetchYouTubeJson<
        YouTubeListResponse<{
          id?: string;
          snippet?: {
            name?: string;
          };
        }>
      >(url, accessToken, fetchImpl);

      return (data.items ?? [])
        .filter((item) => typeof item.id === "string" && typeof item.snippet?.name === "string")
        .map((item) => ({
          id: item.id!,
          name: item.snippet!.name!,
        }));
    },

    async loadOptionCatalog(accessToken: string, regionCode = YOUTUBE_DEFAULT_REGION_CODE): Promise<YouTubeOptionCatalog> {
      const [categories, languages] = await Promise.all([
        this.listVideoCategories(accessToken, regionCode),
        this.listI18nLanguages(accessToken),
      ]);

      return {
        regionCode,
        categories,
        languages,
      };
    },

    async getVideoProcessingStatus(accessToken: string, videoId: string): Promise<YouTubeVideoProcessingStatus> {
      const url = `${YOUTUBE_DATA_API_BASE_URL}/videos?part=${YOUTUBE_STATUS_POLL_PARTS.join(",")}&id=${encodeURIComponent(videoId)}`;
      const data = await fetchYouTubeJson<
        YouTubeListResponse<{
          id?: string;
          status?: {
            uploadStatus?: string;
            privacyStatus?: string;
            rejectionReason?: string;
          };
          processingDetails?: {
            processingStatus?: string;
            processingFailureReason?: string;
          };
        }>
      >(url, accessToken, fetchImpl);

      const item = data.items?.[0];
      if (!item?.id) {
        throw new Error("Uploaded video was not returned by the YouTube status endpoint.");
      }

      return {
        videoId: item.id,
        processingStatus: item.processingDetails?.processingStatus || "unknown",
        uploadStatus: item.status?.uploadStatus,
        failureReason: item.processingDetails?.processingFailureReason,
        rejectionReason: item.status?.rejectionReason,
        privacyStatus: item.status?.privacyStatus,
      };
    },
  };
}

export type YouTubeApiClient = ReturnType<typeof createYouTubeApiClient>;
