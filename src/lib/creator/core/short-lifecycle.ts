import type { CreatorShortRenderResponse, CreatorShortPlan, CreatorViralClip, CreatorShortEditorState } from "@/lib/creator/types";
import type { CreatorShortExportRecord, CreatorShortProjectRecord } from "@/lib/creator/storage";

function platformLabel(platform: CreatorShortPlan["platform"]): string {
  if (platform === "youtube_shorts") return "YouTube Shorts";
  if (platform === "instagram_reels") return "Instagram Reels";
  return "TikTok";
}

export function deriveDefaultShortProjectName(plan: CreatorShortPlan, clip: CreatorViralClip, secondsToClock: (seconds: number) => string): string {
  return `${platformLabel(plan.platform)} • ${secondsToClock(clip.startSeconds)}-${secondsToClock(clip.endSeconds)}`;
}

export function findExistingShortProjectRecord(
  records: CreatorShortProjectRecord[],
  options: {
    explicitId?: string;
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
  secondsToClock: (seconds: number) => string;
}): CreatorShortProjectRecord {
  const existing = findExistingShortProjectRecord(input.savedRecords, {
    explicitId: input.explicitId,
    projectId: input.projectId,
    transcriptId: input.transcriptId,
    subtitleId: input.subtitleId,
    clipId: input.clip.id,
    planId: input.plan.id,
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
    platform: input.plan.platform,
    name:
      (input.explicitName || "").trim() ||
      existing?.name ||
      deriveDefaultShortProjectName(input.plan, input.clip, input.secondsToClock),
    clip: input.clip,
    plan: input.plan,
    editor: input.editor,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
    status: input.status,
    lastExportId: input.lastExportId ?? existing?.lastExportId,
    lastError: input.lastError,
  };
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
    platform: input.plan.platform,
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
      platform: input.plan.platform,
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
