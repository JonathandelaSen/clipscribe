import type { CreatorVideoInfoGenerateRequest } from "../../../creator/types";
import { selectedVideoInfoBlocks } from "../shared/request-normalizers";
import { buildTimedTranscriptLines } from "../shared/transcript-format";

export function buildVideoInfoPrompt(request: CreatorVideoInfoGenerateRequest): string {
  const blocks = selectedVideoInfoBlocks(request);
  const timedTranscript = buildTimedTranscriptLines(request.transcriptChunks);

  const scopeLines: string[] = [];
  if (blocks.has("titleIdeas")) scopeLines.push("youtube.titleIdeas");
  if (blocks.has("description")) scopeLines.push("youtube.description");
  if (blocks.has("pinnedComment")) scopeLines.push("youtube.pinnedComment");
  if (blocks.has("hashtagsSeo")) scopeLines.push("youtube.hashtags", "youtube.seoKeywords");
  if (blocks.has("thumbnailHooks")) scopeLines.push("youtube.thumbnailHooks");
  if (blocks.has("chapters")) scopeLines.push("youtube.chapterText", "chapters");
  if (blocks.has("contentPack")) {
    scopeLines.push(
      "content.videoSummary",
      "content.keyMoments",
      "content.hookIdeas",
      "content.ctaIdeas",
      "content.repurposeIdeas"
    );
  }
  if (blocks.has("insights")) {
    scopeLines.push(
      "insights.transcriptWordCount",
      "insights.estimatedSpeakingRateWpm",
      "insights.repeatedTerms",
      "insights.detectedTheme",
      "insights.recommendedPrimaryPlatform"
    );
  }

  return [
    "You are a senior YouTube strategist focused on long-form packaging and SEO.",
    "Return valid JSON only.",
    "Produce copy-ready packaging based on the full transcript.",
    "Use concrete timestamps for chapters.",
    scopeLines.length ? `Requested fields: ${scopeLines.join(", ")}` : "",
    "",
    "Required JSON shape:",
    `{
  "youtube": {
    "titleIdeas": ["string"],
    "description": "string",
    "pinnedComment": "string",
    "hashtags": ["string"],
    "seoKeywords": ["string"],
    "thumbnailHooks": ["string"],
    "chapterText": "string"
  },
  "content": {
    "videoSummary": "string",
    "keyMoments": ["string"],
    "hookIdeas": ["string"],
    "ctaIdeas": ["string"],
    "repurposeIdeas": ["string"]
  },
  "chapters": [
    {
      "timeSeconds": 0,
      "label": "string",
      "reason": "string"
    }
  ],
  "insights": {
    "transcriptWordCount": 0,
    "estimatedSpeakingRateWpm": 0,
    "repeatedTerms": ["string"],
    "detectedTheme": "string",
    "recommendedPrimaryPlatform": "youtube_shorts"
  }
}`,
    "",
    "Transcript:",
    timedTranscript,
  ]
    .filter(Boolean)
    .join("\n");
}
