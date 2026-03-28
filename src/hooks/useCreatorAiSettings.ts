"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { CreatorPromptProfiles, CreatorVideoInfoPromptProfile } from "@/lib/creator/types";
import {
  CREATOR_AI_SETTINGS_STORAGE_KEY,
  type CreatorAISettings,
  clearCreatorAISettings,
  maskOpenAIApiKey,
  readCreatorAISettings,
  writeCreatorAISettings,
} from "@/lib/creator/user-ai-settings";
const localListeners = new Set<() => void>();

function emitChange() {
  for (const listener of localListeners) {
    listener();
  }
}

function subscribe(onStoreChange: () => void) {
  localListeners.add(onStoreChange);

  if (typeof window === "undefined") {
    return () => {
      localListeners.delete(onStoreChange);
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== CREATOR_AI_SETTINGS_STORAGE_KEY) return;
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    localListeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

let cachedSnapshot: CreatorAISettings | null = null;
let cachedRaw: string | null | undefined = undefined;

function getSnapshot() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CREATOR_AI_SETTINGS_STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedSnapshot;
  }
  cachedRaw = raw;
  cachedSnapshot = readCreatorAISettings(window.localStorage);
  return cachedSnapshot;
}

function getServerSnapshot() {
  return null;
}

export function useCreatorAiSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const saveOpenAIApiKey = useCallback((value: string) => {
    if (typeof window === "undefined") return null;
    const next = writeCreatorAISettings(window.localStorage, {
      openAIApiKey: value,
      promptProfiles: settings?.promptProfiles,
    });
    emitChange();
    return next;
  }, [settings]);

  const saveVideoInfoPromptProfile = useCallback((profile: CreatorVideoInfoPromptProfile | undefined) => {
    if (typeof window === "undefined") return null;
    const nextPromptProfiles: CreatorPromptProfiles = {
      ...(settings?.promptProfiles ?? {}),
    };
    if (profile) {
      nextPromptProfiles.video_info = profile;
    } else {
      delete nextPromptProfiles.video_info;
    }
    const next = writeCreatorAISettings(window.localStorage, {
      openAIApiKey: settings?.openAIApiKey ?? "",
      promptProfiles: nextPromptProfiles,
    });
    emitChange();
    return next;
  }, [settings?.openAIApiKey, settings?.promptProfiles]);

  const clearOpenAIApiKey = useCallback(() => {
    if (typeof window === "undefined") return;
    const hasPromptProfiles = Boolean(settings?.promptProfiles && Object.keys(settings.promptProfiles).length > 0);
    if (hasPromptProfiles) {
      writeCreatorAISettings(window.localStorage, {
        openAIApiKey: "",
        promptProfiles: settings?.promptProfiles,
      });
    } else {
      clearCreatorAISettings(window.localStorage);
    }
    emitChange();
  }, [settings]);

  const clearVideoInfoPromptProfile = useCallback(() => {
    if (typeof window === "undefined") return;
    const nextPromptProfiles: CreatorPromptProfiles = {
      ...(settings?.promptProfiles ?? {}),
    };
    delete nextPromptProfiles.video_info;
    if ((settings?.openAIApiKey ?? "").trim() || Object.keys(nextPromptProfiles).length > 0) {
      writeCreatorAISettings(window.localStorage, {
        openAIApiKey: settings?.openAIApiKey ?? "",
        promptProfiles: nextPromptProfiles,
      });
    } else {
      clearCreatorAISettings(window.localStorage);
    }
    emitChange();
  }, [settings?.openAIApiKey, settings?.promptProfiles]);

  const openAIApiKey = settings?.openAIApiKey ?? "";
  const videoInfoPromptProfile = settings?.promptProfiles?.video_info;

  return {
    settings,
    openAIApiKey,
    hasOpenAIApiKey: openAIApiKey.length > 0,
    maskedOpenAIApiKey: openAIApiKey ? maskOpenAIApiKey(openAIApiKey) : "",
    videoInfoPromptProfile,
    saveOpenAIApiKey,
    clearOpenAIApiKey,
    saveVideoInfoPromptProfile,
    clearVideoInfoPromptProfile,
  };
}
