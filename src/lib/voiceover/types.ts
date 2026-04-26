export type VoiceoverProviderId = "elevenlabs" | "openai" | "gemini";
export type VoiceoverOutputFormat = "mp3" | "wav";
export type VoiceoverApiKeySource = "voiceover_settings" | "env";
export type VoiceoverUsageSource = "provider" | "estimated";
export type VoiceoverEstimatedCostSource = "estimated" | "provider" | "unavailable";
export type VoiceoverSpeakerMode = "single" | "multi";

export interface VoiceoverModelOption {
  value: string;
  label: string;
}

export interface VoiceoverVoiceOption {
  value: string;
  label: string;
  tone?: string;
}

export interface VoiceoverLanguageOption {
  value: string;
  label: string;
}

export interface VoiceoverSpeakerConfig {
  speaker: string;
  voiceName: string;
}

export interface VoiceoverGeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface ProjectVoiceoverDraft {
  text: string;
  updatedAt: number;
  sourceFilename?: string;
  provider: VoiceoverProviderId;
  model: string;
  voiceId: string;
  voiceName?: string;
  languageCode?: string;
  speakerMode?: VoiceoverSpeakerMode;
  speakers?: VoiceoverSpeakerConfig[];
  stylePrompt?: string;
  generationConfig?: VoiceoverGeminiGenerationConfig;
  useDefaultVoiceId: boolean;
  outputFormat: VoiceoverOutputFormat;
}

export interface ProjectVoiceoverRecord {
  id: string;
  projectId: string;
  assetId: string;
  createdAt: number;
  scriptText: string;
  provider: VoiceoverProviderId;
  model: string;
  voiceId: string;
  voiceName?: string;
  languageCode?: string;
  speakerMode?: VoiceoverSpeakerMode;
  speakers?: VoiceoverSpeakerConfig[];
  stylePrompt?: string;
  generationConfig?: VoiceoverGeminiGenerationConfig;
  outputFormat: VoiceoverOutputFormat;
  sourceFilename?: string;
  apiKeySource?: VoiceoverApiKeySource;
  maskedApiKey?: string;
  usage?: VoiceoverUsageSummary;
}

export interface VoiceoverGenerateRequest {
  projectId: string;
  scriptText: string;
  provider: VoiceoverProviderId;
  model: string;
  voiceId: string;
  voiceName?: string;
  languageCode?: string;
  speakerMode?: VoiceoverSpeakerMode;
  speakers?: VoiceoverSpeakerConfig[];
  stylePrompt?: string;
  generationConfig?: VoiceoverGeminiGenerationConfig;
  useDefaultVoiceId?: boolean;
  outputFormat: VoiceoverOutputFormat;
}

export interface VoiceoverGenerateResponseMeta {
  provider: VoiceoverProviderId;
  model: string;
  voiceId: string;
  voiceName?: string;
  languageCode?: string;
  speakerMode?: VoiceoverSpeakerMode;
  speakers?: VoiceoverSpeakerConfig[];
  outputFormat: VoiceoverOutputFormat;
  apiKeySource?: VoiceoverApiKeySource;
  maskedApiKey?: string;
  filename: string;
  mimeType: string;
  extension: string;
  usage?: VoiceoverUsageSummary;
}

export interface VoiceoverGenerateResult extends VoiceoverGenerateResponseMeta {
  bytes: Uint8Array;
}

export interface VoiceoverUsageSummary {
  billedCharacters: number;
  source: VoiceoverUsageSource;
  estimatedCostUsd: number | null;
  estimatedCostSource?: VoiceoverEstimatedCostSource;
  estimatedCreditsMin: number;
  estimatedCreditsMax: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface VoiceoverProviderGenerateInput extends VoiceoverGenerateRequest {
  apiKey: string;
  apiKeySource: VoiceoverApiKeySource;
  signal?: AbortSignal;
}

export interface VoiceoverProviderAdapter {
  readonly id: VoiceoverProviderId;
  generate(input: VoiceoverProviderGenerateInput): Promise<VoiceoverGenerateResult>;
}

export interface ProjectVoiceoverConfigResponse {
  provider: VoiceoverProviderId;
  models: VoiceoverModelOption[];
  defaultModel: string;
  defaultVoiceId: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  hasDefaultVoiceId: boolean;
  maskedDefaultVoiceId: string;
  providers: Partial<Record<VoiceoverProviderId, VoiceoverProviderConfig>>;
}

export interface VoiceoverProviderConfig {
  provider: VoiceoverProviderId;
  label: string;
  models: VoiceoverModelOption[];
  defaultModel: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  defaultVoiceId?: string;
  hasDefaultVoiceId?: boolean;
  maskedDefaultVoiceId?: string;
  voices?: VoiceoverVoiceOption[];
  defaultVoiceName?: string;
  languages?: VoiceoverLanguageOption[];
  defaultLanguageCode?: string;
}
