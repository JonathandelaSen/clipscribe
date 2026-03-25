import { buildCreatorShortSystemExportResponseHeaders } from "@/lib/creator/system-export-contract";
import {
  parseCreatorShortSystemExportFormData,
  renderCreatorShortSystemExport,
} from "@/lib/server/creator/shorts/render-service";
import {
  appendCreatorShortRenderProgress,
  completeCreatorShortRenderProgress,
  failCreatorShortRenderProgress,
  readCreatorShortRenderProgress,
  startCreatorShortRenderProgress,
} from "@/lib/server/creator/shorts/render-progress-store";
import { isCreatorSystemRenderCanceledError } from "@/lib/server/creator/shorts/system-render";

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
  const snapshot = readCreatorShortRenderProgress(requestId, cursor);
  return Response.json(snapshot, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
    },
  });
}

export async function POST(request: Request) {
  const parseStartedAt = performance.now();
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

  const renderRequestId = payload.payload.renderRequestId?.trim() || null;
  if (renderRequestId) {
    startCreatorShortRenderProgress(
      renderRequestId,
      `Server accepted render request for ${payload.payload.sourceFilename} (overlays=${payload.overlays.length}).`
    );
  }

  try {
    const result = await renderCreatorShortSystemExport({
      payload: payload.payload,
      sourceFile: payload.sourceFile,
      overlays: payload.overlays,
      signal: request.signal,
      formDataParseMs: Number((performance.now() - parseStartedAt).toFixed(2)),
      onProgressEvent: (event) => {
        if (!renderRequestId) return;
        appendCreatorShortRenderProgress(renderRequestId, event);
      },
    });

    if (renderRequestId) {
      completeCreatorShortRenderProgress(
        renderRequestId,
        `Server render complete: ${result.filename} (${result.sizeBytes}B, encoder=${result.encoderUsed}).`
      );
    }

    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "cache-control": "no-store, max-age=0",
        ...buildCreatorShortSystemExportResponseHeaders({
          filename: result.filename,
          width: result.width,
          height: result.height,
          sizeBytes: result.sizeBytes,
          durationSeconds: result.durationSeconds,
          subtitleBurnedIn: result.subtitleBurnedIn,
          renderModeUsed: result.renderModeUsed,
          encoderUsed: result.encoderUsed,
          timingsMs: result.timingsMs,
          counts: result.counts,
          debugNotes: result.debugNotes,
          debugFfmpegCommand: result.debugFfmpegCommand,
        }),
      },
    });
  } catch (error) {
    if (isCreatorSystemRenderCanceledError(error) || request.signal.aborted) {
      if (renderRequestId) {
        failCreatorShortRenderProgress(renderRequestId, "Server render canceled.", "canceled");
      }
      return new Response(null, { status: 499 });
    }
    if (renderRequestId) {
      failCreatorShortRenderProgress(
        renderRequestId,
        error instanceof Error ? error.message : "System short export failed",
        "failed"
      );
    }
    return errorJson(error instanceof Error ? error.message : "System short export failed", 422);
  }
}
