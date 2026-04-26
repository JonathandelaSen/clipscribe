import type {
  CreatorShortPlan,
  CreatorSuggestedShort,
  CreatorViralClip,
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateResponse,
  CreatorVideoInfoProjectRecord,
  CreatorVideoInfoPromptProfile,
} from "@/lib/creator/types";
import type { CreatorShortProjectRecord } from "@/lib/creator/storage";
import { getSubtitleById, makeId, type SubtitleChunk, type TranscriptVersion } from "@/lib/history";
import { clipSubtitleChunks } from "@/lib/creator/core/clip-windowing";
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
export const YOUTUBE_SHORT_PUBLISH_VIDEO_INFO_BLOCKS: CreatorVideoInfoBlock[] = [
  "titleIdeas",
  "description",
  "hashtags",
];
export const YOUTUBE_SHORTS_MAX_DURATION_SECONDS = 180;
export const YOUTUBE_SHORT_PUBLISH_CONTEXT_MAX_CHARS = 60_000;

export const YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS = {
  global:
    "Create metadata for the YouTube Short being published. Use the full video transcript only as context; do not make the title, description, or tags describe the full source video.",
  titleIdeas:
    "Return short, clear YouTube Shorts titles. Make the hook understandable without clickbait, and avoid implying the full source video is being published.",
  description:
    "Write a concise YouTube Shorts description grounded in the Short. Add a natural CTA only if it fits the content.",
  hashtags:
    "Return relevant YouTube tags or hashtags for the Short. Avoid invented brands, names, claims, or unrelated trend tags.",
} as const;

export type YouTubePublishSourceMode = "local_file" | "project_asset" | "project_export";
export type YouTubePublishView = "list" | "new";
export type YouTubePublishIntent = "short" | "standard";

export interface YouTubePublishDraft {
  title: string;
  description: string;
  tagsInput: string;
}

export interface YouTubeShortPublishPromptInstructionDraft {
  globalInstructions: string;
  titleInstructions: string;
  descriptionInstructions: string;
  tagsInstructions: string;
}

export interface YouTubeShortPublishTranscriptContext {
  transcriptId: string;
  subtitleId?: string;
  transcriptVersionLabel?: string;
  subtitleVersionLabel?: string;
  shortTranscriptText: string;
  shortTranscriptChunks: SubtitleChunk[];
  fullTranscriptText?: string;
  fullTranscriptChunks?: SubtitleChunk[];
  contextTranscriptTruncated: boolean;
  warning?: string;
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

function chunksToText(chunks: SubtitleChunk[]): string {
  return chunks.map((chunk) => String(chunk.text ?? "").trim()).filter(Boolean).join(" ");
}

function chunkTextLength(chunks: SubtitleChunk[]): number {
  return chunks.reduce((total, chunk) => total + String(chunk.text ?? "").trim().length + 1, 0);
}

function getClipWindow(input: {
  short?: CreatorSuggestedShort | null;
  clip?: CreatorViralClip | null;
}): CreatorSuggestedShort | CreatorViralClip | null {
  return input.short ?? input.clip ?? null;
}

function selectContextChunksAroundClip(input: {
  chunks: SubtitleChunk[];
  clip?: CreatorSuggestedShort | CreatorViralClip | null;
  maxChars?: number;
}): { chunks: SubtitleChunk[]; truncated: boolean } {
  const maxChars = input.maxChars ?? YOUTUBE_SHORT_PUBLISH_CONTEXT_MAX_CHARS;
  if (chunkTextLength(input.chunks) <= maxChars) {
    return { chunks: input.chunks, truncated: false };
  }

  const clip = input.clip;
  if (!clip) {
    const selected: SubtitleChunk[] = [];
    let chars = 0;
    for (const chunk of input.chunks) {
      const nextChars = String(chunk.text ?? "").trim().length + 1;
      if (selected.length > 0 && chars + nextChars > maxChars) break;
      selected.push(chunk);
      chars += nextChars;
    }
    return { chunks: selected, truncated: true };
  }

  const overlappingIndexes = input.chunks.flatMap((chunk, index) => {
    const start = chunk.timestamp?.[0] ?? 0;
    const end = chunk.timestamp?.[1] ?? start;
    return start < clip.endSeconds && end > clip.startSeconds ? [index] : [];
  });
  if (overlappingIndexes.length === 0) {
    return selectContextChunksAroundClip({ chunks: input.chunks, maxChars });
  }

  let left = Math.min(...overlappingIndexes);
  let right = Math.max(...overlappingIndexes);
  let selectedChars = chunkTextLength(input.chunks.slice(left, right + 1));

  while (selectedChars < maxChars && (left > 0 || right < input.chunks.length - 1)) {
    const leftChunk = left > 0 ? input.chunks[left - 1] : undefined;
    const rightChunk = right < input.chunks.length - 1 ? input.chunks[right + 1] : undefined;
    const leftChars = leftChunk ? String(leftChunk.text ?? "").trim().length + 1 : Number.POSITIVE_INFINITY;
    const rightChars = rightChunk ? String(rightChunk.text ?? "").trim().length + 1 : Number.POSITIVE_INFINITY;
    const preferLeft = leftChars <= rightChars;
    const nextChars = preferLeft ? leftChars : rightChars;

    if (!Number.isFinite(nextChars) || selectedChars + nextChars > maxChars) break;
    if (preferLeft) {
      left -= 1;
    } else {
      right += 1;
    }
    selectedChars += nextChars;
  }

  return {
    chunks: input.chunks.slice(left, right + 1),
    truncated: true,
  };
}

export function buildYouTubeShortPublishPromptProfile(
  instructions: Partial<YouTubeShortPublishPromptInstructionDraft> = {}
): CreatorVideoInfoPromptProfile {
  const globalInstructions =
    instructions.globalInstructions?.trim() || YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.global;
  const titleInstructions =
    instructions.titleInstructions?.trim() || YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.titleIdeas;
  const descriptionInstructions =
    instructions.descriptionInstructions?.trim() || YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.description;
  const tagsInstructions =
    instructions.tagsInstructions?.trim() || YOUTUBE_SHORT_PUBLISH_PROMPT_DEFAULTS.hashtags;

  return {
    globalInstructions,
    fieldInstructions: {
      titleIdeas: titleInstructions,
      description: descriptionInstructions,
      hashtags: tagsInstructions,
    },
  };
}

export function resolveYouTubeShortPublishTranscriptContext(input: {
  transcript?: TranscriptVersion | null;
  short?: CreatorSuggestedShort | null;
  clip?: CreatorViralClip | null;
  subtitleId?: string | null;
  maxContextChars?: number;
}): YouTubeShortPublishTranscriptContext | null {
  const transcript = input.transcript;
  if (!transcript) return null;

  const subtitle = getSubtitleById(transcript, input.subtitleId);
  const fullChunks = transcript.chunks?.length ? transcript.chunks : subtitle?.chunks ?? [];
  const subtitleChunks = subtitle?.chunks?.length ? subtitle.chunks : fullChunks;
  const clip = getClipWindow(input);
  const shortTranscriptChunks = clip ? clipSubtitleChunks(clip, subtitleChunks) : subtitleChunks;

  if (shortTranscriptChunks.length === 0) {
    return null;
  }

  const selectedContext = fullChunks.length
    ? selectContextChunksAroundClip({
        chunks: fullChunks,
        clip,
        maxChars: input.maxContextChars,
      })
    : { chunks: [], truncated: false };
  const fullTranscriptText = chunksToText(selectedContext.chunks);

  return {
    transcriptId: transcript.id,
    subtitleId: subtitle?.id,
    transcriptVersionLabel: transcript.label,
    subtitleVersionLabel: subtitle?.label,
    shortTranscriptText: chunksToText(shortTranscriptChunks),
    shortTranscriptChunks,
    fullTranscriptText: fullTranscriptText || undefined,
    fullTranscriptChunks: selectedContext.chunks.length ? selectedContext.chunks : undefined,
    contextTranscriptTruncated: selectedContext.truncated,
    warning: selectedContext.chunks.length
      ? undefined
      : "Full source transcript context is unavailable; metadata will be based on the Short transcript only.",
  };
}

export function buildVideoInfoTagsInput(result: Pick<CreatorVideoInfoGenerateResponse, "youtube">): string {
  return uniqueStrings(result.youtube.hashtags.map(normalizeTag)).join(", ");
}

export function resolveYouTubeShortEligibility(input: YouTubePublishVideoTraits): YouTubeShortEligibility {
  const width = Number.isFinite(input.width) ? input.width : undefined;
  const height = Number.isFinite(input.height) ? input.height : undefined;
  const durationSeconds = Number.isFinite(input.durationSeconds) ? input.durationSeconds : undefined;
  const isShortExport = input.exportKind === "short";
  const isVerticalOrSquare = width && height ? height >= width : isShortExport;
  const durationWithinLimit =
    typeof durationSeconds === "number" ? durationSeconds <= YOUTUBE_SHORTS_MAX_DURATION_SECONDS : isShortExport;

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
