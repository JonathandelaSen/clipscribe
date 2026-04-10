import assert from "node:assert/strict";
import test from "node:test";

import {
  getYouTubeBrowserAccessToken,
  listConnectedYouTubeChannels,
  listConnectedYouTubeRelatedVideos,
  loadConnectedYouTubeOptions,
  resolveYouTubeServerSession,
} from "../../../src/lib/youtube/server";
import { encryptYouTubeSession } from "../../../src/lib/youtube/token-store";

const ENV: NodeJS.ProcessEnv = {
  GOOGLE_CLIENT_ID: "client_id",
  GOOGLE_CLIENT_SECRET: "client_secret",
  YOUTUBE_SESSION_SECRET: "cookie_secret",
  NODE_ENV: "test",
};

test("resolveYouTubeServerSession refreshes expiring tokens and returns a fresh cookie value", async () => {
  const cookieValue = encryptYouTubeSession(
    {
      accessToken: "stale_access",
      refreshToken: "refresh_token",
      expiresAt: 10_000,
      scope: "scope_a",
      tokenType: "Bearer",
    },
    ENV.YOUTUBE_SESSION_SECRET!
  );

  const resolution = await resolveYouTubeServerSession(cookieValue, {
    env: ENV,
    now: 12_000,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          access_token: "fresh_access",
          expires_in: 3600,
          scope: "scope_a",
          token_type: "Bearer",
        }),
        { status: 200 }
      ),
  });

  assert.equal(resolution.status.connected, true);
  assert.equal(resolution.session?.accessToken, "fresh_access");
  assert.equal(typeof resolution.nextCookieValue, "string");
  assert.equal(resolution.clearCookie, false);
});

test("listConnectedYouTubeChannels uses the refreshed access token", async () => {
  const cookieValue = encryptYouTubeSession(
    {
      accessToken: "access_token",
      refreshToken: "refresh_token",
      expiresAt: 99_999_999_999_999,
      scope: "scope_a",
      tokenType: "Bearer",
    },
    ENV.YOUTUBE_SESSION_SECRET!
  );

  let receivedAccessToken = "";
  const result = await listConnectedYouTubeChannels(cookieValue, {
    env: ENV,
    apiClient: {
      listMyChannels: async (token) => {
        receivedAccessToken = token;
        return [{ id: "channel_1", title: "Main Channel" }];
      },
      listMyEligibleRelatedVideos: async () => [],
      listVideoCategories: async () => [],
      listI18nLanguages: async () => [],
      loadOptionCatalog: async () => ({ regionCode: "US", categories: [], languages: [] }),
      getVideoProcessingStatus: async () => ({
        videoId: "video_1",
        processingStatus: "succeeded",
      }),
    },
  });

  assert.equal(receivedAccessToken, "access_token");
  assert.deepEqual(result.channels, [{ id: "channel_1", title: "Main Channel" }]);
});

test("loadConnectedYouTubeOptions returns the catalog from the injected API client", async () => {
  const cookieValue = encryptYouTubeSession(
    {
      accessToken: "access_token",
      refreshToken: "refresh_token",
      expiresAt: 99_999_999_999_999,
      scope: "scope_a",
      tokenType: "Bearer",
    },
    ENV.YOUTUBE_SESSION_SECRET!
  );

  const result = await loadConnectedYouTubeOptions(cookieValue, "ES", {
    env: ENV,
    apiClient: {
      listMyChannels: async () => [],
      listMyEligibleRelatedVideos: async () => [],
      listVideoCategories: async () => [],
      listI18nLanguages: async () => [],
      loadOptionCatalog: async (_token, regionCode) => ({
        regionCode: regionCode ?? "US",
        categories: [{ id: "22", title: "People & Blogs", assignable: true }],
        languages: [{ id: "es", name: "Spanish" }],
      }),
      getVideoProcessingStatus: async () => ({
        videoId: "video_1",
        processingStatus: "succeeded",
      }),
    },
  });

  assert.deepEqual(result.catalog, {
    regionCode: "ES",
    categories: [{ id: "22", title: "People & Blogs", assignable: true }],
    languages: [{ id: "es", name: "Spanish" }],
  });
});

test("listConnectedYouTubeRelatedVideos returns eligible channel videos from the injected API client", async () => {
  const cookieValue = encryptYouTubeSession(
    {
      accessToken: "access_token",
      refreshToken: "refresh_token",
      expiresAt: 99_999_999_999_999,
      scope: "scope_a",
      tokenType: "Bearer",
    },
    ENV.YOUTUBE_SESSION_SECRET!
  );

  const result = await listConnectedYouTubeRelatedVideos(cookieValue, {
    env: ENV,
    apiClient: {
      listMyChannels: async () => [],
      listMyEligibleRelatedVideos: async () => [
        {
          videoId: "video_99",
          title: "Deep dive",
          watchUrl: "https://www.youtube.com/watch?v=video_99",
          studioUrl: "https://studio.youtube.com/video/video_99/edit",
          privacyStatus: "public",
        },
      ],
      listVideoCategories: async () => [],
      listI18nLanguages: async () => [],
      loadOptionCatalog: async () => ({ regionCode: "US", categories: [], languages: [] }),
      getVideoProcessingStatus: async () => ({
        videoId: "video_1",
        processingStatus: "succeeded",
      }),
    },
  });

  assert.deepEqual(result.videos, [
    {
      videoId: "video_99",
      title: "Deep dive",
      watchUrl: "https://www.youtube.com/watch?v=video_99",
      studioUrl: "https://studio.youtube.com/video/video_99/edit",
      privacyStatus: "public",
    },
  ]);
});

test("getYouTubeBrowserAccessToken exposes a usable short-lived access token", async () => {
  const cookieValue = encryptYouTubeSession(
    {
      accessToken: "access_token",
      refreshToken: "refresh_token",
      expiresAt: 99_999_999_999_999,
      scope: "scope_a",
      tokenType: "Bearer",
    },
    ENV.YOUTUBE_SESSION_SECRET!
  );

  const result = await getYouTubeBrowserAccessToken(cookieValue, {
    env: ENV,
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.accessToken, "access_token");
  assert.equal(result.response.tokenType, "Bearer");
});
