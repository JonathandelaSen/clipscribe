import type {
  CreatorTracedResult,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
} from "../../../creator/types";
import { normalizeVideoInfoGenerateRequest } from "../shared/request-normalizers";
import { generateVideoInfoWithOpenAI } from "./openai";

export async function generateCreatorVideoInfo(
  input: CreatorVideoInfoGenerateRequest,
  options: { openAIApiKey: string }
): Promise<CreatorTracedResult<CreatorVideoInfoGenerateResponse>> {
  const request = normalizeVideoInfoGenerateRequest(input);
  return generateVideoInfoWithOpenAI({
    request,
    apiKey: options.openAIApiKey,
  });
}
