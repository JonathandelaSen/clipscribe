import type { CreatorShortsGenerateRequest } from "../../../creator/types";
import { buildTimedTranscriptLines } from "../shared/transcript-format";

export const CREATOR_SHORTS_PROMPT_VERSION = "creator-shorts-v2";

export function buildShortsPrompt(request: CreatorShortsGenerateRequest): string {
  const timedTranscript = buildTimedTranscriptLines(request.transcriptChunks);

  return [
    "You are a senior short-form clip producer.",
    "Return valid JSON only.",
    "Decide the short candidates directly from the transcript and timestamps.",
    "Do not invent timestamps or clip ranges that are not grounded in the timed transcript.",
    "Return 3 to 6 ranked shorts in descending score order.",
    "Each short must be 15 to 60 seconds long, ideally 20 to 45 seconds.",
    "Each short is one complete suggestion: timing, score, title, rationale, caption, intro text, and end card text.",
    "",
    request.niche ? `Niche: ${request.niche}` : "",
    request.audience ? `Audience: ${request.audience}` : "",
    request.tone ? `Tone: ${request.tone}` : "",
    "",
    "Required JSON shape:",
    `{
  "shorts": [
    {
      "id": "short_1",
      "startSeconds": 12.5,
      "endSeconds": 41.2,
      "score": 92,
      "title": "string",
      "reason": "string",
      "caption": "string",
      "openingText": "string",
      "endCardText": "string"
    }
  ]
}`,
    "",
    "Transcript:",
    timedTranscript,
  ]
    .filter(Boolean)
    .join("\n");
}
