import type { SubtitleChunk } from "@/lib/history";

export type CreatorAIProviderMode = "mock" | "openai" | "gemini";
export type CreatorLLMFeature = "shorts" | "video_info";
export type CreatorLLMProvider = "openai" | "gemini";
export type CreatorLLMOperation = "generate_shorts" | "generate_video_info";
export type CreatorPromptProfileFamily = "video_info" | "shorts";
export type CreatorPromptCustomizationMode = "default" | "global_customized" | "run_override";
export type CreatorPromptSlotOverrideMode = "inherit" | "replace" | "omit";
export type CreatorLLMApiKeySource = "header" | "env";
export type CreatorLLMCostSource = "estimated" | "unavailable";
export type CreatorLLMRunStatus =
  | "queued"
  | "processing"
  | "success"
  | "provider_error"
  | "parse_error"
  | "validation_error";
export type CreatorLLMRedactionState = "raw" | "purged";

export interface CreatorGenerationConfig {
  provider?: CreatorLLMProvider;
  model?: string;
}

export interface CreatorAIFeatureSettings {
  provider?: CreatorLLMProvider;
  model?: string;
}

export interface CreatorAIFeatureSettingsMap {
  shorts?: CreatorAIFeatureSettings;
  video_info?: CreatorAIFeatureSettings;
}

export interface CreatorFeatureModelOption {
  value: string;
  label: string;
  provider: CreatorLLMProvider;
  source: "catalog" | "provider";
}

export interface CreatorTextFeatureConfigResponse {
  feature: CreatorLLMFeature;
  provider: CreatorLLMProvider;
  defaultProvider: CreatorLLMProvider;
  allowedProviders: CreatorLLMProvider[];
  defaultModel: string;
  temperature: number;
  models: CreatorFeatureModelOption[];
  modelSource: "catalog" | "provider" | "mixed";
  hasApiKey: boolean;
  apiKeySource?: CreatorLLMApiKeySource;
}


export type CreatorVideoInfoBlock =
  | "titleIdeas"
  | "description"
  | "pinnedComment"
  | "hashtags"
  | "thumbnailHooks"
  | "chapters"
  | "contentPack"
  | "insights";

export type CreatorVideoInfoPromptSlot = "persona";

export interface CreatorPromptSlotOverride {
  mode: CreatorPromptSlotOverrideMode;
  value?: string;
}

export interface CreatorVideoInfoPromptProfile {
  slotOverrides?: Partial<Record<CreatorVideoInfoPromptSlot, CreatorPromptSlotOverride>>;
  globalInstructions?: string;
  fieldInstructions?: Partial<Record<CreatorVideoInfoBlock, string>>;
}

export type CreatorShortsPromptProfile = Record<string, never>;

export interface CreatorPromptProfiles {
  video_info?: CreatorVideoInfoPromptProfile;
  shorts?: CreatorShortsPromptProfile;
}

export interface CreatorVideoInfoPromptCustomizationSnapshot {
  mode: CreatorPromptCustomizationMode;
  effectiveProfile: CreatorVideoInfoPromptProfile;
  hash?: string;
  editedSections?: string[];
}

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
  generationConfig?: CreatorGenerationConfig;
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
  promptCustomizationMode?: CreatorPromptCustomizationMode;
  promptCustomizationHash?: string;
  promptEditedSections?: string[];
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
  estimatedCostSource?: CreatorLLMCostSource;
  apiKeySource?: CreatorLLMApiKeySource;
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
  promptCustomization?: CreatorVideoInfoPromptCustomizationSnapshot;
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

export interface CreatorVideoInfoProjectRecordInputSummary {
  transcriptId?: string;
  subtitleId?: string;
  transcriptVersionLabel?: string;
  subtitleVersionLabel?: string;
  sourceSignature?: string;
  videoInfoBlocks: CreatorVideoInfoBlock[];
  provider?: CreatorLLMProvider;
  model?: string;
  promptCustomizationMode?: CreatorPromptCustomizationMode;
  promptCustomizationHash?: string;
  promptEditedSections?: string[];
}

export interface CreatorVideoInfoProjectRecord {
  id: string;
  generatedAt: number;
  sourceAssetId?: string;
  sourceSignature?: string;
  inputSummary: CreatorVideoInfoProjectRecordInputSummary;
  analysis: CreatorVideoInfoGenerateResponse;
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
export type CreatorSubtitleTimingMode = "segment" | "word" | "pair" | "triple";
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

export type CreatorShortVisualSourceMode = "original" | "asset";
export type CreatorShortVisualAssetKind = "video" | "image";

export interface CreatorShortVisualSourceState {
  mode: CreatorShortVisualSourceMode;
  assetId?: string;
  kind?: CreatorShortVisualAssetKind;
}

export interface CreatorShortEditorState {
  zoom: number;
  panX: number;
  panY: number;
  subtitleScale: number;
  subtitleXPositionPct: number;
  subtitleYOffsetPct: number;
  subtitleTimingMode?: CreatorSubtitleTimingMode;
  showSubtitles?: boolean;
  showSafeZones?: boolean;
  subtitleStyle?: Partial<CreatorSubtitleStyleSettings>;
  introOverlay?: CreatorTextOverlayState;
  outroOverlay?: CreatorTextOverlayState;
  visualSource?: CreatorShortVisualSourceState;
}

export interface CreatorShortRenderResponse {
  ok: true;
  providerMode: CreatorAIProviderMode | "mock-render" | "system";
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
    renderModeUsed?: "fast_ass" | "png_parity";
    encoderUsed?: string;
    timingsMs?: CreatorShortSystemExportTimingsMs;
    counts?: CreatorShortSystemExportCounts;
  };
}

export type CreatorShortRasterOverlayKind =
  | "intro_overlay"
  | "outro_overlay"
  | "subtitle_atlas"
  | "subtitle_frame";

export interface CreatorShortSystemExportCounts {
  subtitleChunkCount: number;
  pngOverlayCount: number;
  overlayRasterPixelArea: number;
  overlayRasterAreaPct: number;
  introOverlayCount: number;
  outroOverlayCount: number;
}

export interface CreatorShortClientExportTimingsMs {
  introOverlayRender: number;
  outroOverlayRender: number;
  subtitlePreparation: number;
  requestAssembly: number;
  post: number;
  responseRead: number;
  total: number;
}

export interface CreatorShortServerExportTimingsMs {
  formDataParse: number;
  tempFileWrite: number;
  ffmpeg: number;
  outputReadback: number;
  total: number;
}

export interface CreatorShortFfmpegBenchmarkTimingsMs {
  user: number;
  system: number;
  real: number;
}

export interface CreatorShortSystemExportTimingsMs {
  client?: Partial<CreatorShortClientExportTimingsMs>;
  server?: Partial<CreatorShortServerExportTimingsMs>;
  ffmpegBenchmarkMs?: Record<string, CreatorShortFfmpegBenchmarkTimingsMs>;
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
