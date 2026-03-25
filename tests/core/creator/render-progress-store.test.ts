import assert from "node:assert/strict";
import test from "node:test";

import {
  appendCreatorShortRenderProgress,
  completeCreatorShortRenderProgress,
  failCreatorShortRenderProgress,
  readCreatorShortRenderProgress,
  startCreatorShortRenderProgress,
} from "../../../src/lib/server/creator/shorts/render-progress-store";

test("render progress store returns incremental events by cursor", () => {
  const requestId = `render_progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  startCreatorShortRenderProgress(requestId, "Accepted by server.");
  appendCreatorShortRenderProgress(requestId, {
    stage: "setup",
    message: "Temp files prepared.",
  });
  appendCreatorShortRenderProgress(requestId, {
    stage: "ffmpeg",
    message: "Halfway there.",
    progressPct: 50,
    processedSeconds: 10,
    durationSeconds: 20,
  });

  const initialSnapshot = readCreatorShortRenderProgress(requestId);
  assert.equal(initialSnapshot.exists, true);
  assert.equal(initialSnapshot.status, "running");
  assert.equal(initialSnapshot.progressPct, 50);
  assert.equal(initialSnapshot.events.length, 3);
  assert.equal(initialSnapshot.events[0]?.stage, "accepted");
  assert.equal(initialSnapshot.events[2]?.progressPct, 50);

  const incrementalSnapshot = readCreatorShortRenderProgress(
    requestId,
    initialSnapshot.events[1]?.index ?? -1
  );
  assert.equal(incrementalSnapshot.events.length, 1);
  assert.equal(incrementalSnapshot.events[0]?.message, "Halfway there.");
});

test("render progress store tracks terminal completion and failures", () => {
  const completedRequestId = `render_progress_done_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  startCreatorShortRenderProgress(completedRequestId);
  completeCreatorShortRenderProgress(completedRequestId, "Render finished.");

  const completedSnapshot = readCreatorShortRenderProgress(completedRequestId);
  assert.equal(completedSnapshot.status, "completed");
  assert.equal(completedSnapshot.progressPct, 100);
  assert.equal(completedSnapshot.events[completedSnapshot.events.length - 1]?.stage, "completed");

  const failedRequestId = `render_progress_failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  startCreatorShortRenderProgress(failedRequestId);
  failCreatorShortRenderProgress(failedRequestId, "Renderer crashed.", "failed");

  const failedSnapshot = readCreatorShortRenderProgress(failedRequestId);
  assert.equal(failedSnapshot.status, "failed");
  assert.equal(failedSnapshot.errorMessage, "Renderer crashed.");
  assert.equal(failedSnapshot.events[failedSnapshot.events.length - 1]?.stage, "failed");
});
