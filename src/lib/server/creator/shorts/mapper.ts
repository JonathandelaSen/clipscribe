import { EDITOR_PRESETS } from "../../../creator/editor-presets";
import { toCreatorShortPlan, toCreatorViralClip } from "../../../creator/shorts-compat";
import type { SubtitleChunk } from "../../../history";
import {
  type CreatorShortsGenerateRequest,
  type CreatorShortsGenerateResponse,
  type CreatorSuggestedShort,
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
    shorts: [],
    viralClips: [],
    shortsPlans: [],
    editorPresets: EDITOR_PRESETS,
  };
}

function parseShorts(
  request: CreatorShortsGenerateRequest,
  candidate: unknown,
  runtimeSeconds: number
): CreatorSuggestedShort[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new CreatorAIError("OpenAI did not return any shorts.", {
      status: 502,
      code: "missing_shorts",
    });
  }

  const preset = EDITOR_PRESETS[0];

  return candidate.map((row, index) => {
    if (!isRecord(row)) {
      throw new CreatorAIError("OpenAI returned an invalid short entry.", {
        status: 502,
        code: "invalid_openai_response",
      });
    }

    const startSeconds = readFiniteNumber(row.startSeconds, `shorts[${index}].startSeconds`);
    const endSeconds = readFiniteNumber(row.endSeconds, `shorts[${index}].endSeconds`);
    const score = Math.round(readFiniteNumber(row.score, `shorts[${index}].score`));

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
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `short_${index + 1}`,
      startSeconds,
      endSeconds,
      durationSeconds: Number((endSeconds - startSeconds).toFixed(3)),
      score,
      title: readNonEmptyString(row.title, `shorts[${index}].title`),
      reason: readNonEmptyString(row.reason, `shorts[${index}].reason`),
      caption: readNonEmptyString(row.caption, `shorts[${index}].caption`),
      openingText: readNonEmptyString(row.openingText, `shorts[${index}].openingText`),
      endCardText: readNonEmptyString(row.endCardText, `shorts[${index}].endCardText`),
      sourceChunkIndexes,
      suggestedSubtitleLanguage: "en",
      editorPreset: preset,
    };
  });
}

function normalizeLegacyPayload(candidate: LooseRecord): LooseRecord {
  if (Array.isArray(candidate.shorts)) return candidate;
  if (!Array.isArray(candidate.viralClips) || !Array.isArray(candidate.shortsPlans)) {
    return candidate;
  }

  const clipsById = new Map<string, LooseRecord>();
  for (const clip of candidate.viralClips) {
    if (!isRecord(clip)) continue;
    const id = typeof clip.id === "string" && clip.id.trim() ? clip.id.trim() : "";
    if (!id) continue;
    clipsById.set(id, clip);
  }

  const shorts = candidate.shortsPlans.flatMap((plan, index) => {
    if (!isRecord(plan)) return [];
    const clipId = typeof plan.clipId === "string" ? plan.clipId.trim() : "";
    if (!clipId) return [];
    const clip = clipsById.get(clipId);
    if (!clip) return [];
    return [
      {
        id: typeof plan.id === "string" && plan.id.trim() ? plan.id.trim() : `short_${index + 1}`,
        startSeconds: clip.startSeconds,
        endSeconds: clip.endSeconds,
        score: clip.score,
        title: plan.title,
        reason: clip.reason,
        caption: plan.caption,
        openingText: plan.openingText ?? clip.hook,
        endCardText: plan.endCardText,
      },
    ];
  });

  return {
    ...candidate,
    shorts,
  };
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

  const normalized = normalizeLegacyPayload(candidate);
  const response = createEmptyShortsResponse(request, model);
  response.shorts = parseShorts(request, normalized.shorts, response.runtimeSeconds);
  response.viralClips = response.shorts.map(toCreatorViralClip);
  response.shortsPlans = response.shorts.map(toCreatorShortPlan);

  return response;
}
