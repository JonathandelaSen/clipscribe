import test from "node:test";
import assert from "node:assert/strict";

import { getFfmpegExecTimeoutMs } from "../../../src/lib/ffmpeg-config";
import {
  buildEditorFfmpegExecErrorMessage,
  runEditorFfmpegExec,
} from "../../../src/lib/editor/local-render-runtime";

test("getFfmpegExecTimeoutMs returns deterministic resolution-based budgets", () => {
  assert.equal(getFfmpegExecTimeoutMs("720p", 10), 160_000);
  assert.equal(getFfmpegExecTimeoutMs("1080p", 10), 210_000);
  assert.equal(getFfmpegExecTimeoutMs("4K", 10), 340_000);
  assert.equal(getFfmpegExecTimeoutMs("4K", 100), 600_000);
});

test("buildEditorFfmpegExecErrorMessage includes diagnostics and log tail", () => {
  const message = buildEditorFfmpegExecErrorMessage({
    rawMessage: "FFmpeg timed out while rendering.",
    timeoutMs: 180_000,
    exitCode: 1,
    resolution: "1080p",
    clipCount: 2,
    durationSeconds: 12.5,
    logTail: ["frame=42", "time=00:00:04.20"],
  });

  assert.match(message, /resolution=1080p/);
  assert.match(message, /clipCount=2/);
  assert.match(message, /durationSeconds=12\.500/);
  assert.match(message, /timeoutMs=180000/);
  assert.match(message, /exitCode=1/);
  assert.match(message, /ffmpeg-log-tail:/);
});

test("runEditorFfmpegExec turns timeout exit codes into detailed errors and resets FFmpeg", async () => {
  let resetCalls = 0;

  await assert.rejects(
    () =>
      runEditorFfmpegExec({
        ff: {
          async exec() {
            return 1;
          },
        },
        args: ["-i", "a.mp4", "out.mp4"],
        timeoutMs: 180_000,
        resolution: "1080p",
        clipCount: 2,
        durationSeconds: 12.5,
        logTail: ["time=00:00:03.40"],
        resetFfmpeg: () => {
          resetCalls += 1;
        },
      }),
    (error) => {
      assert.equal(resetCalls, 1);
      assert.match(String(error), /FFmpeg timed out while rendering/);
      assert.match(String(error), /resolution=1080p/);
      assert.match(String(error), /clipCount=2/);
      return true;
    }
  );
});

test("runEditorFfmpegExec turns non-zero exit codes into detailed errors and resets FFmpeg", async () => {
  let resetCalls = 0;

  await assert.rejects(
    () =>
      runEditorFfmpegExec({
        ff: {
          async exec() {
            return 137;
          },
        },
        args: ["-i", "a.mp4", "out.mp4"],
        timeoutMs: 240_000,
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
      assert.match(String(error), /FFmpeg exited with code 137/);
      assert.match(String(error), /resolution=4K/);
      assert.match(String(error), /timeoutMs=240000/);
      return true;
    }
  );
});
