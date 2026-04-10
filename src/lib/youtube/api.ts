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
  YouTubeRelatedVideoOption,
  YouTubeVideoProcessingStatus,
} from "./types";
import { createYouTubeResultUrls } from "./drafts";

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

    async listMyEligibleRelatedVideos(accessToken: string, maxResults = 25): Promise<YouTubeRelatedVideoOption[]> {
      const channelData = await fetchYouTubeJson<
        YouTubeListResponse<{
          contentDetails?: {
            relatedPlaylists?: {
              uploads?: string;
            };
          };
        }>
      >(`${YOUTUBE_DATA_API_BASE_URL}/channels?part=contentDetails&mine=true`, accessToken, fetchImpl);

      const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) {
        return [];
      }

      const playlistData = await fetchYouTubeJson<
        YouTubeListResponse<{
          snippet?: {
            publishedAt?: string;
            title?: string;
            resourceId?: {
              videoId?: string;
            };
            thumbnails?: {
              default?: { url?: string };
              medium?: { url?: string };
              high?: { url?: string };
            };
          };
        }>
      >(
        `${YOUTUBE_DATA_API_BASE_URL}/playlistItems?part=snippet&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${Math.max(1, Math.min(50, maxResults))}`,
        accessToken,
        fetchImpl
      );

      const orderedItems: Array<{
        videoId: string;
        title?: string;
        publishedAt?: string;
        thumbnailUrl?: string;
      }> = [];
      for (const item of playlistData.items ?? []) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (typeof videoId !== "string" || videoId.length === 0) continue;
        orderedItems.push({
          videoId,
          title: item.snippet?.title,
          publishedAt: item.snippet?.publishedAt,
          thumbnailUrl:
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url,
        });
      }

      if (orderedItems.length === 0) {
        return [];
      }

      const detailsData = await fetchYouTubeJson<
        YouTubeListResponse<{
          id?: string;
          status?: {
            privacyStatus?: string;
          };
          snippet?: {
            title?: string;
            publishedAt?: string;
            thumbnails?: {
              default?: { url?: string };
              medium?: { url?: string };
              high?: { url?: string };
            };
          };
        }>
      >(
        `${YOUTUBE_DATA_API_BASE_URL}/videos?part=snippet,status&id=${encodeURIComponent(orderedItems.map((item) => item.videoId).join(","))}`,
        accessToken,
        fetchImpl
      );

      const detailById = new Map(
        (detailsData.items ?? [])
          .filter(
            (item): item is NonNullable<typeof item> & { id: string } =>
              typeof item.id === "string" && item.id.length > 0
          )
          .map((item) => [item.id, item])
      );

      return orderedItems.flatMap((item) => {
        const detail = detailById.get(item.videoId);
        const privacyStatus = detail?.status?.privacyStatus;
        if (privacyStatus !== "public" && privacyStatus !== "unlisted") {
          return [];
        }

        const urls = createYouTubeResultUrls(item.videoId);
        return [
          {
            videoId: item.videoId,
            title: detail?.snippet?.title || item.title || item.videoId,
            watchUrl: urls.watchUrl,
            studioUrl: urls.studioUrl,
            privacyStatus,
            publishedAt: detail?.snippet?.publishedAt || item.publishedAt,
            thumbnailUrl:
              detail?.snippet?.thumbnails?.high?.url ||
              detail?.snippet?.thumbnails?.medium?.url ||
              detail?.snippet?.thumbnails?.default?.url ||
              item.thumbnailUrl,
          },
        ];
      });
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
