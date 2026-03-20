import type { CreatorVideoInfoGenerateRequest, CreatorVideoInfoGenerateResponse } from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";
import { requestOpenAIJson } from "../shared/openai-json";
import { getRuntimeSeconds } from "../shared/transcript-format";
import { mapVideoInfoOpenAIResponse } from "./mapper";
import { buildVideoInfoPrompt } from "./prompt";

function readVideoInfoConfig() {
  const model = process.env.OPENAI_CREATOR_VIDEO_INFO_MODEL;
  if (!model) {
    throw new CreatorAIError("OpenAI Creator Video Info model not configured.", {
      status: 500,
      code: "missing_model",
    });
  }

  const tempEnv = process.env.OPENAI_CREATOR_VIDEO_INFO_TEMPERATURE;
  const temperature = tempEnv && !Number.isNaN(Number(tempEnv)) ? Number(tempEnv) : 0.4;

  return { model, temperature };
}

export async function generateVideoInfoWithOpenAI(input: {
  request: CreatorVideoInfoGenerateRequest;
  apiKey: string;
}): Promise<CreatorVideoInfoGenerateResponse> {
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

  const { model, temperature } = readVideoInfoConfig();
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
        content: buildVideoInfoPrompt(input.request),
      },
    ],
  });

  return mapVideoInfoOpenAIResponse(input.request, parsed, `${model} (user key)`);
}
