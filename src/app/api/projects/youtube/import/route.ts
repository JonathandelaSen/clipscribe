import { postProjectYouTubeImport } from "@/lib/server/project-youtube-import-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return postProjectYouTubeImport(request);
}
