import { NextRequest, NextResponse } from "next/server";

import { YOUTUBE_SESSION_COOKIE, YOUTUBE_STATE_COOKIE } from "@/lib/youtube/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const secure = request.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production";
  response.cookies.set({
    name: YOUTUBE_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set({
    name: YOUTUBE_STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return response;
}
