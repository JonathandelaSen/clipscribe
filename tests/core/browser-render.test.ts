import test from "node:test";
import assert from "node:assert/strict";

import {
  BROWSER_RENDER_CANCELED_MESSAGE,
  createActiveBrowserRenderSession,
  isBrowserRenderCancelableStage,
  isBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
} from "../../src/lib/browser-render";

test("createActiveBrowserRenderSession starts in preparing stage", () => {
  const session = createActiveBrowserRenderSession(42);
  assert.equal(session.id, 42);
  assert.equal(session.stage, "preparing");
  assert.equal(session.controller.signal.aborted, false);
});

test("cancelable stages are limited to preparing and rendering", () => {
  assert.equal(isBrowserRenderCancelableStage("preparing"), true);
  assert.equal(isBrowserRenderCancelableStage("rendering"), true);
  assert.equal(isBrowserRenderCancelableStage("handoff"), false);
  assert.equal(isBrowserRenderCancelableStage("complete"), false);
});

test("cancellation helpers classify terminate and abort errors as user cancellation", () => {
  assert.equal(isBrowserRenderCanceledError(new Error("called FFmpeg.terminate()")), true);
  assert.equal(isBrowserRenderCanceledError(new DOMException("aborted", "AbortError")), true);
  assert.equal(isBrowserRenderCanceledError(new Error("boom")), false);
});

test("setBrowserRenderStage emits stage changes and respects aborted signals", () => {
  const seen: string[] = [];
  const controller = new AbortController();
  setBrowserRenderStage(
    {
      signal: controller.signal,
      onStageChange: (stage) => seen.push(stage),
    },
    "rendering"
  );
  assert.deepEqual(seen, ["rendering"]);

  controller.abort();
  assert.throws(() => throwIfBrowserRenderCanceled(controller.signal), new RegExp(BROWSER_RENDER_CANCELED_MESSAGE));
});
