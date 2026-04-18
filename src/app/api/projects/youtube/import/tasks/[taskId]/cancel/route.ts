import { cancelProjectYouTubeImportTask } from "@/lib/server/project-youtube-import-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const canceled = cancelProjectYouTubeImportTask(taskId);
  if (!canceled) {
    return Response.json({ ok: false, error: "Task not found or already finished." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
