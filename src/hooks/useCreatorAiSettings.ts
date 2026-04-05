"use client";

import { useCallback, useSyncExternalStore } from "react";

import type {
  CreatorAIFeatureSettings,
  CreatorAIFeatureSettingsMap,
  CreatorLLMFeature,
  CreatorPromptProfiles,
  CreatorVideoInfoPromptProfile,
} from "@/lib/creator/types";
import {
  CREATOR_AI_SETTINGS_STORAGE_KEY,
  type CreatorAISettings,
  clearCreatorAISettings,
  maskElevenLabsApiKey,
  maskGeminiApiKey,
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
  const credentials = settings?.credentials;
  const featureSettings = settings?.featureSettings;

  const writeSettings = useCallback((input: {
    openAIApiKey?: string;
    geminiApiKey?: string;
    elevenLabsApiKey?: string;
    featureSettings?: CreatorAIFeatureSettingsMap;
    promptProfiles?: CreatorPromptProfiles;
  }) => {
    if (typeof window === "undefined") return null;
    const next = writeCreatorAISettings(window.localStorage, input);
    emitChange();
    return next;
  }, []);

  const saveOpenAIApiKey = useCallback((value: string) => {
    return writeSettings({
      openAIApiKey: value,
      geminiApiKey: credentials?.geminiApiKey ?? "",
      elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
      featureSettings,
      promptProfiles: settings?.promptProfiles,
    });
  }, [credentials?.elevenLabsApiKey, credentials?.geminiApiKey, featureSettings, settings?.promptProfiles, writeSettings]);

  const saveGeminiApiKey = useCallback((value: string) => {
    return writeSettings({
      openAIApiKey: credentials?.openAIApiKey ?? "",
      geminiApiKey: value,
      elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
      featureSettings,
      promptProfiles: settings?.promptProfiles,
    });
  }, [credentials?.elevenLabsApiKey, credentials?.openAIApiKey, featureSettings, settings?.promptProfiles, writeSettings]);

  const saveElevenLabsApiKey = useCallback((value: string) => {
    return writeSettings({
      openAIApiKey: credentials?.openAIApiKey ?? "",
      geminiApiKey: credentials?.geminiApiKey ?? "",
      elevenLabsApiKey: value,
      featureSettings,
      promptProfiles: settings?.promptProfiles,
    });
  }, [credentials?.geminiApiKey, credentials?.openAIApiKey, featureSettings, settings?.promptProfiles, writeSettings]);

  const saveFeatureSettings = useCallback(
    (feature: CreatorLLMFeature, nextFeatureSettings: CreatorAIFeatureSettings | undefined) => {
      const nextSettings: CreatorAIFeatureSettingsMap = {
        ...(featureSettings ?? {}),
      };
      if (nextFeatureSettings) {
        nextSettings[feature] = nextFeatureSettings;
      } else {
        delete nextSettings[feature];
      }

      return writeSettings({
        openAIApiKey: credentials?.openAIApiKey ?? "",
        geminiApiKey: credentials?.geminiApiKey ?? "",
        elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
        featureSettings: nextSettings,
        promptProfiles: settings?.promptProfiles,
      });
    },
    [
      credentials?.elevenLabsApiKey,
      credentials?.geminiApiKey,
      credentials?.openAIApiKey,
      featureSettings,
      settings?.promptProfiles,
      writeSettings,
    ]
  );

  const saveFeatureModel = useCallback(
    (feature: CreatorLLMFeature, model: string, provider?: CreatorAIFeatureSettings["provider"]) => {
      const current = featureSettings?.[feature] ?? {};
      return saveFeatureSettings(feature, {
        provider: provider ?? current.provider,
        model,
      });
    },
    [featureSettings, saveFeatureSettings]
  );

  const saveFeatureProvider = useCallback(
    (feature: CreatorLLMFeature, provider: CreatorAIFeatureSettings["provider"]) => {
      const current = featureSettings?.[feature] ?? {};
      return saveFeatureSettings(feature, {
        provider,
        model: current.model,
      });
    },
    [featureSettings, saveFeatureSettings]
  );

  const saveVideoInfoPromptProfile = useCallback((profile: CreatorVideoInfoPromptProfile | undefined) => {
    const nextPromptProfiles: CreatorPromptProfiles = {
      ...(settings?.promptProfiles ?? {}),
    };
    if (profile) {
      nextPromptProfiles.video_info = profile;
    } else {
      delete nextPromptProfiles.video_info;
    }
    return writeSettings({
      openAIApiKey: credentials?.openAIApiKey ?? "",
      geminiApiKey: credentials?.geminiApiKey ?? "",
      elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
      featureSettings,
      promptProfiles: nextPromptProfiles,
    });
  }, [
    credentials?.elevenLabsApiKey,
    credentials?.geminiApiKey,
    credentials?.openAIApiKey,
    featureSettings,
    settings?.promptProfiles,
    writeSettings,
  ]);

  const clearOpenAIApiKey = useCallback(() => {
    if (typeof window === "undefined") return;
    const hasPromptProfiles = Boolean(settings?.promptProfiles && Object.keys(settings.promptProfiles).length > 0);
    const hasFeatureSettings = Boolean(featureSettings && Object.keys(featureSettings).length > 0);
    if (hasPromptProfiles || hasFeatureSettings || (credentials?.elevenLabsApiKey ?? "").trim() || (credentials?.geminiApiKey ?? "").trim()) {
      writeSettings({
        openAIApiKey: "",
        geminiApiKey: credentials?.geminiApiKey ?? "",
        elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
        featureSettings,
        promptProfiles: settings?.promptProfiles,
      });
    } else {
      clearCreatorAISettings(window.localStorage);
      emitChange();
    }
  }, [credentials?.elevenLabsApiKey, credentials?.geminiApiKey, featureSettings, settings, writeSettings]);

  const clearGeminiApiKey = useCallback(() => {
    if (typeof window === "undefined") return;
    const hasPromptProfiles = Boolean(settings?.promptProfiles && Object.keys(settings.promptProfiles).length > 0);
    const hasFeatureSettings = Boolean(featureSettings && Object.keys(featureSettings).length > 0);
    if (hasPromptProfiles || hasFeatureSettings || (credentials?.elevenLabsApiKey ?? "").trim() || (credentials?.openAIApiKey ?? "").trim()) {
      writeSettings({
        openAIApiKey: credentials?.openAIApiKey ?? "",
        geminiApiKey: "",
        elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
        featureSettings,
        promptProfiles: settings?.promptProfiles,
      });
    } else {
      clearCreatorAISettings(window.localStorage);
      emitChange();
    }
  }, [credentials?.elevenLabsApiKey, credentials?.openAIApiKey, featureSettings, settings, writeSettings]);

  const clearElevenLabsApiKey = useCallback(() => {
    if (typeof window === "undefined") return;
    const hasPromptProfiles = Boolean(settings?.promptProfiles && Object.keys(settings.promptProfiles).length > 0);
    const hasFeatureSettings = Boolean(featureSettings && Object.keys(featureSettings).length > 0);
    if (hasPromptProfiles || hasFeatureSettings || (credentials?.openAIApiKey ?? "").trim() || (credentials?.geminiApiKey ?? "").trim()) {
      writeSettings({
        openAIApiKey: credentials?.openAIApiKey ?? "",
        geminiApiKey: credentials?.geminiApiKey ?? "",
        elevenLabsApiKey: "",
        featureSettings,
        promptProfiles: settings?.promptProfiles,
      });
    } else {
      clearCreatorAISettings(window.localStorage);
      emitChange();
    }
  }, [credentials?.geminiApiKey, credentials?.openAIApiKey, featureSettings, settings, writeSettings]);

  const clearVideoInfoPromptProfile = useCallback(() => {
    if (typeof window === "undefined") return;
    const nextPromptProfiles: CreatorPromptProfiles = {
      ...(settings?.promptProfiles ?? {}),
    };
    delete nextPromptProfiles.video_info;
    if (
      (credentials?.openAIApiKey ?? "").trim() ||
      (credentials?.geminiApiKey ?? "").trim() ||
      (credentials?.elevenLabsApiKey ?? "").trim() ||
      Object.keys(featureSettings ?? {}).length > 0 ||
      Object.keys(nextPromptProfiles).length > 0
    ) {
      writeSettings({
        openAIApiKey: credentials?.openAIApiKey ?? "",
        geminiApiKey: credentials?.geminiApiKey ?? "",
        elevenLabsApiKey: credentials?.elevenLabsApiKey ?? "",
        featureSettings,
        promptProfiles: nextPromptProfiles,
      });
    } else {
      clearCreatorAISettings(window.localStorage);
      emitChange();
    }
  }, [
    credentials?.elevenLabsApiKey,
    credentials?.geminiApiKey,
    credentials?.openAIApiKey,
    featureSettings,
    settings?.promptProfiles,
    writeSettings,
  ]);

  const openAIApiKey = credentials?.openAIApiKey ?? "";
  const geminiApiKey = credentials?.geminiApiKey ?? "";
  const elevenLabsApiKey = credentials?.elevenLabsApiKey ?? "";
  const videoInfoPromptProfile = settings?.promptProfiles?.video_info;

  return {
    settings,
    credentials,
    featureSettings,
    openAIApiKey,
    geminiApiKey,
    elevenLabsApiKey,
    hasOpenAIApiKey: openAIApiKey.length > 0,
    hasGeminiApiKey: geminiApiKey.length > 0,
    hasElevenLabsApiKey: elevenLabsApiKey.length > 0,
    maskedOpenAIApiKey: openAIApiKey ? maskOpenAIApiKey(openAIApiKey) : "",
    maskedGeminiApiKey: geminiApiKey ? maskGeminiApiKey(geminiApiKey) : "",
    maskedElevenLabsApiKey: elevenLabsApiKey ? maskElevenLabsApiKey(elevenLabsApiKey) : "",
    shortsFeatureSettings: featureSettings?.shorts,
    videoInfoFeatureSettings: featureSettings?.video_info,
    videoInfoPromptProfile,
    saveOpenAIApiKey,
    saveGeminiApiKey,
    saveElevenLabsApiKey,
    saveFeatureSettings,
    saveFeatureModel,
    saveFeatureProvider,
    clearOpenAIApiKey,
    clearGeminiApiKey,
    clearElevenLabsApiKey,
    saveVideoInfoPromptProfile,
    clearVideoInfoPromptProfile,
  };
}
