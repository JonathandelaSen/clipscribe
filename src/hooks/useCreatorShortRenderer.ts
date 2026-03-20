import { useState } from "react";
import type { CreatorShortRenderRequest, CreatorShortRenderResponse } from "@/lib/creator/types";
import { postJson } from "@/hooks/creator-api";

export function useCreatorShortRenderer() {
  const [lastRender, setLastRender] = useState<CreatorShortRenderResponse | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const renderShort = async (payload: CreatorShortRenderRequest) => {
    setIsRendering(true);
    setRenderError(null);
    try {
      const result = await postJson<CreatorShortRenderResponse>("/api/creator/shorts/render", payload);
      setLastRender(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render request failed";
      setRenderError(message);
      throw error;
    } finally {
      setIsRendering(false);
    }
  };

  return {
    lastRender,
    setLastRender,
    isRendering,
    renderError,
    renderShort,
  };
}
