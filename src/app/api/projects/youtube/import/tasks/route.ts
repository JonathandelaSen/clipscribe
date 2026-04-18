import { startProjectYouTubeImportTask } from "@/lib/server/project-youtube-import-tasks";

function errorJson(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorJson("Request body must be an object.", 400);
  }

  const url = typeof (body as { url?: unknown }).url === "string" ? (body as { url: string }).url.trim() : "";
  if (!url) {
    return errorJson("url is required.", 400);
  }

  const taskId = startProjectYouTubeImportTask(url);
  return Response.json({ ok: true, taskId }, { status: 202 });
}
