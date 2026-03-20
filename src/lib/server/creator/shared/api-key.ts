import { CREATOR_OPENAI_API_KEY_HEADER } from "../../../creator/user-ai-settings";
import { CreatorAIError } from "./errors";

export function getRequiredCreatorOpenAIApiKey(headers: Pick<Headers, "get">): string {
  const openAIApiKey = headers.get(CREATOR_OPENAI_API_KEY_HEADER)?.trim() ?? "";
  if (!openAIApiKey) {
    throw new CreatorAIError("OpenAI API key missing. Save it in Creator Hub settings first.", {
      status: 401,
      code: "missing_openai_api_key",
    });
  }

  return openAIApiKey;
}
