import type { CreatorShortsGenerateRequest } from "@/lib/creator/types";
import { CreatorAIError } from "@/lib/server/creator/shared/errors";
import { getRequiredCreatorOpenAIApiKey } from "@/lib/server/creator/shared/api-key";
import { generateCreatorShorts } from "@/lib/server/creator/shorts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function errorResponse(message: string, status = 400, details?: unknown, llmRun?: CreatorAIError["trace"]) {
  return Response.json({ ok: false, error: message, details, _meta: llmRun ? { creatorLlmRun: llmRun } : undefined }, { status });
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
    const payload = body as unknown as CreatorShortsGenerateRequest;
    const result = await generateCreatorShorts(payload, { openAIApiKey });
    return Response.json({
      ...result.response,
      _meta: result.llmRun ? { creatorLlmRun: result.llmRun } : undefined,
    });
  } catch (error) {
    if (error instanceof CreatorAIError) {
      return errorResponse(error.message, error.status, { code: error.code }, error.trace);
    }

    const message = error instanceof Error ? error.message : "Creator shorts generation failed";
    return errorResponse(message, 500);
  }
}
