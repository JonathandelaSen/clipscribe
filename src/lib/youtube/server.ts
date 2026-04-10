import { getYouTubeEnvConfig } from "./env";
import { refreshYouTubeOAuthSession } from "./oauth";
import { decryptYouTubeSession, encryptYouTubeSession } from "./token-store";
import { createYouTubeApiClient, type YouTubeApiClient } from "./api";
import type {
  YouTubeAccessTokenResponse,
  YouTubeOAuthSession,
  YouTubeOptionCatalog,
  YouTubeRelatedVideoOption,
  YouTubeSessionStatus,
  YouTubeChannelSummary,
} from "./types";

type FetchImpl = typeof fetch;

interface ServerDeps {
  env?: NodeJS.ProcessEnv;
  now?: number;
  fetchImpl?: FetchImpl;
  apiClient?: YouTubeApiClient;
}

interface SessionResolution {
  status: YouTubeSessionStatus;
  session?: YouTubeOAuthSession;
  nextCookieValue?: string;
  clearCookie: boolean;
}

function needsRefresh(session: YouTubeOAuthSession, now: number): boolean {
  return session.expiresAt - now < 60_000;
}

export async function resolveYouTubeServerSession(
  cookieValue: string | undefined,
  deps: ServerDeps = {}
): Promise<SessionResolution> {
  const config = getYouTubeEnvConfig(deps.env);
  if (!config.configured || !config.sessionSecret || !config.clientId || !config.clientSecret) {
    return {
      status: {
        configured: false,
        connected: false,
        missingEnvKeys: config.missingKeys,
      },
      clearCookie: false,
    };
  }

  if (!cookieValue) {
    return {
      status: {
        configured: true,
        connected: false,
      },
      clearCookie: false,
    };
  }

  const parsed = decryptYouTubeSession(cookieValue, config.sessionSecret);
  if (!parsed) {
    return {
      status: {
        configured: true,
        connected: false,
      },
      clearCookie: true,
    };
  }

  const now = deps.now ?? Date.now();
  if (!needsRefresh(parsed, now)) {
    return {
      status: {
        configured: true,
        connected: true,
        expiresAt: parsed.expiresAt,
      },
      session: parsed,
      clearCookie: false,
    };
  }

  const refreshed = await refreshYouTubeOAuthSession({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    session: parsed,
    now,
    fetchImpl: deps.fetchImpl,
  });

  return {
    status: {
      configured: true,
      connected: true,
      expiresAt: refreshed.expiresAt,
    },
    session: refreshed,
    nextCookieValue: encryptYouTubeSession(refreshed, config.sessionSecret),
    clearCookie: false,
  };
}

function requireConnectedSession(resolution: SessionResolution): YouTubeOAuthSession {
  if (!resolution.session) {
    throw new Error("YouTube is not connected.");
  }
  return resolution.session;
}

export async function getYouTubeBrowserAccessToken(
  cookieValue: string | undefined,
  deps: ServerDeps = {}
): Promise<{ response: YouTubeAccessTokenResponse; nextCookieValue?: string; clearCookie: boolean }> {
  const resolution = await resolveYouTubeServerSession(cookieValue, deps);
  const session = requireConnectedSession(resolution);

  return {
    response: {
      ok: true,
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      tokenType: session.tokenType,
    },
    nextCookieValue: resolution.nextCookieValue,
    clearCookie: resolution.clearCookie,
  };
}

export async function listConnectedYouTubeChannels(
  cookieValue: string | undefined,
  deps: ServerDeps = {}
): Promise<{ channels: YouTubeChannelSummary[]; nextCookieValue?: string; clearCookie: boolean }> {
  const resolution = await resolveYouTubeServerSession(cookieValue, deps);
  const session = requireConnectedSession(resolution);
  const apiClient = deps.apiClient ?? createYouTubeApiClient(deps.fetchImpl);

  return {
    channels: await apiClient.listMyChannels(session.accessToken),
    nextCookieValue: resolution.nextCookieValue,
    clearCookie: resolution.clearCookie,
  };
}

export async function loadConnectedYouTubeOptions(
  cookieValue: string | undefined,
  regionCode: string | undefined,
  deps: ServerDeps = {}
): Promise<{ catalog: YouTubeOptionCatalog; nextCookieValue?: string; clearCookie: boolean }> {
  const resolution = await resolveYouTubeServerSession(cookieValue, deps);
  const session = requireConnectedSession(resolution);
  const apiClient = deps.apiClient ?? createYouTubeApiClient(deps.fetchImpl);

  return {
    catalog: await apiClient.loadOptionCatalog(session.accessToken, regionCode),
    nextCookieValue: resolution.nextCookieValue,
    clearCookie: resolution.clearCookie,
  };
}

export async function listConnectedYouTubeRelatedVideos(
  cookieValue: string | undefined,
  deps: ServerDeps = {}
): Promise<{ videos: YouTubeRelatedVideoOption[]; nextCookieValue?: string; clearCookie: boolean }> {
  const resolution = await resolveYouTubeServerSession(cookieValue, deps);
  const session = requireConnectedSession(resolution);
  const apiClient = deps.apiClient ?? createYouTubeApiClient(deps.fetchImpl);

  return {
    videos: await apiClient.listMyEligibleRelatedVideos(session.accessToken),
    nextCookieValue: resolution.nextCookieValue,
    clearCookie: resolution.clearCookie,
  };
}
