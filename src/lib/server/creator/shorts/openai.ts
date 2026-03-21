import type { CreatorShortsGenerateRequest, CreatorShortsGenerateResponse, CreatorTracedResult } from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";
import {
  buildBaseInputSummary,
  createCreatorLLMRequestFingerprint,
  runTrackedOpenAIJson,
  withValidationErrorTrace,
} from "../shared/openai-run";
import { getRuntimeSeconds } from "../shared/transcript-format";
import { mapShortsOpenAIResponse } from "./mapper";
import { buildShortsPrompt, CREATOR_SHORTS_PROMPT_VERSION } from "./prompt";

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
}): Promise<CreatorTracedResult<CreatorShortsGenerateResponse>> {
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
  const { parsed, llmRun } = await runTrackedOpenAIJson({
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
    feature: "shorts",
    operation: "generate_shorts",
    promptVersion: CREATOR_SHORTS_PROMPT_VERSION,
    inputSummary: {
      ...buildBaseInputSummary(input.request),
      niche: input.request.niche,
      audience: input.request.audience,
      tone: input.request.tone,
    },
    requestFingerprint: createCreatorLLMRequestFingerprint({
      feature: "shorts",
      operation: "generate_shorts",
      request: input.request,
    }),
    projectId: input.request.projectId,
    sourceAssetId: input.request.sourceAssetId,
    sourceSignature: input.request.sourceSignature,
  });

  try {
    return {
      response: mapShortsOpenAIResponse(input.request, parsed, `${model} (user key)`),
      llmRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI returned invalid creator shorts JSON.";
    throw new CreatorAIError(message, {
      status: 502,
      code: "invalid_openai_response",
      trace: withValidationErrorTrace(llmRun, message),
    });
  }
}
