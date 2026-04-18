import { buildProjectYouTubeImportHeaders } from "@/lib/projects/youtube-import-contract";
import { consumeProjectYouTubeImportTaskResult } from "@/lib/server/project-youtube-import-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const result = consumeProjectYouTubeImportTaskResult(taskId);
  if (!result) {
    return Response.json({ ok: false, error: "Import result not available." }, { status: 404 });
  }

  return new Response(result.bytes, {
    status: 200,
    headers: {
      "content-type": result.mimeType,
      ...buildProjectYouTubeImportHeaders({
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        durationSeconds: result.durationSeconds,
        width: result.width,
        height: result.height,
        videoId: result.videoId,
        title: result.title,
        channelTitle: result.channelTitle,
      }),
    },
  });
}
