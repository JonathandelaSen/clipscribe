import { loadCreatorImageFeatureConfig } from "@/lib/server/creator/images/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = await loadCreatorImageFeatureConfig(
    request.headers,
    url.searchParams.get("provider") ?? undefined
  );
  return Response.json(config);
}
