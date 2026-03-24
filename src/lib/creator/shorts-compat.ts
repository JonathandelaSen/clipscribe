import type {
  CreatorShortPlan,
  CreatorSuggestedShort,
  CreatorViralClip,
} from "@/lib/creator/types";

export function toCreatorViralClip(short: CreatorSuggestedShort): CreatorViralClip {
  return {
    id: short.id,
    startSeconds: short.startSeconds,
    endSeconds: short.endSeconds,
    durationSeconds: short.durationSeconds,
    score: short.score,
    title: short.title,
    hook: short.openingText,
    reason: short.reason,
    punchline: short.endCardText,
    sourceChunkIndexes: short.sourceChunkIndexes,
    suggestedSubtitleLanguage: short.suggestedSubtitleLanguage,
  };
}

export function toCreatorShortPlan(short: CreatorSuggestedShort): CreatorShortPlan {
  return {
    id: short.id,
    clipId: short.id,
    title: short.title,
    caption: short.caption,
    openingText: short.openingText,
    endCardText: short.endCardText,
    editorPreset: short.editorPreset,
  };
}

export function resolveCreatorSuggestedShort(input: {
  short?: CreatorSuggestedShort;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
}): CreatorSuggestedShort {
  if (input.short) return input.short;
  if (!input.clip || !input.plan) {
    throw new Error("A short or clip+plan pair is required.");
  }

  return {
    id: input.plan.id || input.clip.id,
    startSeconds: input.clip.startSeconds,
    endSeconds: input.clip.endSeconds,
    durationSeconds: input.clip.durationSeconds,
    score: input.clip.score,
    title: input.plan.title || input.clip.title,
    reason: input.clip.reason,
    caption: input.plan.caption,
    openingText: input.plan.openingText || input.clip.hook,
    endCardText: input.plan.endCardText,
    sourceChunkIndexes: input.clip.sourceChunkIndexes,
    suggestedSubtitleLanguage: input.clip.suggestedSubtitleLanguage,
    editorPreset: input.plan.editorPreset,
  };
}
