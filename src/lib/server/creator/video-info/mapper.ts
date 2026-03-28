import type {
  CreatorChapter,
  CreatorInsights,
  CreatorLongFormContentPack,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
  CreatorYouTubePack,
} from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";
import { getRuntimeSeconds } from "../shared/transcript-format";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}



function readStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function createEmptyVideoInfoResponse(request: CreatorVideoInfoGenerateRequest, model: string): CreatorVideoInfoGenerateResponse {
  const runtimeSeconds = getRuntimeSeconds(request);
  const transcriptWordCount = request.transcriptText.split(/\s+/).filter(Boolean).length;
  const estimatedSpeakingRateWpm =
    runtimeSeconds > 0 ? Math.round((transcriptWordCount / runtimeSeconds) * 60) : 0;

  return {
    ok: true,
    providerMode: "openai",
    model,
    generatedAt: Date.now(),
    runtimeSeconds,
    youtube: {
      titleIdeas: [],
      description: "",
      pinnedComment: "",
      hashtags: [],
      thumbnailHooks: [],
      chapterText: "",
    },
    content: {
      videoSummary: "",
      keyMoments: [],
      hookIdeas: [],
      ctaIdeas: [],
      repurposeIdeas: [],
    },
    chapters: [],
    insights: {
      transcriptWordCount,
      estimatedSpeakingRateWpm,
      repeatedTerms: [],
      detectedTheme: "",
    },
  };
}

function parseChapters(candidate: unknown): CreatorChapter[] {
  if (!Array.isArray(candidate)) return [];

  return candidate.flatMap((row, index) => {
    if (!isRecord(row)) return [];
    const timeSeconds = Number(row.timeSeconds);
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!Number.isFinite(timeSeconds) || !label) return [];

    return [
      {
        id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `chapter_${index + 1}`,
        timeSeconds,
        label,
        reason: typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : "AI-generated chapter",
      },
    ];
  });
}

function parseYouTubePack(candidate: unknown): Partial<CreatorYouTubePack> {
  if (!isRecord(candidate)) return {};

  return {
    titleIdeas: readStringArray(candidate.titleIdeas, 8),
    description: typeof candidate.description === "string" ? candidate.description.trim() : "",
    pinnedComment: typeof candidate.pinnedComment === "string" ? candidate.pinnedComment.trim() : "",
    hashtags: readStringArray(candidate.hashtags, 12),
    thumbnailHooks: readStringArray(candidate.thumbnailHooks, 8),
    chapterText: typeof candidate.chapterText === "string" ? candidate.chapterText.trim() : "",
  };
}

function parseContentPack(candidate: unknown): Partial<CreatorLongFormContentPack> {
  if (!isRecord(candidate)) return {};

  return {
    videoSummary: typeof candidate.videoSummary === "string" ? candidate.videoSummary.trim() : "",
    keyMoments: readStringArray(candidate.keyMoments, 10),
    hookIdeas: readStringArray(candidate.hookIdeas, 8),
    ctaIdeas: readStringArray(candidate.ctaIdeas, 8),
    repurposeIdeas: readStringArray(candidate.repurposeIdeas, 10),
  };
}

function parseInsights(candidate: unknown, fallback: CreatorInsights): CreatorInsights {
  if (!isRecord(candidate)) return fallback;

  return {
    transcriptWordCount:
      typeof candidate.transcriptWordCount === "number" && Number.isFinite(candidate.transcriptWordCount)
        ? Math.round(candidate.transcriptWordCount)
        : fallback.transcriptWordCount,
    estimatedSpeakingRateWpm:
      typeof candidate.estimatedSpeakingRateWpm === "number" && Number.isFinite(candidate.estimatedSpeakingRateWpm)
        ? Math.round(candidate.estimatedSpeakingRateWpm)
        : fallback.estimatedSpeakingRateWpm,
    repeatedTerms: readStringArray(candidate.repeatedTerms, 20),
    detectedTheme: typeof candidate.detectedTheme === "string" ? candidate.detectedTheme.trim() : fallback.detectedTheme,
  };
}

export function mapVideoInfoOpenAIResponse(
  request: CreatorVideoInfoGenerateRequest,
  candidate: unknown,
  model: string
): CreatorVideoInfoGenerateResponse {
  if (!isRecord(candidate)) {
    throw new CreatorAIError("OpenAI returned a non-object JSON payload.", {
      status: 502,
      code: "invalid_openai_response",
    });
  }

  const response = createEmptyVideoInfoResponse(request, model);
  response.youtube = {
    ...response.youtube,
    ...parseYouTubePack(candidate.youtube),
  };
  response.content = {
    ...response.content,
    ...parseContentPack(candidate.content),
  };
  response.chapters = parseChapters(candidate.chapters);
  response.insights = parseInsights(candidate.insights, response.insights);

  return response;
}
