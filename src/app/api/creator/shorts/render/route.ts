import { buildCreatorShortSystemExportResponseHeaders } from "@/lib/creator/system-export-contract";
import {
  parseCreatorShortSystemExportFormData,
  renderCreatorShortSystemExport,
} from "@/lib/server/creator/shorts/render-service";
import { isCreatorSystemRenderCanceledError } from "@/lib/server/creator/shorts/system-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorJson("Invalid form data body", 400);
  }

  let payload;
  try {
    payload = parseCreatorShortSystemExportFormData(formData);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Invalid export request", 400);
  }

  try {
    const result = await renderCreatorShortSystemExport({
      payload: payload.payload,
      sourceFile: payload.sourceFile,
      overlays: payload.overlays,
      signal: request.signal,
    });

    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        ...buildCreatorShortSystemExportResponseHeaders({
          filename: result.filename,
          width: result.width,
          height: result.height,
          sizeBytes: result.sizeBytes,
          durationSeconds: result.durationSeconds,
          subtitleBurnedIn: result.subtitleBurnedIn,
          debugNotes: result.debugNotes,
          debugFfmpegCommand: result.debugFfmpegCommand,
        }),
      },
    });
  } catch (error) {
    if (isCreatorSystemRenderCanceledError(error) || request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    return errorJson(error instanceof Error ? error.message : "System short export failed", 422);
  }
}
