import {
  getCreatorShortRenderProgress,
  postCreatorShortRender,
} from "@/lib/server/creator/shorts/render-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getCreatorShortRenderProgress(request);
}

export async function POST(request: Request) {
  return postCreatorShortRender(request);
}
