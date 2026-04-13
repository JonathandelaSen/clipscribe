import type {
  CreatorShortPlan,
  CreatorSuggestedShort,
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateResponse,
  CreatorVideoInfoProjectRecord,
} from "@/lib/creator/types";
import type { CreatorShortProjectRecord } from "@/lib/creator/storage";
import { makeId } from "@/lib/history";
import type {
  ProjectAssetRecord,
  ProjectExportRecord,
  ProjectYouTubeUploadRecord,
} from "@/lib/projects/types";
import type { YouTubePublishResult, YouTubeUploadDraft } from "@/lib/youtube/types";

export const DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS: CreatorVideoInfoBlock[] = [
  "titleIdeas",
  "description",
  "hashtags",
  "thumbnailHooks",
  "chapters",
  "pinnedComment",
];
export const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;

export type YouTubePublishSourceMode = "local_file" | "project_asset" | "project_export";
export type YouTubePublishView = "list" | "new";
export type YouTubePublishIntent = "short" | "standard";

export interface YouTubePublishDraft {
  title: string;
  description: string;
  tagsInput: string;
}

export interface YouTubeProjectExportOption {
  exportId: string;
  projectId: string;
  outputAssetId: string;
  sourceAssetId?: string;
  shortProjectId?: string;
  displayName: string;
  filename: string;
  createdAt: number;
  kind: ProjectExportRecord["kind"];
  durationSeconds?: number;
  width?: number;
  height?: number;
  short?: CreatorSuggestedShort;
  plan?: CreatorShortPlan;
  file: File;
}

export interface YouTubeProjectAssetOption {
  assetId: string;
  projectId: string;
  filename: string;
  createdAt: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  file: File;
}

export interface YouTubePublishVideoTraits {
  exportKind?: ProjectExportRecord["kind"];
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface YouTubeShortEligibility {
  eligible: boolean;
  isVerticalOrSquare: boolean;
  durationWithinLimit: boolean;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export function buildProjectYouTubeUploadRecord(input: {
  projectId: string;
  sourceMode: YouTubePublishSourceMode;
  publishIntent: YouTubePublishIntent;
  sourceAssetId?: string;
  sourceExportId?: string;
  outputAssetId?: string;
  sourceFilename: string;
  draft: YouTubeUploadDraft;
  result: YouTubePublishResult;
  uploadedAt?: number;
}): ProjectYouTubeUploadRecord {
  return {
    id: makeId("yt_upload"),
    projectId: input.projectId,
    uploadedAt: input.uploadedAt ?? Date.now(),
    videoId: input.result.videoId,
    watchUrl: input.result.watchUrl,
    studioUrl: input.result.studioUrl,
    sourceMode: input.sourceMode,
    sourceAssetId: input.sourceAssetId,
    sourceExportId: input.sourceExportId,
    outputAssetId: input.outputAssetId,
    sourceFilename: input.sourceFilename,
    draft: {
      publishIntent: input.publishIntent,
      title: input.draft.title,
      description: input.draft.description,
      privacyStatus: input.draft.privacyStatus,
      tags: input.draft.tags.slice(),
      categoryId: input.draft.categoryId,
      defaultLanguage: input.draft.defaultLanguage,
      publishAt: input.draft.publishAt,
      recordingDate: input.draft.recordingDate,
      localizations: input.draft.localizations.map((localization) => ({
        locale: localization.locale,
        title: localization.title,
        description: localization.description,
      })),
      relatedVideo: input.draft.relatedVideo
        ? {
            videoId: input.draft.relatedVideo.videoId,
            title: input.draft.relatedVideo.title,
            watchUrl: input.draft.relatedVideo.watchUrl,
            studioUrl: input.draft.relatedVideo.studioUrl,
            privacyStatus: input.draft.relatedVideo.privacyStatus,
            publishedAt: input.draft.relatedVideo.publishedAt,
            thumbnailUrl: input.draft.relatedVideo.thumbnailUrl,
          }
        : undefined,
    },
    result: {
      processingStatus: input.result.processing.processingStatus,
      uploadStatus: input.result.processing.uploadStatus,
      failureReason: input.result.processing.failureReason,
      rejectionReason: input.result.processing.rejectionReason,
      privacyStatus: input.result.processing.privacyStatus,
      thumbnailState: input.result.thumbnail.state,
      captionState: input.result.caption.state,
    },
  };
}

export function resolveYouTubePublishView(input: {
  requestedView?: string | null;
  assetId?: string | null;
  exportId?: string | null;
}): YouTubePublishView {
  if (input.assetId?.trim() || input.exportId?.trim()) {
    return "new";
  }

  return input.requestedView === "new" ? "new" : "list";
}

function normalizeTag(value: string): string {
  return value.replace(/^#+/, "").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractHashtagsFromText(value: string): string[] {
  return Array.from(value.matchAll(/#([\p{L}\p{N}_]+)/gu), (match) => match[1] ?? "");
}

export function buildVideoInfoTagsInput(result: Pick<CreatorVideoInfoGenerateResponse, "youtube">): string {
  return uniqueStrings(result.youtube.hashtags.map(normalizeTag)).join(", ");
}

export function resolveYouTubeShortEligibility(input: YouTubePublishVideoTraits): YouTubeShortEligibility {
  if (input.exportKind === "short") {
    return {
      eligible: true,
      isVerticalOrSquare: true,
      durationWithinLimit: true,
      durationSeconds: input.durationSeconds,
      width: input.width,
      height: input.height,
    };
  }

  const width = Number.isFinite(input.width) ? input.width : undefined;
  const height = Number.isFinite(input.height) ? input.height : undefined;
  const durationSeconds = Number.isFinite(input.durationSeconds) ? input.durationSeconds : undefined;
  const isVerticalOrSquare = Boolean(width && height && height >= width);
  const durationWithinLimit = typeof durationSeconds === "number" && durationSeconds <= YOUTUBE_SHORTS_MAX_DURATION_SECONDS;

  return {
    eligible: isVerticalOrSquare && durationWithinLimit,
    isVerticalOrSquare,
    durationWithinLimit,
    durationSeconds,
    width,
    height,
  };
}

export function inferYouTubePublishIntent(input: YouTubePublishVideoTraits): YouTubePublishIntent {
  return resolveYouTubeShortEligibility(input).eligible ? "short" : "standard";
}

export function applySuggestedTitle(draft: YouTubePublishDraft, title: string): YouTubePublishDraft {
  return {
    ...draft,
    title: title.trim(),
  };
}

export function applySuggestedDescription(draft: YouTubePublishDraft, description: string): YouTubePublishDraft {
  return {
    ...draft,
    description: description.trim(),
  };
}

export function applySuggestedTags(draft: YouTubePublishDraft, result: Pick<CreatorVideoInfoGenerateResponse, "youtube">): YouTubePublishDraft {
  return {
    ...draft,
    tagsInput: buildVideoInfoTagsInput(result),
  };
}

export function buildVideoInfoPublishDraft(
  result: Pick<CreatorVideoInfoGenerateResponse, "youtube">
): YouTubePublishDraft {
  return {
    title: result.youtube.titleIdeas[0]?.trim() ?? "",
    description: result.youtube.description.trim(),
    tagsInput: buildVideoInfoTagsInput(result),
  };
}

export function buildShortSuggestionPublishDraft(input: {
  short?: CreatorSuggestedShort;
  plan?: CreatorShortPlan;
}): YouTubePublishDraft | null {
  const title = input.short?.title?.trim() || input.plan?.title?.trim() || "";
  const description = input.short?.caption?.trim() || input.plan?.caption?.trim() || "";

  if (!title && !description) return null;

  return {
    title,
    description,
    tagsInput: uniqueStrings(extractHashtagsFromText(description).map(normalizeTag)).join(", "),
  };
}

export function appendChapterBlockToDescription(draft: YouTubePublishDraft, chapterText: string): YouTubePublishDraft {
  const trimmedDescription = draft.description.trim();
  const trimmedChapters = chapterText.trim();

  if (!trimmedChapters) return draft;
  if (!trimmedDescription) {
    return {
      ...draft,
      description: trimmedChapters,
    };
  }

  if (trimmedDescription.includes(trimmedChapters)) {
    return draft;
  }

  return {
    ...draft,
    description: `${trimmedDescription}\n\n${trimmedChapters}`,
  };
}

function isEligibleProjectVideoAsset(asset: ProjectAssetRecord): boolean {
  return Boolean(
    asset.fileBlob &&
      (asset.kind === "video" || asset.mimeType.toLocaleLowerCase().startsWith("video/"))
  );
}

export function getEligibleYouTubeProjectAssets(
  assets: ProjectAssetRecord[]
): YouTubeProjectAssetOption[] {
  return assets
    .flatMap((asset) => {
      if (!isEligibleProjectVideoAsset(asset) || !asset.fileBlob) return [];

      return [
        {
          assetId: asset.id,
          projectId: asset.projectId,
          filename: asset.filename,
          createdAt: asset.createdAt,
          durationSeconds: asset.durationSeconds,
          width: asset.width,
          height: asset.height,
          file: asset.fileBlob,
        },
      ];
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function getEligibleYouTubeProjectExports(
  exports: ProjectExportRecord[],
  assetsById: Map<string, ProjectAssetRecord>,
  shortProjectsById: Map<string, CreatorShortProjectRecord> = new Map()
): YouTubeProjectExportOption[] {
  return exports
    .flatMap((record) => {
      if (record.status !== "completed") return [];
      if (!record.outputAssetId) return [];
      const asset = assetsById.get(record.outputAssetId);
      if (!asset?.fileBlob) return [];
      if (asset.kind !== "video") return [];
      const linkedShortProject = record.shortProjectId ? shortProjectsById.get(record.shortProjectId) : undefined;
      const short = record.short ?? linkedShortProject?.short;
      const plan = record.plan ?? linkedShortProject?.plan;

      return [
        {
          exportId: record.id,
          projectId: record.projectId,
          outputAssetId: record.outputAssetId,
          sourceAssetId: record.sourceAssetId ?? linkedShortProject?.sourceAssetId,
          shortProjectId: record.shortProjectId,
          displayName:
            record.kind === "short"
              ? record.shortProjectName?.trim() || linkedShortProject?.name?.trim() || plan?.title?.trim() || short?.title?.trim() || record.filename || asset.filename
              : record.filename || asset.filename,
          filename: record.filename || asset.filename,
          createdAt: record.createdAt,
          kind: record.kind,
          durationSeconds: record.durationSeconds ?? asset.durationSeconds,
          width: record.width ?? asset.width,
          height: record.height ?? asset.height,
          short,
          plan,
          file: asset.fileBlob,
        },
      ];
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function resolveYouTubeShortExportForProjectAsset(input: {
  assetId?: string | null;
  exports: YouTubeProjectExportOption[];
}): YouTubeProjectExportOption | null {
  const assetId = input.assetId?.trim();
  if (!assetId) return null;

  return input.exports.find((record) => record.kind === "short" && record.outputAssetId === assetId) ?? null;
}

export function resolveInitialYouTubePublishSelection(input: {
  projectId?: string | null;
  assetId?: string | null;
  exportId?: string | null;
  availableProjectIds: string[];
  assetOptionsByProjectId: Map<string, YouTubeProjectAssetOption[]>;
  exportOptionsByProjectId: Map<string, YouTubeProjectExportOption[]>;
}): {
  projectId: string;
  assetId: string;
  exportId: string;
  sourceMode: YouTubePublishSourceMode;
} {
  const normalizedProjectId = input.projectId?.trim() ?? "";
  const normalizedAssetId = input.assetId?.trim() ?? "";
  const normalizedExportId = input.exportId?.trim() ?? "";
  const hasProject = normalizedProjectId ? input.availableProjectIds.includes(normalizedProjectId) : false;
  const projectId = hasProject ? normalizedProjectId : "";

  const projectAssetOptions =
    (projectId ? input.assetOptionsByProjectId.get(projectId) : undefined) ??
    [];
  const projectExportOptions =
    (projectId ? input.exportOptionsByProjectId.get(projectId) : undefined) ??
    [];
  const hasRequestedAsset = normalizedAssetId
    ? projectAssetOptions.some((option) => option.assetId === normalizedAssetId)
    : false;
  const hasRequestedExport = normalizedExportId
    ? projectExportOptions.some((option) => option.exportId === normalizedExportId)
    : false;

  return {
    projectId,
    assetId: hasRequestedAsset ? normalizedAssetId : "",
    exportId: hasRequestedAsset ? "" : hasRequestedExport ? normalizedExportId : "",
    sourceMode: hasRequestedAsset ? "project_asset" : hasRequestedExport ? "project_export" : "local_file",
  };
}

export function resolveMatchingVideoInfoRecord(input: {
  history: CreatorVideoInfoProjectRecord[];
  sourceAssetId?: string | null;
}): CreatorVideoInfoProjectRecord | null {
  const sourceAssetId = input.sourceAssetId?.trim();
  if (!sourceAssetId) return null;

  const matches = input.history.filter((record) => record.sourceAssetId === sourceAssetId);
  if (matches.length === 0) return null;

  return [...matches].sort((left, right) => right.generatedAt - left.generatedAt)[0] ?? null;
}
