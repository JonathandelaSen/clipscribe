import type { SubtitleChunk } from "@/lib/history";

export type CreatorAIProviderMode = "mock" | "openai";
export type CreatorLLMFeature = "shorts" | "video_info";
export type CreatorLLMProvider = "openai";
export type CreatorLLMOperation = "generate_shorts" | "generate_video_info";
export type CreatorLLMRunStatus = "success" | "provider_error" | "parse_error" | "validation_error";
export type CreatorLLMRedactionState = "raw" | "purged";


export type CreatorVideoInfoBlock =
  | "titleIdeas"
  | "description"
  | "pinnedComment"
  | "hashtagsSeo"
  | "thumbnailHooks"
  | "chapters"
  | "contentPack"
  | "insights";

export interface CreatorGenerationSourceInput {
  projectId?: string;
  sourceAssetId?: string;
  transcriptId?: string;
  subtitleId?: string;
  sourceSignature?: string;
  transcriptText: string;
  transcriptChunks: SubtitleChunk[];
  subtitleChunks?: SubtitleChunk[];
  transcriptVersionLabel?: string;
  subtitleVersionLabel?: string;
}

export interface CreatorLLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CreatorLLMRunInputSummary {
  projectId?: string;
  sourceAssetId?: string;
  transcriptId?: string;
  subtitleId?: string;
  sourceSignature?: string;
  transcriptVersionLabel?: string;
  subtitleVersionLabel?: string;
  transcriptCharCount: number;
  transcriptChunkCount: number;
  subtitleChunkCount: number;
  niche?: string;
  audience?: string;
  tone?: string;
  videoInfoBlocks?: CreatorVideoInfoBlock[];
}

export interface CreatorLLMRunRecord {
  id: string;
  feature: CreatorLLMFeature;
  provider: CreatorLLMProvider;
  operation: CreatorLLMOperation;
  model: string;
  projectId?: string;
  sourceAssetId?: string;
  sourceSignature?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  fetchDurationMs?: number;
  parseDurationMs?: number;
  status: CreatorLLMRunStatus;
  temperature: number;
  requestFingerprint: string;
  promptVersion: string;
  inputSummary: CreatorLLMRunInputSummary;
  usage?: CreatorLLMUsage;
  estimatedCostUsd?: number | null;
  requestPayloadRaw: unknown | null;
  responsePayloadRaw: unknown | null;
  parsedOutputSnapshot: unknown | null;
  errorCode?: string;
  errorMessage?: string;
  redactionState: CreatorLLMRedactionState;
  exportable: boolean;
  containsRawPayload: boolean;
}

export interface CreatorTracedResult<TResponse> {
  response: TResponse;
  llmRun?: CreatorLLMRunRecord;
}

export interface CreatorShortsGenerateRequest extends CreatorGenerationSourceInput {
  niche?: string;
  audience?: string;
  tone?: string;
}

export interface CreatorVideoInfoGenerateRequest extends CreatorGenerationSourceInput {
  videoInfoBlocks?: CreatorVideoInfoBlock[];
}

export interface CreatorChapter {
  id: string;
  timeSeconds: number;
  label: string;
  reason: string;
}

export interface CreatorSuggestedShort {
  id: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  score: number;
  title: string;
  reason: string;
  caption: string;
  openingText: string;
  endCardText: string;
  sourceChunkIndexes: number[];
  suggestedSubtitleLanguage: string;
  editorPreset: CreatorVerticalEditorPreset;
}

export interface CreatorViralClip {
  id: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  score: number;
  title: string;
  hook: string;
  reason: string;
  punchline: string;
  sourceChunkIndexes: number[];
  suggestedSubtitleLanguage: string;
}

export interface CreatorShortPlan {
  id: string;
  clipId: string;
  title: string;
  caption: string;
  openingText: string;
  endCardText: string;
  editorPreset: CreatorVerticalEditorPreset;
}

export interface CreatorInsights {
  transcriptWordCount: number;
  estimatedSpeakingRateWpm: number;
  repeatedTerms: string[];
  detectedTheme: string;
}

export interface CreatorGenerationResponseMeta {
  ok: true;
  providerMode: CreatorAIProviderMode;
  model: string;
  generatedAt: number;
  runtimeSeconds: number;
}

export interface CreatorShortsGenerateResponse extends CreatorGenerationResponseMeta {
  shorts?: CreatorSuggestedShort[];
  viralClips: CreatorViralClip[];
  shortsPlans: CreatorShortPlan[];
  editorPresets: CreatorVerticalEditorPreset[];
}

export interface CreatorVideoInfoGenerateResponse extends CreatorGenerationResponseMeta {
  youtube: CreatorYouTubePack;
  content: CreatorLongFormContentPack;
  chapters: CreatorChapter[];
  insights: CreatorInsights;
}

export interface CreatorShortRenderRequest {
  filename: string;
  short?: CreatorSuggestedShort;
  clip?: CreatorViralClip;
  plan?: CreatorShortPlan;
  subtitleChunks?: SubtitleChunk[];
  editor: CreatorShortEditorState;
}

export interface CreatorYouTubePack {
  titleIdeas: string[];
  description: string;
  pinnedComment: string;
  hashtags: string[];
  seoKeywords: string[];
  thumbnailHooks: string[];
  chapterText: string;
}

export interface CreatorLongFormContentPack {
  videoSummary: string;
  keyMoments: string[];
  hookIdeas: string[];
  ctaIdeas: string[];
  repurposeIdeas: string[];
}

export interface CreatorVerticalEditorPreset {
  aspectRatio: "9:16";
  resolution: "1080x1920";
  subtitleStyle: "bold_pop" | "clean_caption" | "creator_neon";
  safeTopPct: number;
  safeBottomPct: number;
  targetDurationRange: [number, number];
}

export type CreatorSubtitleTextCase = "original" | "uppercase";
export type CreatorTextOverlayTextCase = "original" | "uppercase";
export type CreatorTextOverlayPreset = "headline_bold" | "glass_card" | "neon_punch";

export interface CreatorSubtitleStyleSettings {
  preset: CreatorVerticalEditorPreset["subtitleStyle"];
  textColor: string;
  letterWidth: number;
  borderColor: string;
  borderWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowDistance: number;
  textCase: CreatorSubtitleTextCase;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundRadius: number;
  backgroundPaddingX: number;
  backgroundPaddingY: number;
}

export interface CreatorTextOverlayStyleSettings {
  preset: CreatorTextOverlayPreset;
  textColor: string;
  borderColor: string;
  borderWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowDistance: number;
  textCase: CreatorTextOverlayTextCase;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundRadius: number;
  backgroundPaddingX: number;
  backgroundPaddingY: number;
}

export interface CreatorTextOverlayState {
  enabled: boolean;
  text: string;
  startOffsetSeconds: number;
  durationSeconds: number;
  positionXPercent: number;
  positionYPercent: number;
  scale: number;
  maxWidthPct: number;
  style?: Partial<CreatorTextOverlayStyleSettings>;
}

export interface CreatorShortEditorState {
  zoom: number;
  panX: number;
  panY: number;
  subtitleScale: number;
  subtitleXPositionPct: number;
  subtitleYOffsetPct: number;
  showSubtitles?: boolean;
  showSafeZones?: boolean;
  subtitleStyle?: Partial<CreatorSubtitleStyleSettings>;
  introOverlay?: CreatorTextOverlayState;
  outroOverlay?: CreatorTextOverlayState;
}

export interface CreatorShortRenderResponse {
  ok: true;
  providerMode: CreatorAIProviderMode | "mock-render" | "local-browser" | "system";
  jobId: string;
  status: "queued" | "processing" | "completed";
  createdAt: number;
  estimatedSeconds: number;
  output: {
    filename: string;
    aspectRatio: "9:16";
    resolution: "1080x1920";
    subtitleBurnedIn: boolean;
  };
  debugPreview: {
    ffmpegCommandPreview: string[];
    notes: string[];
  };
}

export function secondsToClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
