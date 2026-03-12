export type BrowserRenderStage = "preparing" | "rendering" | "handoff" | "complete";

export interface BrowserRenderLifecycle {
  signal?: AbortSignal;
  onStageChange?: (stage: BrowserRenderStage) => void;
}

export interface ActiveBrowserRenderSession {
  id: number;
  stage: BrowserRenderStage;
  controller: AbortController;
}

export const BROWSER_RENDER_CANCELED_MESSAGE = "Browser render canceled.";

export class BrowserRenderCanceledError extends Error {
  constructor(message = BROWSER_RENDER_CANCELED_MESSAGE) {
    super(message);
    this.name = "BrowserRenderCanceledError";
  }
}

export function createActiveBrowserRenderSession(id: number): ActiveBrowserRenderSession {
  return {
    id,
    stage: "preparing",
    controller: new AbortController(),
  };
}

export function createBrowserRenderCanceledError(message = BROWSER_RENDER_CANCELED_MESSAGE) {
  return new BrowserRenderCanceledError(message);
}

export function throwIfBrowserRenderCanceled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createBrowserRenderCanceledError();
  }
}

export function isBrowserRenderCanceledError(error: unknown): boolean {
  if (error instanceof BrowserRenderCanceledError) {
    return true;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return message === "called FFmpeg.terminate()" || message === BROWSER_RENDER_CANCELED_MESSAGE;
}

export function setBrowserRenderStage(
  lifecycle: BrowserRenderLifecycle | undefined,
  stage: BrowserRenderStage
) {
  throwIfBrowserRenderCanceled(lifecycle?.signal);
  lifecycle?.onStageChange?.(stage);
  throwIfBrowserRenderCanceled(lifecycle?.signal);
}

export function isBrowserRenderCancelableStage(stage: BrowserRenderStage) {
  return stage === "preparing" || stage === "rendering";
}
