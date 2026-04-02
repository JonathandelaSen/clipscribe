"use client";

import { useEffect, useState } from "react";

import type { ProjectVoiceoverConfigResponse } from "@/lib/voiceover/types";
import { buildDefaultProjectVoiceoverConfig } from "@/lib/voiceover/utils";

export function useProjectVoiceoverConfig() {
  const [config, setConfig] = useState<ProjectVoiceoverConfigResponse>(() => buildDefaultProjectVoiceoverConfig());

  useEffect(() => {
    let active = true;

    async function loadConfig() {
      try {
        const response = await fetch("/api/projects/voiceover/config", {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as ProjectVoiceoverConfigResponse;
        if (!active) return;
        setConfig({
          provider: "elevenlabs",
          models: Array.isArray(payload.models) && payload.models.length > 0 ? payload.models : buildDefaultProjectVoiceoverConfig().models,
          defaultModel: payload.defaultModel,
          defaultVoiceId: payload.defaultVoiceId ?? "",
          hasApiKey: Boolean(payload.hasApiKey),
          maskedApiKey: payload.maskedApiKey ?? "",
          hasDefaultVoiceId: Boolean(payload.hasDefaultVoiceId),
          maskedDefaultVoiceId: payload.maskedDefaultVoiceId ?? "",
        });
      } catch {
        // Keep local defaults when config lookup fails.
      }
    }

    void loadConfig();

    return () => {
      active = false;
    };
  }, []);

  return config;
}
