import test from "node:test";
import assert from "node:assert/strict";

import { getFfmpegRenderStallTimeoutMs } from "../../../src/lib/ffmpeg-config";
import {
  buildEditorFfmpegExecErrorMessage,
  createEditorFfmpegActivityWatchdog,
  getEditorFfmpegFailureHeadline,
  runEditorFfmpegExec,
} from "../../../src/lib/editor/local-render-runtime";

function createIntervalHarness() {
  let nowMs = 0;
  let nextTimerId = 1;
  const timers = new Map<number, { callback: () => void; intervalMs: number; nextRunAt: number }>();

  const flushTimersUntil = (targetMs: number) => {
    while (true) {
      let nextDueId: number | null = null;
      let nextDueAt = Number.POSITIVE_INFINITY;

      for (const [timerId, timer] of timers) {
        if (timer.nextRunAt <= targetMs && timer.nextRunAt < nextDueAt) {
          nextDueId = timerId;
          nextDueAt = timer.nextRunAt;
        }
      }

      if (nextDueId == null) break;
      nowMs = nextDueAt;
      const timer = timers.get(nextDueId);
      if (!timer) continue;
      timer.callback();
      const activeTimer = timers.get(nextDueId);
      if (activeTimer) {
        activeTimer.nextRunAt += activeTimer.intervalMs;
      }
    }

    nowMs = targetMs;
  };

  return {
    now: () => nowMs,
    advanceBy: (durationMs: number) => {
      flushTimersUntil(nowMs + durationMs);
    },
    setIntervalFn: (callback: () => void, intervalMs: number) => {
      const timerId = nextTimerId++;
      timers.set(timerId, {
        callback,
        intervalMs,
        nextRunAt: nowMs + intervalMs,
      });
      return timerId as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: (handle: ReturnType<typeof setInterval>) => {
      timers.delete(handle as unknown as number);
    },
  };
}

test("getFfmpegRenderStallTimeoutMs returns deterministic resolution-based budgets", () => {
  assert.equal(getFfmpegRenderStallTimeoutMs("720p"), 90_000);
  assert.equal(getFfmpegRenderStallTimeoutMs("1080p"), 120_000);
  assert.equal(getFfmpegRenderStallTimeoutMs("4K"), 180_000);
});

test("buildEditorFfmpegExecErrorMessage includes timeout mode, diagnostics, and log tail", () => {
  const message = buildEditorFfmpegExecErrorMessage({
    rawMessage: "FFmpeg timed out while rendering.",
    timeoutMode: "stall",
    stallTimeoutMs: 120_000,
    exitCode: 1,
    resolution: "1080p",
    clipCount: 2,
    durationSeconds: 12.5,
    logTail: ["frame=42", "time=00:00:04.20"],
    logHighlights: ["Too many packets buffered for output stream 0:1."],
    audioItemCount: 1,
    subtitleFrameCount: 7,
  });

  assert.match(message, /resolution=1080p/);
  assert.match(message, /clipCount=2/);
  assert.match(message, /durationSeconds=12\.500/);
  assert.match(message, /timeoutMode=stall/);
  assert.match(message, /stallTimeoutMs=120000/);
  assert.match(message, /audioItemCount=1/);
  assert.match(message, /subtitleFrameCount=7/);
  assert.match(message, /exitCode=1/);
  assert.match(message, /ffmpeg-log-highlights:/);
  assert.match(message, /Too many packets buffered/);
  assert.match(message, /ffmpeg-log-tail:/);
});

test("getEditorFfmpegFailureHeadline prefers saved fatal highlights over generic tail lines", () => {
  const headline = getEditorFfmpegFailureHeadline({
    exitCode: 1,
    logHighlights: ["Too many packets buffered for output stream 0:1."],
    logTail: [
      "[libx264 @ 0x1] kb/s:3065.30",
      "Conversion failed!",
      "[Parsed_overlay_0 @ 0x2] Failed to configure input pad on Parsed_overlay_0",
      "Aborted()",
    ],
  });

  assert.equal(headline, "FFmpeg render failed: Too many packets buffered for output stream 0:1.");
});

test("createEditorFfmpegActivityWatchdog keeps the render alive when progress activity continues", () => {
  const harness = createIntervalHarness();
  let stallCalls = 0;
  const watchdog = createEditorFfmpegActivityWatchdog({
    stallTimeoutMs: 5_000,
    pollIntervalMs: 1_000,
    now: harness.now,
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    onStall: () => {
      stallCalls += 1;
    },
  });

  watchdog.start();
  harness.advanceBy(4_000);
  watchdog.markActivity();
  harness.advanceBy(4_000);
  watchdog.markActivity();
  harness.advanceBy(4_000);
  watchdog.stop();

  assert.equal(stallCalls, 0);
  assert.equal(watchdog.didStall, false);
});

test("createEditorFfmpegActivityWatchdog also accepts log-only activity", () => {
  const harness = createIntervalHarness();
  let stallCalls = 0;
  const watchdog = createEditorFfmpegActivityWatchdog({
    stallTimeoutMs: 5_000,
    pollIntervalMs: 1_000,
    now: harness.now,
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    onStall: () => {
      stallCalls += 1;
    },
  });

  watchdog.start();
  harness.advanceBy(3_000);
  watchdog.markActivity();
  harness.advanceBy(3_000);
  watchdog.markActivity();
  harness.advanceBy(3_000);
  watchdog.stop();

  assert.equal(stallCalls, 0);
  assert.equal(watchdog.didStall, false);
});

test("createEditorFfmpegActivityWatchdog trips once after total inactivity", () => {
  const harness = createIntervalHarness();
  let stallCalls = 0;
  const watchdog = createEditorFfmpegActivityWatchdog({
    stallTimeoutMs: 5_000,
    pollIntervalMs: 1_000,
    now: harness.now,
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    onStall: () => {
      stallCalls += 1;
    },
  });

  watchdog.start();
  harness.advanceBy(5_000);
  harness.advanceBy(5_000);

  assert.equal(stallCalls, 1);
  assert.equal(watchdog.didStall, true);
});

test("runEditorFfmpegExec uses indefinite ff.exec timeouts instead of a wall-clock render cap", async () => {
  let receivedTimeout: number | undefined;

  await runEditorFfmpegExec({
    ff: {
      async exec(_args, timeout) {
        receivedTimeout = timeout;
        return 0;
      },
    },
    args: ["-i", "a.mp4", "out.mp4"],
    resolution: "1080p",
    clipCount: 59,
    durationSeconds: 936.51,
    logTail: [],
  });

  assert.equal(receivedTimeout, -1);
});

test("runEditorFfmpegExec turns watchdog stalls into detailed timeout errors without double-resetting FFmpeg", async () => {
  const harness = createIntervalHarness();
  let resetCalls = 0;
  let rejectExec: ((error: Error) => void) | null = null;
  const activityWatchdog = createEditorFfmpegActivityWatchdog({
    stallTimeoutMs: 5_000,
    pollIntervalMs: 1_000,
    now: harness.now,
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    onStall: () => {
      resetCalls += 1;
      rejectExec?.(new Error("called FFmpeg.terminate()"));
    },
  });

  const runPromise = assert.rejects(
    () =>
      runEditorFfmpegExec({
        ff: {
          async exec(_args, timeout) {
            assert.equal(timeout, -1);
            return new Promise<number>((_resolve, reject) => {
              rejectExec = reject;
            });
          },
        },
        args: ["-i", "a.mp4", "out.mp4"],
        resolution: "1080p",
        clipCount: 59,
        durationSeconds: 936.51,
        logTail: ["time=00:00:03.40"],
        audioItemCount: 1,
        subtitleFrameCount: 12,
        activityWatchdog,
        resetFfmpeg: () => {
          resetCalls += 1;
        },
      }),
    (error) => {
      assert.equal(resetCalls, 1);
      assert.match(String(error), /FFmpeg timed out while rendering/);
      assert.match(String(error), /timeoutMode=stall/);
      assert.match(String(error), /stallTimeoutMs=5000/);
      assert.match(String(error), /audioItemCount=1/);
      assert.match(String(error), /subtitleFrameCount=12/);
      return true;
    }
  );

  harness.advanceBy(5_000);
  await runPromise;
});

test("runEditorFfmpegExec turns non-zero exit codes into generic detailed errors and resets FFmpeg", async () => {
  let resetCalls = 0;

  await assert.rejects(
    () =>
      runEditorFfmpegExec({
        ff: {
          async exec(_args, timeout) {
            assert.equal(timeout, -1);
            return 137;
          },
        },
        args: ["-i", "a.mp4", "out.mp4"],
        resolution: "4K",
        clipCount: 2,
        durationSeconds: 18,
        logTail: ["error while decoding stream #0:0"],
        resetFfmpeg: () => {
          resetCalls += 1;
        },
      }),
    (error) => {
      assert.equal(resetCalls, 1);
      assert.match(String(error), /FFmpeg render failed: error while decoding stream #0:0/);
      assert.match(String(error), /timeoutMode=none/);
      assert.doesNotMatch(String(error), /FFmpeg timed out while rendering/);
      return true;
    }
  );
});

test("runEditorFfmpegExec surfaces user cancellation without resetting FFmpeg again", async () => {
  let resetCalls = 0;

  await assert.rejects(
    () =>
      runEditorFfmpegExec({
        ff: {
          async exec() {
            throw new Error("called FFmpeg.terminate()");
          },
        },
        args: ["-i", "a.mp4", "out.mp4"],
        resolution: "1080p",
        clipCount: 1,
        durationSeconds: 8,
        logTail: [],
        resetFfmpeg: () => {
          resetCalls += 1;
        },
      }),
    (error) => {
      assert.equal(resetCalls, 0);
      assert.match(String(error), /Browser render canceled/);
      return true;
    }
  );
});
