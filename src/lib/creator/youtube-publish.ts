import type { CreatorVideoInfoBlock, CreatorVideoInfoGenerateResponse } from "@/lib/creator/types";
import type { ProjectAssetRecord, ProjectExportRecord } from "@/lib/projects/types";

export const DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS: CreatorVideoInfoBlock[] = [
  "titleIdeas",
  "description",
  "hashtagsSeo",
  "thumbnailHooks",
  "chapters",
  "pinnedComment",
];

export type YouTubePublishSourceMode = "local_file" | "project_export";

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
  return uniqueStrings([
    ...result.youtube.hashtags.map(normalizeTag),
    ...result.youtube.seoKeywords.map((keyword) => keyword.trim()),
  ]).join(", ");
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
  exportId?: string | null;
  availableProjectIds: string[];
  exportOptionsByProjectId: Map<string, YouTubeProjectExportOption[]>;
}): {
  projectId: string;
  exportId: string;
  sourceMode: YouTubePublishSourceMode;
} {
  const normalizedProjectId = input.projectId?.trim() ?? "";
  const normalizedExportId = input.exportId?.trim() ?? "";
  const hasProject = normalizedProjectId ? input.availableProjectIds.includes(normalizedProjectId) : false;
  const projectId = hasProject ? normalizedProjectId : "";

  const projectExportOptions =
    (projectId ? input.exportOptionsByProjectId.get(projectId) : undefined) ??
    [];
  const hasRequestedExport = normalizedExportId
    ? projectExportOptions.some((option) => option.exportId === normalizedExportId)
    : false;

  return {
    projectId,
    exportId: hasRequestedExport ? normalizedExportId : "",
    sourceMode: hasRequestedExport ? "project_export" : "local_file",
  };
}
