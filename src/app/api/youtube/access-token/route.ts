import { NextRequest, NextResponse } from "next/server";

import { YOUTUBE_SESSION_COOKIE, YOUTUBE_SESSION_MAX_AGE_SECONDS } from "@/lib/youtube/constants";
import { getYouTubeBrowserAccessToken } from "@/lib/youtube/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function applySessionCookie(response: NextResponse, request: NextRequest, value: string) {
  response.cookies.set({
    name: YOUTUBE_SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YOUTUBE_SESSION_MAX_AGE_SECONDS,
  });
}

export async function GET(request: NextRequest) {
  try {
    const result = await getYouTubeBrowserAccessToken(request.cookies.get(YOUTUBE_SESSION_COOKIE)?.value);
    const response = NextResponse.json(result.response);
    if (result.nextCookieValue) {
      applySessionCookie(response, request, result.nextCookieValue);
    }
    if (result.clearCookie) {
      response.cookies.delete(YOUTUBE_SESSION_COOKIE);
    }
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to issue a YouTube access token.",
      },
      { status: 401 }
    );
    response.cookies.delete(YOUTUBE_SESSION_COOKIE);
    return response;
  }
}
