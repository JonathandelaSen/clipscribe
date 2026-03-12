import {
  buildEditorSystemExportResponseHeaders,
} from "@/lib/editor/system-export-contract";
import {
  parseEditorSystemExportFormData,
  renderEditorSystemExport,
} from "@/lib/server/editor-export-service";
import { isNodeEditorExportCanceledError } from "@/lib/editor/node-render";

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
    payload = parseEditorSystemExportFormData(formData);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Invalid export request", 400);
  }

  try {
    const result = await renderEditorSystemExport({
      project: payload.project,
      assets: payload.assets,
      resolution: payload.resolution,
      signal: request.signal,
    });

    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        ...buildEditorSystemExportResponseHeaders({
          filename: result.filename,
          width: result.width,
          height: result.height,
          sizeBytes: result.sizeBytes,
          durationSeconds: result.durationSeconds,
          warnings: result.warnings,
          debugNotes: result.debugNotes,
          debugFfmpegCommand: result.debugFfmpegCommand,
        }),
      },
    });
  } catch (error) {
    if (isNodeEditorExportCanceledError(error) || request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    return errorJson(error instanceof Error ? error.message : "System export failed", 422);
  }
}
