import type { CreatorVideoInfoGenerateRequest } from "../../../creator/types";
import { selectedVideoInfoBlocks } from "../shared/request-normalizers";
import { buildTimedTranscriptLines } from "../shared/transcript-format";

export const CREATOR_VIDEO_INFO_PROMPT_VERSION = "creator-video-info-v2";

function buildRequestedShape(request: CreatorVideoInfoGenerateRequest): string {
  const blocks = selectedVideoInfoBlocks(request);
  const lines: string[] = ["{"];

  const youtubeFields: string[] = [];
  if (blocks.has("titleIdeas")) youtubeFields.push('    "titleIdeas": ["string"]');
  if (blocks.has("description")) youtubeFields.push('    "description": "string"');
  if (blocks.has("pinnedComment")) youtubeFields.push('    "pinnedComment": "string"');
  if (blocks.has("hashtagsSeo")) {
    youtubeFields.push('    "hashtags": ["string"]');
    youtubeFields.push('    "seoKeywords": ["string"]');
  }
  if (blocks.has("thumbnailHooks")) youtubeFields.push('    "thumbnailHooks": ["string"]');
  if (blocks.has("chapters")) youtubeFields.push('    "chapterText": "string"');
  if (youtubeFields.length > 0) {
    lines.push('  "youtube": {');
    lines.push(youtubeFields.join(",\n"));
    lines.push("  }");
  }

  if (blocks.has("contentPack")) {
    if (lines.length > 1) lines[lines.length - 1] = `${lines[lines.length - 1]},`;
    lines.push('  "content": {');
    lines.push('    "videoSummary": "string",');
    lines.push('    "keyMoments": ["string"],');
    lines.push('    "hookIdeas": ["string"],');
    lines.push('    "ctaIdeas": ["string"],');
    lines.push('    "repurposeIdeas": ["string"]');
    lines.push("  }");
  }

  if (blocks.has("chapters")) {
    if (lines.length > 1) lines[lines.length - 1] = `${lines[lines.length - 1]},`;
    lines.push('  "chapters": [');
    lines.push("    {");
    lines.push('      "timeSeconds": 0,');
    lines.push('      "label": "string",');
    lines.push('      "reason": "string"');
    lines.push("    }");
    lines.push("  ]");
  }

  if (blocks.has("insights")) {
    if (lines.length > 1) lines[lines.length - 1] = `${lines[lines.length - 1]},`;
    lines.push('  "insights": {');
    lines.push('    "transcriptWordCount": 0,');
    lines.push('    "estimatedSpeakingRateWpm": 0,');
    lines.push('    "repeatedTerms": ["string"],');
    lines.push('    "detectedTheme": "string"');
    lines.push("  }");
  }

  lines.push("}");
  return lines.join("\n");
}

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
      "insights.detectedTheme"
    );
  }

  const requestedShape = buildRequestedShape(request);

  return [
    "You are a senior YouTube strategist focused on long-form packaging and SEO.",
    "Return valid JSON only.",
    "Produce copy-ready packaging based on the full transcript.",
    "Use concrete timestamps for chapters.",
    "Only include the requested keys. Omit every other key entirely.",
    scopeLines.length ? `Requested fields: ${scopeLines.join(", ")}` : "",
    "",
    "Required JSON shape:",
    requestedShape,
    "",
    "Transcript:",
    timedTranscript,
  ]
    .filter(Boolean)
    .join("\n");
}
