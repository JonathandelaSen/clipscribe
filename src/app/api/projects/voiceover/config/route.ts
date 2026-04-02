import { readProjectVoiceoverConfigFromEnv } from "@/lib/server/voiceover/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(readProjectVoiceoverConfigFromEnv(), {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}
