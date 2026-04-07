import {
  buildEditorSystemExportResponseHeaders,
  EDITOR_SYSTEM_EXPORT_FORM_FIELDS,
} from "@/lib/editor/system-export-contract";
import {
  parseEditorSystemExportFormData,
  renderEditorSystemExport,
} from "@/lib/server/editor-export-service";
import {
  appendEditorExportProgress,
  completeEditorExportProgress,
  failEditorExportProgress,
  readEditorExportProgress,
  startEditorExportProgress,
} from "@/lib/server/editor-export-progress-store";
import { isNodeEditorExportCanceledError } from "@/lib/editor/node-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId")?.trim() ?? "";
  if (!requestId) {
    return errorJson("requestId is required.", 400);
  }

  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw == null ? -1 : Number(cursorRaw);
  const snapshot = readEditorExportProgress(requestId, cursor);
  return Response.json(snapshot, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
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

  const requestId = formData.get(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.requestId);
  const renderRequestId = typeof requestId === "string" ? requestId.trim() : "";
  if (renderRequestId) {
    startEditorExportProgress(
      renderRequestId,
      `Server accepted timeline export (${payload.assets.length} asset${payload.assets.length === 1 ? "" : "s"}).`
    );
  }

  try {
    const result = await renderEditorSystemExport({
      project: payload.project,
      assets: payload.assets,
      overlays: payload.overlays,
      resolution: payload.resolution,
      signal: request.signal,
      onProgress: (progress) => {
        if (!renderRequestId) return;
        appendEditorExportProgress(renderRequestId, {
          stage: "rendering",
          message: `Rendering ${Math.round(progress.percent)}%`,
          progressPct: progress.percent,
          processedSeconds: progress.processedSeconds,
          durationSeconds: progress.durationSeconds,
        });
      },
    });

    if (renderRequestId) {
      completeEditorExportProgress(
        renderRequestId,
        `Server export complete: ${result.filename} (${result.sizeBytes}B).`
      );
    }

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
      if (renderRequestId) {
        failEditorExportProgress(renderRequestId, "Server export canceled.", "canceled");
      }
      return new Response(null, { status: 499 });
    }
    if (renderRequestId) {
      failEditorExportProgress(
        renderRequestId,
        error instanceof Error ? error.message : "System export failed",
        "failed"
      );
    }
    return errorJson(error instanceof Error ? error.message : "System export failed", 422);
  }
}
