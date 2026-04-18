import { buildProjectYouTubeImportHeaders } from "@/lib/projects/youtube-import-contract";
import {
  importProjectYouTubeVideo,
  type ImportedProjectYouTubeVideo,
} from "@/lib/server/project-youtube-import";

type LooseRecord = Record<string, unknown>;

export interface ProjectYouTubeImportRouteDependencies {
  importVideo?: (input: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ImportedProjectYouTubeVideo>;
}

function isRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorJson(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function postProjectYouTubeImport(
  request: Request,
  dependencies: ProjectYouTubeImportRouteDependencies = {}
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }

  if (!isRecord(body)) {
    return errorJson("Request body must be an object.", 400);
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return errorJson("url is required.", 400);
  }

  const importVideo = dependencies.importVideo ?? importProjectYouTubeVideo;

  try {
    const result = await importVideo({
      url,
      signal: request.signal,
    });

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
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return errorJson(error instanceof Error ? error.message : "YouTube import failed.", 422);
  }
}
