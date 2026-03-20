import type { SubtitleChunk } from "@/lib/history";

export type CreatorAIProviderMode = "mock" | "openai";

export type ShortsPlatform = "tiktok" | "instagram_reels" | "youtube_shorts";

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
  transcriptText: string;
  transcriptChunks: SubtitleChunk[];
  subtitleChunks?: SubtitleChunk[];
  transcriptVersionLabel?: string;
  subtitleVersionLabel?: string;
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
  platform: ShortsPlatform;
  aspectRatio: "9:16";
  resolution: "1080x1920";
  subtitleStyle: "bold_pop" | "clean_caption" | "creator_neon";
  safeTopPct: number;
  safeBottomPct: number;
  targetDurationRange: [number, number];
}

export interface CreatorShortPlan {
  id: string;
  clipId: string;
  platform: ShortsPlatform;
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
  recommendedPrimaryPlatform: ShortsPlatform;
}

export interface CreatorGenerationResponseMeta {
  ok: true;
  providerMode: CreatorAIProviderMode;
  model: string;
  generatedAt: number;
  runtimeSeconds: number;
}

export interface CreatorShortsGenerateResponse extends CreatorGenerationResponseMeta {
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
  clip: CreatorViralClip;
  plan: CreatorShortPlan;
  subtitleChunks?: SubtitleChunk[];
  editor: CreatorShortEditorState;
}

export type CreatorSubtitleTextCase = "original" | "uppercase";

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
}

export interface CreatorShortRenderResponse {
  ok: true;
  providerMode: CreatorAIProviderMode | "mock-render" | "local-browser";
  jobId: string;
  status: "queued" | "processing" | "completed";
  createdAt: number;
  estimatedSeconds: number;
  output: {
    platform: ShortsPlatform;
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
