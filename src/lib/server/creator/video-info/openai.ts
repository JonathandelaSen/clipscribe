import type {
  CreatorTracedResult,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
} from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";
import {
  buildBaseInputSummary,
  createCreatorLLMRequestFingerprint,
  runTrackedOpenAIJson,
  withValidationErrorTrace,
} from "../shared/openai-run";
import { getRuntimeSeconds } from "../shared/transcript-format";
import { mapVideoInfoOpenAIResponse } from "./mapper";
import { buildVideoInfoPrompt, CREATOR_VIDEO_INFO_PROMPT_VERSION } from "./prompt";

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
}): Promise<CreatorTracedResult<CreatorVideoInfoGenerateResponse>> {
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
        content: buildVideoInfoPrompt(input.request),
      },
    ],
    feature: "video_info",
    operation: "generate_video_info",
    promptVersion: CREATOR_VIDEO_INFO_PROMPT_VERSION,
    inputSummary: {
      ...buildBaseInputSummary(input.request),
      videoInfoBlocks: input.request.videoInfoBlocks?.slice(),
      promptCustomizationMode: input.request.promptCustomization?.mode ?? "default",
      promptCustomizationHash: input.request.promptCustomization?.hash,
      promptEditedSections: input.request.promptCustomization?.editedSections?.slice() ?? [],
    },
    requestFingerprint: createCreatorLLMRequestFingerprint({
      feature: "video_info",
      operation: "generate_video_info",
      request: input.request,
    }),
    projectId: input.request.projectId,
    sourceAssetId: input.request.sourceAssetId,
    sourceSignature: input.request.sourceSignature,
  });

  try {
    return {
      response: mapVideoInfoOpenAIResponse(input.request, parsed, `${model} (user key)`),
      llmRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI returned invalid creator video info JSON.";
    throw new CreatorAIError(message, {
      status: 502,
      code: "invalid_openai_response",
      trace: withValidationErrorTrace(llmRun, message),
    });
  }
}
