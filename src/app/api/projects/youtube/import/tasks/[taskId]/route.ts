import { getProjectYouTubeImportTask } from "@/lib/server/project-youtube-import-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const task = getProjectYouTubeImportTask(taskId);
  if (!task) {
    return Response.json({ ok: false, error: "Task not found." }, { status: 404 });
  }

  return Response.json({
    ok: true,
    task,
  });
}
