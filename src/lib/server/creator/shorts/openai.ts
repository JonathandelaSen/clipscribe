import type { CreatorShortsGenerateRequest, CreatorShortsGenerateResponse } from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";
import { requestOpenAIJson } from "../shared/openai-json";
import { getRuntimeSeconds } from "../shared/transcript-format";
import { mapShortsOpenAIResponse } from "./mapper";
import { buildShortsPrompt } from "./prompt";

function readShortsConfig() {
  const model = process.env.OPENAI_CREATOR_SHORTS_MODEL;
  if (!model) {
    throw new CreatorAIError("OpenAI Creator Shorts model not configured.", {
      status: 500,
      code: "missing_model",
    });
  }

  const tempEnv = process.env.OPENAI_CREATOR_SHORTS_TEMPERATURE;
  const temperature = tempEnv && !Number.isNaN(Number(tempEnv)) ? Number(tempEnv) : 0.4;

  return { model, temperature };
}

export async function generateShortsWithOpenAI(input: {
  request: CreatorShortsGenerateRequest;
  apiKey: string;
}): Promise<CreatorShortsGenerateResponse> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new CreatorAIError("Missing OpenAI API key.", {
      status: 401,
      code: "missing_openai_api_key",
    });
  }

  const runtimeSeconds = getRuntimeSeconds(input.request);
  if (!input.request.transcriptChunks.length || runtimeSeconds <= 0) {
    throw new CreatorAIError("A timed transcript is required before running Creator AI.", {
      status: 422,
      code: "missing_timed_transcript",
    });
  }

  const { model, temperature } = readShortsConfig();
  const parsed = await requestOpenAIJson({
    apiKey,
    model,
    temperature,
    messages: [
      {
        role: "system",
        content: "You return strict JSON for creator tooling. Never include markdown.",
      },
      {
        role: "user",
        content: buildShortsPrompt(input.request),
      },
    ],
  });

  return mapShortsOpenAIResponse(input.request, parsed, `${model} (user key)`);
}
