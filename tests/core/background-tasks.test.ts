import test from "node:test";
import assert from "node:assert/strict";

import { backgroundTaskReducer, getTaskForResource, isBackgroundTaskActive } from "../../src/lib/background-tasks/core";
import type { BackgroundTaskRecord } from "../../src/lib/background-tasks/types";

function buildTask(overrides: Partial<BackgroundTaskRecord> = {}): BackgroundTaskRecord {
  return {
    id: overrides.id ?? "task_1",
    kind: overrides.kind ?? "transcription",
    title: overrides.title ?? "Task",
    message: overrides.message,
    status: overrides.status ?? "queued",
    progress: overrides.progress ?? 0,
    canCancel: overrides.canCancel ?? true,
    scope: overrides.scope ?? { projectId: "proj_1", assetId: "asset_1" },
    startedAt: overrides.startedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    completedAt: overrides.completedAt,
    error: overrides.error,
  };
}

test("backgroundTaskReducer enqueues, patches, and completes tasks", () => {
  let tasks = backgroundTaskReducer([], {
    type: "enqueue",
    task: buildTask(),
  });

  tasks = backgroundTaskReducer(tasks, {
    type: "patch",
    taskId: "task_1",
    now: 5,
    patch: {
      status: "running",
      progress: 45,
      message: "Working",
    },
  });

  tasks = backgroundTaskReducer(tasks, {
    type: "complete",
    taskId: "task_1",
    now: 8,
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "completed");
  assert.equal(tasks[0].progress, 100);
  assert.equal(tasks[0].completedAt, 8);
  assert.equal(tasks[0].canCancel, false);
});

test("backgroundTaskReducer marks failure and supports dismissal", () => {
  let tasks = [buildTask({ id: "task_fail", kind: "timeline-export", scope: { projectId: "proj_2" } })];

  tasks = backgroundTaskReducer(tasks, {
    type: "fail",
    taskId: "task_fail",
    now: 10,
    error: "Render failed",
  });

  assert.equal(tasks[0].status, "failed");
  assert.equal(tasks[0].error, "Render failed");

  tasks = backgroundTaskReducer(tasks, {
    type: "dismiss",
    taskId: "task_fail",
  });

  assert.equal(tasks.length, 0);
});

test("getTaskForResource prefers active task matches before recent history", () => {
  const completed = buildTask({
    id: "task_old",
    kind: "timeline-export",
    scope: { projectId: "proj_1" },
    status: "completed",
    completedAt: 10,
    updatedAt: 10,
  });
  const running = buildTask({
    id: "task_live",
    kind: "timeline-export",
    scope: { projectId: "proj_1" },
    status: "running",
    progress: 52,
    updatedAt: 20,
  });

  const match = getTaskForResource([completed, running], {
    kind: "timeline-export",
    projectId: "proj_1",
  });

  assert.equal(match?.id, "task_live");
  assert.equal(isBackgroundTaskActive(match!), true);
});

test("backgroundTaskReducer marks cancellation as non-active", () => {
  const tasks = backgroundTaskReducer([buildTask({ id: "task_cancel", kind: "timeline-bake" })], {
    type: "cancel",
    taskId: "task_cancel",
    now: 12,
    patch: {
      message: "Canceled by user",
    },
  });

  assert.equal(tasks[0].status, "canceled");
  assert.equal(tasks[0].message, "Canceled by user");
  assert.equal(isBackgroundTaskActive(tasks[0]), false);
});
