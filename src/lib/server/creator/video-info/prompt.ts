import type { CreatorVideoInfoGenerateRequest } from "../../../creator/types";
import {
  resolveVideoInfoPromptFieldInstruction,
  resolveVideoInfoPromptSlotLine,
} from "../../../creator/prompt-customization";
import { selectedVideoInfoBlocks } from "../shared/request-normalizers";
import { buildTimedTranscriptLines } from "../shared/transcript-format";

export const CREATOR_VIDEO_INFO_PROMPT_VERSION = "creator-video-info-v5";

function buildRequestedShape(request: CreatorVideoInfoGenerateRequest): string {
  const blocks = selectedVideoInfoBlocks(request);
  const lines: string[] = ["{"];

  const youtubeFields: string[] = [];
  if (blocks.has("titleIdeas")) youtubeFields.push('    "titleIdeas": ["string"]');
  if (blocks.has("description")) youtubeFields.push('    "description": "string"');
  if (blocks.has("pinnedComment")) youtubeFields.push('    "pinnedComment": "string"');
  if (blocks.has("hashtags")) youtubeFields.push('    "hashtags": ["string"]');
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
  const isShortPublish = request.metadataTarget === "youtube_short_publish";
  const focusedTranscriptChunks = request.focusedTranscriptChunks?.length
    ? request.focusedTranscriptChunks
    : request.transcriptChunks;
  const focusedTimedTranscript = buildTimedTranscriptLines(focusedTranscriptChunks);
  const contextTimedTranscript = request.contextTranscriptChunks?.length
    ? buildTimedTranscriptLines(request.contextTranscriptChunks)
    : "";
  const effectiveProfile = request.promptCustomization?.effectiveProfile;

  const scopeLines: string[] = [];
  if (blocks.has("titleIdeas")) scopeLines.push("youtube.titleIdeas");
  if (blocks.has("description")) scopeLines.push("youtube.description");
  if (blocks.has("pinnedComment")) scopeLines.push("youtube.pinnedComment");
  if (blocks.has("hashtags")) scopeLines.push("youtube.hashtags");
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
  const fieldInstructionLines = Array.from(blocks).flatMap((block) => {
    const instruction = resolveVideoInfoPromptFieldInstruction(block, effectiveProfile);
    if (!instruction) return [];
    return [`${block}: ${instruction}`];
  });

  return [
    resolveVideoInfoPromptSlotLine("persona", effectiveProfile),
    "Return valid JSON only.",
    isShortPublish
      ? "Produce copy-ready YouTube Shorts publish metadata for the Short transcript."
      : "Produce copy-ready packaging based on the full transcript.",
    isShortPublish
      ? "The Short transcript is the primary source of truth. Describe the Short being published, not the full source video."
      : undefined,
    isShortPublish && contextTimedTranscript
      ? "Use the full video context only to understand names, topic, continuity, and why the Short matters. Do not package the full video as if it were being published."
      : undefined,
    isShortPublish && request.contextTranscriptTruncated
      ? "The full video context has been deterministically truncated around the Short because the source transcript is long."
      : undefined,
    "Only include the requested keys. Omit every other key entirely.",
    effectiveProfile?.globalInstructions ? "" : undefined,
    effectiveProfile?.globalInstructions,
    scopeLines.length ? `Requested fields: ${scopeLines.join(", ")}` : "",
    fieldInstructionLines.length ? "" : undefined,
    fieldInstructionLines.length ? "Field-specific instructions:" : undefined,
    ...fieldInstructionLines,
    "",
    "Required JSON shape:",
    requestedShape,
    "",
    isShortPublish ? "Short transcript:" : "Transcript:",
    focusedTimedTranscript,
    isShortPublish && contextTimedTranscript ? "" : undefined,
    isShortPublish && contextTimedTranscript ? "Full video context transcript:" : undefined,
    isShortPublish && contextTimedTranscript ? contextTimedTranscript : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCollapsedVideoInfoPromptPreview(promptText: string): {
  displayText: string;
  transcriptText: string;
} {
  const marker = promptText.includes("\nShort transcript:\n") ? "\nShort transcript:\n" : "\nTranscript:\n";
  const markerIndex = promptText.indexOf(marker);
  if (markerIndex === -1) {
    return {
      displayText: promptText,
      transcriptText: "",
    };
  }

  return {
    displayText: `${promptText.slice(0, markerIndex)}\n...\nTranscript:\n[see Transcript accordion below]`,
    transcriptText: promptText.slice(markerIndex + marker.length),
  };
}
