import type { CreatorLLMRunRecord } from "../../../creator/types";

export class CreatorAIError extends Error {
  status: number;
  code: string;
  trace?: CreatorLLMRunRecord;

  constructor(message: string, options?: { status?: number; code?: string; trace?: CreatorLLMRunRecord }) {
    super(message);
    this.name = "CreatorAIError";
    this.status = options?.status ?? 500;
    this.code = options?.code ?? "creator_ai_error";
    this.trace = options?.trace;
  }
}
