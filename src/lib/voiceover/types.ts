export type VoiceoverProviderId = "elevenlabs" | "openai" | "gemini";
export type VoiceoverOutputFormat = "mp3" | "wav";
export type VoiceoverApiKeySource = "voiceover_settings" | "env";
export type VoiceoverUsageSource = "provider" | "estimated";

export interface VoiceoverModelOption {
  value: string;
  label: string;
}

export interface ProjectVoiceoverDraft {
  text: string;
  updatedAt: number;
  sourceFilename?: string;
  provider: VoiceoverProviderId;
  model: string;
  voiceId: string;
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
  useDefaultVoiceId?: boolean;
  outputFormat: VoiceoverOutputFormat;
}

export interface VoiceoverGenerateResponseMeta {
  provider: VoiceoverProviderId;
  model: string;
  voiceId: string;
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
  estimatedCreditsMin: number;
  estimatedCreditsMax: number;
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
  provider: "elevenlabs";
  models: VoiceoverModelOption[];
  defaultModel: string;
  defaultVoiceId: string;
  hasApiKey: boolean;
  maskedApiKey: string;
  hasDefaultVoiceId: boolean;
  maskedDefaultVoiceId: string;
}
