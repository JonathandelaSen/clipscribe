import type {
  CreatorShortRenderResponse,
  CreatorShortPlan,
  CreatorShortsGenerateRequest,
  CreatorShortsGenerateResponse,
  CreatorViralClip,
  CreatorShortEditorState,
} from "@/lib/creator/types";
import type {
  CreatorAISuggestionInputSummary,
  CreatorShortExportRecord,
  CreatorShortProjectOrigin,
  CreatorShortProjectRecord,
} from "@/lib/creator/storage";
import { hydrateCreatorShortEditorState } from "./text-overlays";


export function deriveDefaultShortProjectName(
  plan: CreatorShortPlan,
  clip: CreatorViralClip,
  secondsToClock: (seconds: number) => string
): string {
  return `Short Cut • ${secondsToClock(clip.startSeconds)}-${secondsToClock(clip.endSeconds)}`;
}

export function deriveDefaultAiSuggestionName(
  plan: CreatorShortPlan,
  clip: CreatorViralClip,
  secondsToClock: (seconds: number) => string
): string {
  return `AI Suggestion • ${secondsToClock(clip.startSeconds)}-${secondsToClock(clip.endSeconds)}`;
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
    clipId: string;
    planId: string;
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
      record.clipId === options.clipId &&
      record.planId === options.planId
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
  clip: CreatorViralClip;
  plan: CreatorShortPlan;
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
  const origin = input.origin ?? "manual";
  const existing = findExistingShortProjectRecord(input.savedRecords, {
    explicitId: input.explicitId,
    origin,
    suggestionGenerationId: input.suggestionGenerationId,
    projectId: input.projectId,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    clipId: input.clip.id,
    planId: input.plan.id,
  });
  const hydratedEditor = hydrateCreatorShortEditorState(input.editor, {
    origin,
    plan: input.plan,
    clipDurationSeconds: input.clip.durationSeconds,
  });

  return {
    id: existing?.id ?? input.newId,
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    sourceFilename: input.sourceFilename,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    clipId: input.clip.id,
    planId: input.plan.id,
    name:
      (input.explicitName || "").trim() ||
      existing?.name ||
      (origin === "ai_suggestion"
        ? deriveDefaultAiSuggestionName(input.plan, input.clip, input.secondsToClock)
        : deriveDefaultShortProjectName(input.plan, input.clip, input.secondsToClock)),
    clip: input.clip,
    plan: input.plan,
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
  const clipsById = new Map(input.analysis.viralClips.map((clip) => [clip.id, clip]));

  return input.analysis.shortsPlans.flatMap((plan) => {
    const clip = clipsById.get(plan.clipId);
    if (!clip) return [];

    return [
      buildShortProjectRecord({
        status: "draft",
        now: input.now,
        newId: input.newId(),
        projectId: input.projectId,
        sourceAssetId: input.sourceAssetId,
        sourceFilename: input.sourceFilename,
        transcriptId: input.transcriptId,
        subtitleId: input.subtitleId,
        clip,
        plan,
        editor: input.editor,
        savedRecords: input.savedRecords,
        explicitName: deriveDefaultAiSuggestionName(plan, clip, input.secondsToClock),
        origin: "ai_suggestion",
        suggestionGenerationId: input.generationId,
        suggestionGeneratedAt: input.now,
        suggestionSourceSignature: input.sourceSignature,
        suggestionInputSummary: input.inputSummary,
        secondsToClock: input.secondsToClock,
      }),
    ];
  });
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
  plan: CreatorShortPlan;
  clip: CreatorViralClip;
  editor: CreatorShortEditorState;
  createdAt: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  fileBlob?: Blob;
  debugFfmpegCommand?: string[];
  debugNotes?: string[];
}): CreatorShortExportRecord {
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
    clip: input.clip,
    plan: input.plan,
    editor: input.editor,
  };
}

export function buildLocalBrowserRenderResponse(input: {
  jobId: string;
  createdAt: number;
  plan: CreatorShortPlan;
  filename: string;
  subtitleBurnedIn: boolean;
  ffmpegCommandPreview: string[];
  notes: string[];
}): CreatorShortRenderResponse {
  return {
    ok: true,
    providerMode: "local-browser",
    jobId: input.jobId,
    status: "completed",
    createdAt: input.createdAt,
    estimatedSeconds: 0,
    output: {

      filename: input.filename,
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleBurnedIn: input.subtitleBurnedIn,
    },
    debugPreview: {
      ffmpegCommandPreview: input.ffmpegCommandPreview,
      notes: input.notes,
    },
  };
}
