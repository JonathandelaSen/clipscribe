import { loadCreatorTextFeatureConfig } from "@/lib/server/creator/shared/feature-route-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = await loadCreatorTextFeatureConfig("shorts", request.headers, request.signal);
  return Response.json(config);
}
