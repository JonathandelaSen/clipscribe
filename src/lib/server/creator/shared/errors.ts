export class CreatorAIError extends Error {
  status: number;
  code: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "CreatorAIError";
    this.status = options?.status ?? 500;
    this.code = options?.code ?? "creator_ai_error";
  }
}
