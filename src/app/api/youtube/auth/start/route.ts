import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  YOUTUBE_STATE_COOKIE,
  YOUTUBE_STATE_MAX_AGE_SECONDS,
} from "@/lib/youtube/constants";
import { getYouTubeEnvConfig } from "@/lib/youtube/env";
import { buildYouTubeOAuthAuthorizationUrl } from "@/lib/youtube/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSecureCookie(request: NextRequest) {
  return request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production";
}

export async function GET(request: NextRequest) {
  const config = getYouTubeEnvConfig();
  if (!config.configured || !config.clientId) {
    return Response.json(
      {
        ok: false,
        error: "YouTube OAuth is not configured.",
        missingEnvKeys: config.missingKeys,
      },
      { status: 503 }
    );
  }

  const state = randomUUID();
  const response = NextResponse.redirect(
    buildYouTubeOAuthAuthorizationUrl({
      origin: request.nextUrl.origin,
      clientId: config.clientId,
      state,
    })
  );

  response.cookies.set({
    name: YOUTUBE_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(request),
    path: "/",
    maxAge: YOUTUBE_STATE_MAX_AGE_SECONDS,
  });

  return response;
}
