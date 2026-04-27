import { getVoiceoverJobStatus } from "@/lib/server/voiceover/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const params = await props.params;
  const jobId = params.jobId;

  if (!jobId) {
    return Response.json({ ok: false, error: "Missing jobId parameter" }, { status: 400 });
  }

  const job = getVoiceoverJobStatus(jobId);
  if (!job) {
    return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  return Response.json({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    error: job.error,
  });
}
