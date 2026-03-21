import type { CreatorLLMRunRecord } from "@/lib/creator/types";
import { createDexieCreatorLLMRunsRepository } from "@/lib/repositories/creator-llm-runs-repo";

interface ApiErrorResponse {
  ok?: false;
  error?: string;
}

interface ApiResponseMeta {
  creatorLlmRun?: CreatorLLMRunRecord;
}

type ApiEnvelope<TResponse> = TResponse & {
  _meta?: ApiResponseMeta;
};

const creatorLlmRunsRepository = createDexieCreatorLLMRunsRepository();

async function persistResponseMeta(meta: ApiResponseMeta | undefined): Promise<void> {
  if (!meta?.creatorLlmRun) return;
  try {
    await creatorLlmRunsRepository.putRun(meta.creatorLlmRun);
  } catch (error) {
    console.error("Failed to persist creator LLM run locally", error);
  }
}

function unwrapApiEnvelope<TResponse>(value: ApiEnvelope<TResponse> | ApiErrorResponse): TResponse | ApiErrorResponse {
  if (!value || typeof value !== "object" || !("_meta" in value)) {
    return value;
  }
  const rest = { ...(value as ApiEnvelope<TResponse>) };
  delete (rest as { _meta?: ApiResponseMeta })._meta;
  return rest as TResponse | ApiErrorResponse;
}

export async function postJson<TResponse>(url: string, payload: unknown, headers?: HeadersInit): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as ApiEnvelope<TResponse> | ApiErrorResponse;
  const meta = data && typeof data === "object" && "_meta" in data ? data._meta : undefined;
  await persistResponseMeta(meta);
  const unwrapped = unwrapApiEnvelope<TResponse>(data);
  if (!response.ok) {
    const message = (unwrapped as ApiErrorResponse).error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return unwrapped as TResponse;
}
