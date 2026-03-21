import { EDITOR_PRESETS } from "../../../creator/editor-presets";
import type { SubtitleChunk } from "../../../history";
import {
  type CreatorShortPlan,
  type CreatorShortsGenerateRequest,
  type CreatorShortsGenerateResponse,
  type CreatorViralClip,
} from "../../../creator/types";
import { CreatorAIError } from "../shared/errors";
import { getRuntimeSeconds } from "../shared/transcript-format";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}



function readFiniteNumber(value: unknown, field: string): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    throw new CreatorAIError(`OpenAI response missing valid ${field}.`, {
      status: 502,
      code: "invalid_openai_response",
    });
  }
  return next;
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CreatorAIError(`OpenAI response missing valid ${field}.`, {
      status: 502,
      code: "invalid_openai_response",
    });
  }
  return value.trim();
}

function deriveSourceChunkIndexes(chunks: SubtitleChunk[], startSeconds: number, endSeconds: number): number[] {
  const indexes: number[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1] ?? start;
    if (typeof start !== "number") continue;
    const effectiveEnd = typeof end === "number" ? end : start;
    if (start < endSeconds && effectiveEnd > startSeconds) {
      indexes.push(index);
    }
  }

  return indexes;
}

function createEmptyShortsResponse(request: CreatorShortsGenerateRequest, model: string): CreatorShortsGenerateResponse {
  const runtimeSeconds = getRuntimeSeconds(request);

  return {
    ok: true,
    providerMode: "openai",
    model,
    generatedAt: Date.now(),
    runtimeSeconds,
    viralClips: [],
    shortsPlans: [],
    editorPresets: EDITOR_PRESETS,
  };
}

function parseViralClips(request: CreatorShortsGenerateRequest, candidate: unknown, runtimeSeconds: number): CreatorViralClip[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new CreatorAIError("OpenAI did not return any viral clips.", {
      status: 502,
      code: "missing_viral_clips",
    });
  }

  return candidate.map((row, index) => {
    if (!isRecord(row)) {
      throw new CreatorAIError("OpenAI returned an invalid viral clip entry.", {
        status: 502,
        code: "invalid_openai_response",
      });
    }

    const startSeconds = readFiniteNumber(row.startSeconds, `viralClips[${index}].startSeconds`);
    const endSeconds = readFiniteNumber(row.endSeconds, `viralClips[${index}].endSeconds`);
    const score = Math.round(readFiniteNumber(row.score, `viralClips[${index}].score`));

    if (startSeconds < 0 || endSeconds <= startSeconds || endSeconds > runtimeSeconds) {
      throw new CreatorAIError("OpenAI returned clip timestamps outside the source bounds.", {
        status: 502,
        code: "invalid_clip_range",
      });
    }

    const sourceChunkIndexes = deriveSourceChunkIndexes(request.transcriptChunks, startSeconds, endSeconds);
    if (sourceChunkIndexes.length === 0) {
      throw new CreatorAIError("OpenAI returned a clip that does not overlap any transcript chunk.", {
        status: 502,
        code: "invalid_clip_range",
      });
    }

    return {
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `clip_${index + 1}`,
      startSeconds,
      endSeconds,
      durationSeconds: Number((endSeconds - startSeconds).toFixed(3)),
      score,
      title: readNonEmptyString(row.title, `viralClips[${index}].title`),
      hook: readNonEmptyString(row.hook, `viralClips[${index}].hook`),
      reason: readNonEmptyString(row.reason, `viralClips[${index}].reason`),
      punchline: readNonEmptyString(row.punchline, `viralClips[${index}].punchline`),
      sourceChunkIndexes,
      suggestedSubtitleLanguage: "en",
    };
  });
}

function parseShortsPlans(candidate: unknown, clips: CreatorViralClip[]): CreatorShortPlan[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new CreatorAIError("OpenAI did not return any shorts plans.", {
      status: 502,
      code: "missing_shorts_plans",
    });
  }

  const clipIds = new Set(clips.map((clip) => clip.id));
  const plans = candidate.map((row, index) => {
    if (!isRecord(row)) {
      throw new CreatorAIError("OpenAI returned an invalid short plan entry.", {
        status: 502,
        code: "invalid_openai_response",
      });
    }

    const clipId = readNonEmptyString(row.clipId, `shortsPlans[${index}].clipId`);
    if (!clipIds.has(clipId)) {
      throw new CreatorAIError(`OpenAI returned a short plan for an unknown clip id: ${clipId}.`, {
        status: 502,
        code: "invalid_shorts_plan",
      });
    }

    const preset = EDITOR_PRESETS[0];

    return {
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `shortplan_${index + 1}`,
      clipId,
      title: readNonEmptyString(row.title, `shortsPlans[${index}].title`),
      caption: readNonEmptyString(row.caption, `shortsPlans[${index}].caption`),
      openingText: readNonEmptyString(row.openingText, `shortsPlans[${index}].openingText`),
      endCardText: readNonEmptyString(row.endCardText, `shortsPlans[${index}].endCardText`),
      editorPreset: preset,
    };
  });

  for (const clip of clips) {
    if (!plans.some((plan) => plan.clipId === clip.id)) {
      throw new CreatorAIError(`OpenAI did not return any short plan for ${clip.id}.`, {
        status: 502,
        code: "invalid_shorts_plan",
      });
    }
  }

  return plans;
}

export function mapShortsOpenAIResponse(
  request: CreatorShortsGenerateRequest,
  candidate: unknown,
  model: string
): CreatorShortsGenerateResponse {
  if (!isRecord(candidate)) {
    throw new CreatorAIError("OpenAI returned a non-object JSON payload.", {
      status: 502,
      code: "invalid_openai_response",
    });
  }

  const response = createEmptyShortsResponse(request, model);
  response.viralClips = parseViralClips(request, candidate.viralClips, response.runtimeSeconds);
  response.shortsPlans = parseShortsPlans(candidate.shortsPlans, response.viralClips);

  return response;
}
