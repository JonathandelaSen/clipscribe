import type { CreatorShortsGenerateRequest, CreatorShortsGenerateResponse } from "../../../creator/types";
import { normalizeShortsGenerateRequest } from "../shared/request-normalizers";
import { generateShortsWithOpenAI } from "./openai";

export async function generateCreatorShorts(
  input: CreatorShortsGenerateRequest,
  options: { openAIApiKey: string }
): Promise<CreatorShortsGenerateResponse> {
  const request = normalizeShortsGenerateRequest(input);
  return generateShortsWithOpenAI({
    request,
    apiKey: options.openAIApiKey,
  });
}
