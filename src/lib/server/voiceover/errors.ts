export class VoiceoverError extends Error {
  status: number;
  code: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "VoiceoverError";
    this.status = options?.status ?? 500;
    this.code = options?.code ?? "voiceover_error";
  }
}
