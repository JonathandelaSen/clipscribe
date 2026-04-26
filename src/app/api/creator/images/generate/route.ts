import type { CreatorImageGenerateRequest } from "@/lib/creator/types";
import { CreatorAIError } from "@/lib/server/creator/shared/errors";
import { generateCreatorImages } from "@/lib/server/creator/images/service";

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

  if (typeof body.prompt !== "string") {
    return errorResponse("prompt must be a string");
  }

  try {
    const payload = body as unknown as CreatorImageGenerateRequest;
    const result = await generateCreatorImages(payload, { headers: request.headers, signal: request.signal });
    return Response.json({
      ...result.response,
      _meta: result.llmRun ? { creatorLlmRun: result.llmRun } : undefined,
    });
  } catch (error) {
    if (error instanceof CreatorAIError) {
      return errorResponse(error.message, error.status, { code: error.code }, error.trace);
    }

    const message = error instanceof Error ? error.message : "Creator image generation failed";
    return errorResponse(message, 500);
  }
}
