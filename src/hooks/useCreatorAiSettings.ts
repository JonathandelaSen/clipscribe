"use client";

import { useCallback, useSyncExternalStore } from "react";

import { CREATOR_AI_SETTINGS_STORAGE_KEY, type CreatorAISettings, clearCreatorAISettings, maskOpenAIApiKey, readCreatorAISettings, writeCreatorAISettings } from "@/lib/creator/user-ai-settings";
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
    const next = writeCreatorAISettings(window.localStorage, value);
    emitChange();
    return next;
  }, []);

  const clearOpenAIApiKey = useCallback(() => {
    if (typeof window === "undefined") return;
    clearCreatorAISettings(window.localStorage);
    emitChange();
  }, []);

  const openAIApiKey = settings?.openAIApiKey ?? "";

  return {
    settings,
    openAIApiKey,
    hasOpenAIApiKey: openAIApiKey.length > 0,
    maskedOpenAIApiKey: openAIApiKey ? maskOpenAIApiKey(openAIApiKey) : "",
    saveOpenAIApiKey,
    clearOpenAIApiKey,
  };
}
