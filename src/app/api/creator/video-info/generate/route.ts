import type { CreatorVideoInfoGenerateRequest } from "@/lib/creator/types";
import { CreatorAIError } from "@/lib/server/creator/shared/errors";
import { getRequiredCreatorOpenAIApiKey } from "@/lib/server/creator/shared/api-key";
import { generateCreatorVideoInfo } from "@/lib/server/creator/video-info/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function errorResponse(message: string, status = 400, details?: unknown) {
  return Response.json({ ok: false, error: message, details }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return errorResponse("Invalid JSON body");
  }

  if (!isRecord(body)) {
    return errorResponse("Request body must be an object");
  }

  const transcriptText = body.transcriptText;
  const transcriptChunks = body.transcriptChunks;

  if (typeof transcriptText !== "string") {
    return errorResponse("transcriptText must be a string");
  }
  if (!Array.isArray(transcriptChunks)) {
    return errorResponse("transcriptChunks must be an array");
  }

  try {
    const openAIApiKey = getRequiredCreatorOpenAIApiKey(request.headers);
    const payload = body as unknown as CreatorVideoInfoGenerateRequest;
    const result = await generateCreatorVideoInfo(payload, { openAIApiKey });
    return Response.json(result);
  } catch (error) {
    if (error instanceof CreatorAIError) {
      return errorResponse(error.message, error.status, { code: error.code });
    }

    const message = error instanceof Error ? error.message : "Creator video info generation failed";
    return errorResponse(message, 500);
  }
}
