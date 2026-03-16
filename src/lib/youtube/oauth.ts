import { YOUTUBE_FORCE_SSL_SCOPE, YOUTUBE_OAUTH_AUTHORIZE_URL, YOUTUBE_OAUTH_TOKEN_URL } from "./constants";
import { buildYouTubeRedirectUri } from "./env";
import type { YouTubeOAuthSession } from "./types";

type FetchImpl = typeof fetch;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function createSessionFromTokenResponse(
  token: GoogleTokenResponse,
  now: number,
  fallbackRefreshToken?: string
): YouTubeOAuthSession {
  if (
    typeof token.access_token !== "string" ||
    typeof token.expires_in !== "number" ||
    typeof (token.refresh_token ?? fallbackRefreshToken) !== "string" ||
    typeof token.scope !== "string" ||
    typeof token.token_type !== "string"
  ) {
    throw new Error("Google OAuth token response is missing required fields.");
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? fallbackRefreshToken!,
    expiresAt: now + token.expires_in * 1000,
    scope: token.scope,
    tokenType: token.token_type,
  };
}

async function fetchGoogleToken(
  params: URLSearchParams,
  fetchImpl: FetchImpl = fetch
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl(YOUTUBE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    const detail = data.error_description || data.error || `Token exchange failed (${response.status})`;
    throw new Error(detail);
  }

  return data;
}

export function buildYouTubeOAuthAuthorizationUrl(input: {
  origin: string;
  clientId: string;
  state: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: buildYouTubeRedirectUri(input.origin),
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: YOUTUBE_FORCE_SSL_SCOPE,
    state: input.state,
  });

  return `${YOUTUBE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeYouTubeAuthorizationCode(input: {
  origin: string;
  clientId: string;
  clientSecret: string;
  code: string;
  now?: number;
  fetchImpl?: FetchImpl;
}): Promise<YouTubeOAuthSession> {
  const params = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: buildYouTubeRedirectUri(input.origin),
    grant_type: "authorization_code",
  });

  const data = await fetchGoogleToken(params, input.fetchImpl);
  return createSessionFromTokenResponse(data, input.now ?? Date.now());
}

export async function refreshYouTubeOAuthSession(input: {
  clientId: string;
  clientSecret: string;
  session: YouTubeOAuthSession;
  now?: number;
  fetchImpl?: FetchImpl;
}): Promise<YouTubeOAuthSession> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.session.refreshToken,
  });

  const data = await fetchGoogleToken(params, input.fetchImpl);
  return createSessionFromTokenResponse(data, input.now ?? Date.now(), input.session.refreshToken);
}
