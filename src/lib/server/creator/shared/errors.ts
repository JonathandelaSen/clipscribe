import type { CreatorLLMRunRecord } from "../../../creator/types";

export class CreatorAIError extends Error {
  status: number;
  code: string;
  details?: unknown;
  trace?: CreatorLLMRunRecord;

  constructor(message: string, options?: { status?: number; code?: string; details?: unknown; trace?: CreatorLLMRunRecord }) {
    super(message);
    this.name = "CreatorAIError";
    this.status = options?.status ?? 500;
    this.code = options?.code ?? "creator_ai_error";
    this.details = options?.details;
    this.trace = options?.trace;
  }
}
