import { NextRequest, NextResponse } from "next/server";

import { YOUTUBE_SESSION_COOKIE, YOUTUBE_SESSION_MAX_AGE_SECONDS } from "@/lib/youtube/constants";
import { normalizeYouTubeRegionCode } from "@/lib/youtube/drafts";
import { loadConnectedYouTubeOptions } from "@/lib/youtube/server";

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
    const regionCode = normalizeYouTubeRegionCode(request.nextUrl.searchParams.get("regionCode"));
    const result = await loadConnectedYouTubeOptions(request.cookies.get(YOUTUBE_SESSION_COOKIE)?.value, regionCode);
    const response = NextResponse.json({
      ok: true,
      ...result.catalog,
    });
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
        error: error instanceof Error ? error.message : "Failed to load YouTube options.",
      },
      { status: 401 }
    );
    response.cookies.delete(YOUTUBE_SESSION_COOKIE);
    return response;
  }
}
