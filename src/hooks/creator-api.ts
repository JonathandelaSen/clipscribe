import type { CreatorLLMRunRecord } from "@/lib/creator/types";
import {
  markCreatorLlmRunProcessing,
  markCreatorLlmRunRequestFailed,
} from "@/lib/creator/llm-run-pending";
import { createDexieCreatorLLMRunsRepository } from "@/lib/repositories/creator-llm-runs-repo";

interface ApiErrorResponse {
  ok?: false;
  error?: string;
  details?: unknown;
}

interface ApiResponseMeta {
  creatorLlmRun?: CreatorLLMRunRecord;
}

type ApiEnvelope<TResponse> = TResponse & {
  _meta?: ApiResponseMeta;
};

interface PostJsonOptions {
  headers?: HeadersInit;
  pendingLlmRun?: CreatorLLMRunRecord;
}

const creatorLlmRunsRepository = createDexieCreatorLLMRunsRepository();

export class CreatorApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, options: { status: number; details?: unknown }) {
    super(message);
    this.name = "CreatorApiError";
    this.status = options.status;
    this.details = options.details;
  }
}

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

export async function postJson<TResponse>(url: string, payload: unknown, options?: PostJsonOptions): Promise<TResponse> {
  let pendingRun = options?.pendingLlmRun;

  if (pendingRun) {
    try {
      await creatorLlmRunsRepository.putRun(pendingRun);
      pendingRun = markCreatorLlmRunProcessing(pendingRun);
      await creatorLlmRunsRepository.putRun(pendingRun);
    } catch (error) {
      console.error("Failed to persist pending creator LLM run locally", error);
    }
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as ApiEnvelope<TResponse> | ApiErrorResponse;
    const meta = data && typeof data === "object" && "_meta" in data ? data._meta : undefined;
    await persistResponseMeta(meta);

    if (pendingRun && meta?.creatorLlmRun && meta.creatorLlmRun.id !== pendingRun.id) {
      await creatorLlmRunsRepository.deleteRun(pendingRun.id).catch((error) => {
        console.error("Failed to remove pending creator LLM run locally", error);
      });
      pendingRun = undefined;
    }

    const unwrapped = unwrapApiEnvelope<TResponse>(data);
    if (!response.ok) {
      const errorResponse = unwrapped as ApiErrorResponse;
      const message = errorResponse.error || `Request failed (${response.status})`;
      throw new CreatorApiError(message, { status: response.status, details: errorResponse.details });
    }

    if (pendingRun) {
      await creatorLlmRunsRepository.deleteRun(pendingRun.id).catch((error) => {
        console.error("Failed to remove pending creator LLM run locally", error);
      });
    }

    return unwrapped as TResponse;
  } catch (error) {
    if (pendingRun) {
      const message = error instanceof Error ? error.message : "Creator request failed";
      await creatorLlmRunsRepository
        .putRun(markCreatorLlmRunRequestFailed(pendingRun, message))
        .catch((persistError) => {
          console.error("Failed to persist failed creator LLM run locally", persistError);
        });
    }
    throw error;
  }
}
