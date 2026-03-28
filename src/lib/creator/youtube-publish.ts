import type { CreatorVideoInfoBlock, CreatorVideoInfoGenerateResponse } from "@/lib/creator/types";
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

export type YouTubePublishSourceMode = "local_file" | "project_asset" | "project_export";
export type YouTubePublishView = "list" | "new";

export interface YouTubePublishDraft {
  title: string;
  description: string;
  tagsInput: string;
}

export interface YouTubeProjectExportOption {
  exportId: string;
  projectId: string;
  outputAssetId: string;
  filename: string;
  createdAt: number;
  kind: ProjectExportRecord["kind"];
  file: File;
}

export interface YouTubeProjectAssetOption {
  assetId: string;
  projectId: string;
  filename: string;
  createdAt: number;
  file: File;
}

export function buildProjectYouTubeUploadRecord(input: {
  projectId: string;
  sourceMode: YouTubePublishSourceMode;
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

export function buildVideoInfoTagsInput(result: Pick<CreatorVideoInfoGenerateResponse, "youtube">): string {
  return uniqueStrings(result.youtube.hashtags.map(normalizeTag)).join(", ");
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
          file: asset.fileBlob,
        },
      ];
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function getEligibleYouTubeProjectExports(
  exports: ProjectExportRecord[],
  assetsById: Map<string, ProjectAssetRecord>
): YouTubeProjectExportOption[] {
  return exports
    .flatMap((record) => {
      if (record.status !== "completed") return [];
      if (!record.outputAssetId) return [];
      const asset = assetsById.get(record.outputAssetId);
      if (!asset?.fileBlob) return [];
      if (asset.kind !== "video") return [];

      return [
        {
          exportId: record.id,
          projectId: record.projectId,
          outputAssetId: record.outputAssetId,
          filename: record.filename || asset.filename,
          createdAt: record.createdAt,
          kind: record.kind,
          file: asset.fileBlob,
        },
      ];
    })
    .sort((left, right) => right.createdAt - left.createdAt);
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
