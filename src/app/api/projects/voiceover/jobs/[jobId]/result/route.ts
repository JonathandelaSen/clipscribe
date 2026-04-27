import { consumeVoiceoverJobResult, getVoiceoverJobStatus } from "@/lib/server/voiceover/jobs";
import { buildVoiceoverResponseHeaders } from "@/lib/voiceover/contracts";
import { VoiceoverError } from "@/lib/server/voiceover/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ jobId: string }> }) {
  const params = await props.params;
  const jobId = params.jobId;

  if (!jobId) {
    return Response.json({ ok: false, error: "Missing jobId parameter" }, { status: 400 });
  }

  try {
    // Verificar estado primero para mensajes amigables
    const job = getVoiceoverJobStatus(jobId);
    if (!job) {
      return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "completed") {
      return Response.json({ ok: false, error: "Job is not ready" }, { status: 409 });
    }

    const result = consumeVoiceoverJobResult(jobId);
    
    // Asignar keysource dummy ya que ya se consumió (el servidor original usó la key, no queremos
    // exponer la key real ni loggear nada más en este punto).
    const binaryBody = new Blob([result.bytes], {
      type: result.mimeType,
    });

    return new Response(binaryBody, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        ...buildVoiceoverResponseHeaders({
          ...result,
          apiKeySource: "voiceover_settings", // placeholder para headers
          maskedApiKey: "********", // placeholder para headers
        }),
      },
    });
  } catch (error) {
    if (error instanceof VoiceoverError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch result" }, 
      { status: 500 }
    );
  }
}
