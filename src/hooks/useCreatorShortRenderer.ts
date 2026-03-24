import { useState } from "react";
import type { CreatorShortRenderResponse } from "@/lib/creator/types";
import {
  requestSystemCreatorShortExport,
  type RequestSystemCreatorShortExportInput,
} from "@/lib/creator/system-export-client";

export function useCreatorShortRenderer() {
  const [lastRender, setLastRender] = useState<CreatorShortRenderResponse | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const renderShort = async (payload: RequestSystemCreatorShortExportInput) => {
    setIsRendering(true);
    setRenderError(null);
    try {
      const result = await requestSystemCreatorShortExport(payload);
      setLastRender(result.renderResponse);
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
