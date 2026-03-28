import type { CreatorPromptProfiles } from "./types";
import { sanitizeVideoInfoPromptProfile } from "./prompt-customization";

export const CREATOR_OPENAI_API_KEY_HEADER = "x-creator-openai-api-key";
export const CREATOR_AI_SETTINGS_STORAGE_KEY = "clipscribe.creator-ai-settings.v1";

export interface CreatorAISettings {
  openAIApiKey: string;
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

export function maskOpenAIApiKey(value: string): string {
  const trimmed = sanitizeOpenAIApiKey(value);
  if (!trimmed) return "";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

export function readCreatorAISettings(storage: StorageLike): CreatorAISettings | null {
  const raw = storage.getItem(CREATOR_AI_SETTINGS_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const openAIApiKey = sanitizeOpenAIApiKey(String(parsed.openAIApiKey ?? ""));
    const rawPromptProfiles = isRecord(parsed.promptProfiles) ? parsed.promptProfiles : null;
    const promptProfiles: CreatorPromptProfiles = {};
    const videoInfoProfile = sanitizeVideoInfoPromptProfile(rawPromptProfiles?.video_info);
    if (videoInfoProfile) {
      promptProfiles.video_info = videoInfoProfile;
    }
    const updatedAt = Number(parsed.updatedAt ?? Date.now());
    const settings: CreatorAISettings = {
      openAIApiKey,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
    if (Object.keys(promptProfiles).length > 0) {
      settings.promptProfiles = promptProfiles;
    }
    return openAIApiKey || settings.promptProfiles ? settings : null;
  } catch {
    return null;
  }
}

export function writeCreatorAISettings(
  storage: StorageLike,
  input: {
    openAIApiKey?: string;
    promptProfiles?: CreatorPromptProfiles;
  }
): CreatorAISettings {
  const nextPromptProfiles: CreatorPromptProfiles = {};
  const videoInfoProfile = sanitizeVideoInfoPromptProfile(input.promptProfiles?.video_info);
  if (videoInfoProfile) {
    nextPromptProfiles.video_info = videoInfoProfile;
  }

  const next: CreatorAISettings = {
    openAIApiKey: sanitizeOpenAIApiKey(input.openAIApiKey ?? ""),
    updatedAt: Date.now(),
  };
  if (Object.keys(nextPromptProfiles).length > 0) {
    next.promptProfiles = nextPromptProfiles;
  }

  storage.setItem(CREATOR_AI_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearCreatorAISettings(storage: StorageLike): void {
  storage.removeItem(CREATOR_AI_SETTINGS_STORAGE_KEY);
}
