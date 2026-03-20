import { renderCreatorShort } from "@/lib/server/creator/shorts/render-service";
import type { CreatorShortRenderRequest } from "@/lib/creator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function badRequest(message: string) {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!isRecord(body)) return badRequest("Request body must be an object");
  if (typeof body.filename !== "string" || !body.filename.trim()) return badRequest("filename is required");
  if (!isRecord(body.clip)) return badRequest("clip is required");
  if (!isRecord(body.plan)) return badRequest("plan is required");
  if (!isRecord(body.editor)) return badRequest("editor is required");

  const payload = body as unknown as CreatorShortRenderRequest;
  const result = await renderCreatorShort(payload);
  return Response.json(result);
}
