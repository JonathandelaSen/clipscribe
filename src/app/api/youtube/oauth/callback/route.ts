import { NextRequest, NextResponse } from "next/server";

import {
  YOUTUBE_SESSION_COOKIE,
  YOUTUBE_SESSION_MAX_AGE_SECONDS,
  YOUTUBE_STATE_COOKIE,
} from "@/lib/youtube/constants";
import { getYouTubeEnvConfig } from "@/lib/youtube/env";
import { exchangeYouTubeAuthorizationCode } from "@/lib/youtube/oauth";
import { encryptYouTubeSession } from "@/lib/youtube/token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSecureCookie(request: NextRequest) {
  return request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production";
}

function redirectToTool(request: NextRequest, status: string, detail?: string) {
  const target = new URL("/creator/youtube", request.nextUrl.origin);
  target.searchParams.set("youtube", status);
  if (detail) target.searchParams.set("detail", detail);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const config = getYouTubeEnvConfig();
  if (!config.configured || !config.clientId || !config.clientSecret || !config.sessionSecret) {
    return redirectToTool(request, "misconfigured");
  }

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return redirectToTool(request, "oauth_error", oauthError);
  }

  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(YOUTUBE_STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return redirectToTool(request, "state_error");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return redirectToTool(request, "missing_code");
  }

  try {
    const session = await exchangeYouTubeAuthorizationCode({
      origin: request.nextUrl.origin,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
    });
    const response = redirectToTool(request, "connected");
    response.cookies.set({
      name: YOUTUBE_SESSION_COOKIE,
      value: encryptYouTubeSession(session, config.sessionSecret),
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie(request),
      path: "/",
      maxAge: YOUTUBE_SESSION_MAX_AGE_SECONDS,
    });
    response.cookies.set({
      name: YOUTUBE_STATE_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie(request),
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "oauth_exchange_failed";
    return redirectToTool(request, "oauth_error", detail);
  }
}
