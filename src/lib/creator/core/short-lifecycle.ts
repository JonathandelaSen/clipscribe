import type {
  CreatorShortPlan,
  CreatorSuggestedShort,
  CreatorShortsGenerateRequest,
  CreatorShortsGenerateResponse,
  CreatorShortEditorState,
  CreatorViralClip,
} from "@/lib/creator/types";
import { buildCompletedCreatorShortRenderResponse } from "../system-export-contract";
import type {
  CreatorAISuggestionInputSummary,
  CreatorShortExportRecord,
  CreatorShortProjectOrigin,
  CreatorShortProjectRecord,
} from "@/lib/creator/storage";
import { resolveCreatorSuggestedShort, toCreatorShortPlan, toCreatorViralClip } from "../shorts-compat";
import { hydrateCreatorShortEditorState } from "./text-overlays";

function normalizeShortArgs(
  shortOrPlan: CreatorSuggestedShort | CreatorShortPlan,
  clipOrSecondsToClock: CreatorViralClip | ((seconds: number) => string),
  maybeSecondsToClock?: (seconds: number) => string
): { short: CreatorSuggestedShort; secondsToClock: (seconds: number) => string } {
  if (typeof clipOrSecondsToClock === "function") {
    return {
      short: shortOrPlan as CreatorSuggestedShort,
      secondsToClock: clipOrSecondsToClock,
    };
  }

  return {
    short: resolveCreatorSuggestedShort({
      clip: clipOrSecondsToClock,
      plan: shortOrPlan as CreatorShortPlan,
    }),
    secondsToClock: maybeSecondsToClock as (seconds: number) => string,
  };
}

export function deriveDefaultShortProjectName(
  shortOrPlan: CreatorSuggestedShort | CreatorShortPlan,
  clipOrSecondsToClock: CreatorViralClip | ((seconds: number) => string),
  maybeSecondsToClock?: (seconds: number) => string
): string {
  const { short, secondsToClock } = normalizeShortArgs(shortOrPlan, clipOrSecondsToClock, maybeSecondsToClock);
  return `Short Cut • ${secondsToClock(short.startSeconds)}-${secondsToClock(short.endSeconds)}`;
}

export function deriveDefaultAiSuggestionName(
  shortOrPlan: CreatorSuggestedShort | CreatorShortPlan,
  clipOrSecondsToClock: CreatorViralClip | ((seconds: number) => string),
  maybeSecondsToClock?: (seconds: number) => string
): string {
  const { short, secondsToClock } = normalizeShortArgs(shortOrPlan, clipOrSecondsToClock, maybeSecondsToClock);
  return `AI Suggestion • ${secondsToClock(short.startSeconds)}-${secondsToClock(short.endSeconds)}`;
}

export function findExistingShortProjectRecord(
  records: CreatorShortProjectRecord[],
  options: {
    explicitId?: string;
    origin?: CreatorShortProjectOrigin;
    suggestionGenerationId?: string;
    projectId: string;
    transcriptId: string;
    subtitleId: string;
    shortId: string;
  }
): CreatorShortProjectRecord | undefined {
  if (options.explicitId) {
    const byId = records.find((record) => record.id === options.explicitId);
    if (byId) return byId;
  }

  return records.find(
    (record) =>
      (options.origin == null || record.origin === options.origin) &&
      (options.suggestionGenerationId == null || record.suggestionGenerationId === options.suggestionGenerationId) &&
      record.projectId === options.projectId &&
      record.transcriptId === options.transcriptId &&
      record.subtitleId === options.subtitleId &&
      record.shortId === options.shortId
  );
}

export function buildShortProjectRecord(input: {
  status: CreatorShortProjectRecord["status"];
  now: number;
  newId: string;
  projectId: string;
  sourceAssetId: string;
  sourceFilename: string;
  transcriptId: string;
  subtitleId: string;
  short?: CreatorSuggestedShort;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  editor: CreatorShortEditorState;
  savedRecords: CreatorShortProjectRecord[];
  explicitId?: string;
  explicitName?: string;
  lastExportId?: string;
  lastError?: string;
  origin?: CreatorShortProjectOrigin;
  suggestionGenerationId?: string;
  suggestionGeneratedAt?: number;
  suggestionSourceSignature?: string;
  suggestionInputSummary?: CreatorAISuggestionInputSummary;
  secondsToClock: (seconds: number) => string;
}): CreatorShortProjectRecord {
  const short = resolveCreatorSuggestedShort({
    short: input.short,
    clip: input.clip,
    plan: input.plan,
  });
  const clip = toCreatorViralClip(short);
  const plan = toCreatorShortPlan(short);
  const origin = input.origin ?? "manual";
  const existing = findExistingShortProjectRecord(input.savedRecords, {
    explicitId: input.explicitId,
    origin,
    suggestionGenerationId: input.suggestionGenerationId,
    projectId: input.projectId,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    shortId: short.id,
  });
  const hydratedEditor = hydrateCreatorShortEditorState(input.editor, {
    origin,
    short,
    clipDurationSeconds: short.durationSeconds,
  });

  return {
    id: existing?.id ?? input.newId,
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    sourceFilename: input.sourceFilename,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    clipId: clip.id,
    planId: plan.id,
    shortId: short.id,
    name:
      (input.explicitName || "").trim() ||
      existing?.name ||
      (origin === "ai_suggestion"
        ? deriveDefaultAiSuggestionName(short, input.secondsToClock)
        : deriveDefaultShortProjectName(short, input.secondsToClock)),
    clip,
    plan,
    short,
    editor: hydratedEditor,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
    status: input.status,
    origin,
    lastExportId: input.lastExportId ?? existing?.lastExportId,
    lastError: input.lastError,
    suggestionGenerationId: origin === "ai_suggestion" ? input.suggestionGenerationId : undefined,
    suggestionGeneratedAt: origin === "ai_suggestion" ? input.suggestionGeneratedAt ?? input.now : undefined,
    suggestionSourceSignature: origin === "ai_suggestion" ? input.suggestionSourceSignature : undefined,
    suggestionInputSummary: origin === "ai_suggestion" ? input.suggestionInputSummary : undefined,
  };
}

export function shouldReuseShortProjectId(
  project?: Pick<CreatorShortProjectRecord, "origin" | "id"> | null
): string | undefined {
  if (!project || project.origin !== "manual") return undefined;
  return project.id;
}

function normalizeSuggestionField(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function buildAiSuggestionSourceSignature(input: {
  projectId: string;
  sourceAssetId: string;
  transcriptId: string;
  subtitleId: string;
  niche?: string;
  audience?: string;
  tone?: string;
}): string {
  return JSON.stringify({
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    niche: normalizeSuggestionField(input.niche),
    audience: normalizeSuggestionField(input.audience),
    tone: normalizeSuggestionField(input.tone),
  });
}

export function buildAiSuggestionInputSummary(input: {
  request: Pick<
    CreatorShortsGenerateRequest,
    "niche" | "audience" | "tone" | "transcriptVersionLabel" | "subtitleVersionLabel"
  >;
  transcriptId: string;
  subtitleId: string;
  model?: string;
}): CreatorAISuggestionInputSummary {
  return {
    niche: (input.request.niche || "").trim(),
    audience: (input.request.audience || "").trim(),
    tone: (input.request.tone || "").trim(),
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    transcriptVersionLabel: input.request.transcriptVersionLabel,
    subtitleVersionLabel: input.request.subtitleVersionLabel,
    model: input.model,
  };
}

export function buildAiSuggestionProjectRecords(input: {
  analysis: CreatorShortsGenerateResponse;
  now: number;
  generationId: string;
  projectId: string;
  sourceAssetId: string;
  sourceFilename: string;
  transcriptId: string;
  subtitleId: string;
  sourceSignature: string;
  inputSummary: CreatorAISuggestionInputSummary;
  editor: CreatorShortEditorState;
  savedRecords: CreatorShortProjectRecord[];
  newId: () => string;
  secondsToClock: (seconds: number) => string;
}): CreatorShortProjectRecord[] {
  const normalizedShorts =
    input.analysis.shorts ??
    input.analysis.viralClips.flatMap((clip, index) => {
      const plan = input.analysis.shortsPlans[index];
      if (!plan) return [];
      return [resolveCreatorSuggestedShort({ clip, plan })];
    });

  return normalizedShorts.map((short) =>
    buildShortProjectRecord({
      status: "draft",
      now: input.now,
      newId: input.newId(),
      projectId: input.projectId,
      sourceAssetId: input.sourceAssetId,
      sourceFilename: input.sourceFilename,
      transcriptId: input.transcriptId,
      subtitleId: input.subtitleId,
      short,
      editor: input.editor,
      savedRecords: input.savedRecords,
      explicitName: deriveDefaultAiSuggestionName(short, input.secondsToClock),
      origin: "ai_suggestion",
      suggestionGenerationId: input.generationId,
      suggestionGeneratedAt: input.now,
      suggestionSourceSignature: input.sourceSignature,
      suggestionInputSummary: input.inputSummary,
      secondsToClock: input.secondsToClock,
    })
  );
}

export function markShortProjectExported(
  project: CreatorShortProjectRecord,
  options: { now: number; exportId: string }
): CreatorShortProjectRecord {
  return {
    ...project,
    status: "exported",
    updatedAt: options.now,
    lastExportId: options.exportId,
    lastError: undefined,
  };
}

export function markShortProjectFailed(
  project: CreatorShortProjectRecord,
  options: { now: number; error: string }
): CreatorShortProjectRecord {
  return {
    ...project,
    status: "error",
    updatedAt: options.now,
    lastError: options.error,
  };
}

export function restoreShortProjectAfterCanceledExport(
  project: CreatorShortProjectRecord,
  options: {
    now: number;
    previousProject?: Pick<CreatorShortProjectRecord, "status" | "lastExportId" | "lastError"> | null;
  }
): CreatorShortProjectRecord {
  const previousStatus = options.previousProject?.status;
  return {
    ...project,
    status: previousStatus && previousStatus !== "exporting" ? previousStatus : "draft",
    updatedAt: options.now,
    lastExportId: options.previousProject?.lastExportId,
    lastError: options.previousProject?.lastError,
  };
}

export function buildCompletedShortExportRecord(input: {
  id: string;
  shortProjectId: string;
  projectId: string;
  sourceAssetId?: string;
  outputAssetId?: string;
  sourceFilename: string;
  short?: CreatorSuggestedShort;
  editor: CreatorShortEditorState;
  createdAt: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  fileBlob?: Blob;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
  renderModeUsed?: "fast_ass" | "png_parity";
  encoderUsed?: string;
  timingsMs?: CreatorShortExportRecord["timingsMs"];
  counts?: CreatorShortExportRecord["counts"];
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
}): CreatorShortExportRecord {
  const short = resolveCreatorSuggestedShort({
    short: input.short,
    clip: input.clip,
    plan: input.plan,
  });
  return {
    id: input.id,
    shortProjectId: input.shortProjectId,
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    outputAssetId: input.outputAssetId,
    sourceFilename: input.sourceFilename,
    createdAt: input.createdAt,
    status: "completed",
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    fileBlob: input.fileBlob,
    debugFfmpegCommand: input.debugFfmpegCommand,
    debugNotes: input.debugNotes,
    renderModeUsed: input.renderModeUsed,
    encoderUsed: input.encoderUsed,
    timingsMs: input.timingsMs,
    counts: input.counts,
    clip: toCreatorViralClip(short),
    plan: toCreatorShortPlan(short),
    short,
    editor: input.editor,
  };
}

export function buildLocalBrowserRenderResponse(input: {
  jobId: string;
  createdAt: number;
  short?: CreatorSuggestedShort;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  filename: string;
  subtitleBurnedIn: boolean;
  ffmpegCommandPreview: string[];
  notes: string[];
  renderModeUsed?: "fast_ass" | "png_parity";
  encoderUsed?: string;
  timingsMs?: CreatorShortExportRecord["timingsMs"];
  counts?: CreatorShortExportRecord["counts"];
}) {
  return buildCompletedCreatorShortRenderResponse({
    providerMode: "local-browser",
    jobId: input.jobId,
    createdAt: input.createdAt,
    filename: input.filename,
    subtitleBurnedIn: input.subtitleBurnedIn,
    ffmpegCommandPreview: input.ffmpegCommandPreview,
    notes: input.notes,
    renderModeUsed: input.renderModeUsed,
    encoderUsed: input.encoderUsed,
    timingsMs: input.timingsMs,
    counts: input.counts,
  });
}
