"use client";

import { useEffect, useMemo, useState } from "react";

import type { CreatorLLMFeature, CreatorTextFeatureConfigResponse } from "@/lib/creator/types";

type UseCreatorTextFeatureConfigOptions = {
  headers?: HeadersInit;
};

export function useCreatorTextFeatureConfig(
  feature: CreatorLLMFeature,
  options?: UseCreatorTextFeatureConfigOptions
) {
  const [config, setConfig] = useState<CreatorTextFeatureConfigResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const headersKey = JSON.stringify(options?.headers ?? {});

  useEffect(() => {
    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/creator/${feature === "video_info" ? "video-info" : "shorts"}/config`, {
          headers: options?.headers,
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to load ${feature} config (${response.status})`);
        }
        const next = (await response.json()) as CreatorTextFeatureConfigResponse;
        setConfig(next);
      } catch (nextError) {
        if (!controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load creator feature config.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void run();
    return () => controller.abort();
  }, [feature, headersKey, options?.headers]);

  return useMemo(
    () => ({
      config,
      isLoading,
      error,
    }),
    [config, error, isLoading]
  );
}
