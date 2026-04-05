import { sanitizeCreatorFeatureSettings } from "./ai";
import { sanitizeVideoInfoPromptProfile } from "./prompt-customization";
import type { CreatorAIFeatureSettingsMap, CreatorLLMFeature, CreatorPromptProfiles } from "./types";

export const CREATOR_OPENAI_API_KEY_HEADER = "x-creator-openai-api-key";
export const CREATOR_GEMINI_API_KEY_HEADER = "x-creator-gemini-api-key";
export const CREATOR_AI_SETTINGS_STORAGE_KEY = "clipscribe.creator-ai-settings.v1";

export interface CreatorAICredentials {
  openAIApiKey: string;
  geminiApiKey: string;
  elevenLabsApiKey: string;
}

export interface CreatorAISettings {
  credentials: CreatorAICredentials;
  featureSettings?: CreatorAIFeatureSettingsMap;
  promptProfiles?: CreatorPromptProfiles;
  updatedAt: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

export function sanitizeOpenAIApiKey(value: string): string {
  return value.trim();
}

export function sanitizeGeminiApiKey(value: string): string {
  return value.trim();
}

export function sanitizeElevenLabsApiKey(value: string): string {
  return value.trim();
}

export function maskOpenAIApiKey(value: string): string {
  const trimmed = sanitizeOpenAIApiKey(value);
  if (!trimmed) return "";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

export function maskGeminiApiKey(value: string): string {
  const trimmed = sanitizeGeminiApiKey(value);
  if (!trimmed) return "";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

export function maskElevenLabsApiKey(value: string): string {
  const trimmed = sanitizeElevenLabsApiKey(value);
  if (!trimmed) return "";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

function sanitizeFeatureSettings(raw: unknown): CreatorAIFeatureSettingsMap | undefined {
  if (!isRecord(raw)) return undefined;

  const featureSettings: CreatorAIFeatureSettingsMap = {};
  for (const feature of ["shorts", "video_info"] as CreatorLLMFeature[]) {
    const next = sanitizeCreatorFeatureSettings(raw[feature], feature);
    if (next) {
      featureSettings[feature] = next;
    }
  }

  return Object.keys(featureSettings).length > 0 ? featureSettings : undefined;
}

export function readCreatorAISettings(storage: StorageLike): CreatorAISettings | null {
  const raw = storage.getItem(CREATOR_AI_SETTINGS_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const rawCredentials = isRecord(parsed.credentials) ? parsed.credentials : null;
    const openAIApiKey = sanitizeOpenAIApiKey(String(rawCredentials?.openAIApiKey ?? parsed.openAIApiKey ?? ""));
    const geminiApiKey = sanitizeGeminiApiKey(String(rawCredentials?.geminiApiKey ?? parsed.geminiApiKey ?? ""));
    const elevenLabsApiKey = sanitizeElevenLabsApiKey(
      String(rawCredentials?.elevenLabsApiKey ?? parsed.elevenLabsApiKey ?? "")
    );
    const rawPromptProfiles = isRecord(parsed.promptProfiles) ? parsed.promptProfiles : null;
    const featureSettings = sanitizeFeatureSettings(parsed.featureSettings);
    const promptProfiles: CreatorPromptProfiles = {};
    const videoInfoProfile = sanitizeVideoInfoPromptProfile(rawPromptProfiles?.video_info);
    if (videoInfoProfile) {
      promptProfiles.video_info = videoInfoProfile;
    }
    const updatedAt = Number(parsed.updatedAt ?? Date.now());
    const settings: CreatorAISettings = {
      credentials: {
        openAIApiKey,
        geminiApiKey,
        elevenLabsApiKey,
      },
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
    if (featureSettings) {
      settings.featureSettings = featureSettings;
    }
    if (Object.keys(promptProfiles).length > 0) {
      settings.promptProfiles = promptProfiles;
    }
    return openAIApiKey || geminiApiKey || elevenLabsApiKey || settings.promptProfiles || featureSettings
      ? settings
      : null;
  } catch {
    return null;
  }
}

export function writeCreatorAISettings(
  storage: StorageLike,
  input: {
    openAIApiKey?: string;
    geminiApiKey?: string;
    elevenLabsApiKey?: string;
    featureSettings?: CreatorAIFeatureSettingsMap;
    promptProfiles?: CreatorPromptProfiles;
  }
): CreatorAISettings {
  const nextPromptProfiles: CreatorPromptProfiles = {};
  const videoInfoProfile = sanitizeVideoInfoPromptProfile(input.promptProfiles?.video_info);
  if (videoInfoProfile) {
    nextPromptProfiles.video_info = videoInfoProfile;
  }

  const next: CreatorAISettings = {
    credentials: {
      openAIApiKey: sanitizeOpenAIApiKey(input.openAIApiKey ?? ""),
      geminiApiKey: sanitizeGeminiApiKey(input.geminiApiKey ?? ""),
      elevenLabsApiKey: sanitizeElevenLabsApiKey(input.elevenLabsApiKey ?? ""),
    },
    updatedAt: Date.now(),
  };
  const featureSettings = sanitizeFeatureSettings(input.featureSettings);
  if (featureSettings) {
    next.featureSettings = featureSettings;
  }
  if (Object.keys(nextPromptProfiles).length > 0) {
    next.promptProfiles = nextPromptProfiles;
  }

  storage.setItem(CREATOR_AI_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearCreatorAISettings(storage: StorageLike): void {
  storage.removeItem(CREATOR_AI_SETTINGS_STORAGE_KEY);
}

export function buildCreatorTextProviderHeaders(input: {
  openAIApiKey?: string;
  geminiApiKey?: string;
}): HeadersInit | undefined {
  const headers: Record<string, string> = {};
  const openAIApiKey = sanitizeOpenAIApiKey(input.openAIApiKey ?? "");
  const geminiApiKey = sanitizeGeminiApiKey(input.geminiApiKey ?? "");

  if (openAIApiKey) {
    headers[CREATOR_OPENAI_API_KEY_HEADER] = openAIApiKey;
  }
  if (geminiApiKey) {
    headers[CREATOR_GEMINI_API_KEY_HEADER] = geminiApiKey;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}
