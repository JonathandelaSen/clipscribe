import { loadCreatorTextFeatureConfig } from "@/lib/server/creator/shared/feature-route-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = await loadCreatorTextFeatureConfig(
    "video_info",
    request.headers,
    request.signal,
    url.searchParams.get("provider") ?? undefined
  );
  return Response.json(config);
}
