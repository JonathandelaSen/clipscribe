"use client";

import { useEffect, useMemo, useState } from "react";

import { sanitizeCreatorProvider } from "@/lib/creator/ai";
import type { CreatorImageFeatureConfigResponse } from "@/lib/creator/types";

type UseCreatorImageFeatureConfigOptions = {
  headers?: HeadersInit;
  provider?: string;
};

export function useCreatorImageFeatureConfig(options?: UseCreatorImageFeatureConfigOptions) {
  const [config, setConfig] = useState<CreatorImageFeatureConfigResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const headersKey = JSON.stringify(options?.headers ?? {});
  const provider = sanitizeCreatorProvider(options?.provider);

  useEffect(() => {
    const controller = new AbortController();

    async function run() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (provider) {
          params.set("provider", provider);
        }
        const response = await fetch(`/api/creator/images/config${params.size ? `?${params.toString()}` : ""}`, {
          headers: options?.headers,
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to load image config (${response.status})`);
        }
        setConfig((await response.json()) as CreatorImageFeatureConfigResponse);
      } catch (nextError) {
        if (!controller.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load creator image config.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void run();
    return () => controller.abort();
  }, [headersKey, options?.headers, provider]);

  return useMemo(
    () => ({
      config,
      isLoading,
      error,
    }),
    [config, error, isLoading]
  );
}
