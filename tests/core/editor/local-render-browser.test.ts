import test from "node:test";
import assert from "node:assert/strict";

import {
  getBrowserRenderProfile,
  getRetryBrowserRenderProfile,
} from "../../../src/lib/editor/local-render-segments";

test("getRetryBrowserRenderProfile escalates diagnostic browser render failures once", () => {
  const retryProfile = getRetryBrowserRenderProfile({
    error: new Error(
      [
        "FFmpeg render failed: Too many packets buffered for output stream 0:1.",
        "resolution=720p, clipCount=5, durationSeconds=900.000, timeoutMode=none, exitCode=1",
      ].join("\n")
    ),
    currentProfile: getBrowserRenderProfile("low"),
  });

  assert.equal(retryProfile?.name, "medium");
});

test("getRetryBrowserRenderProfile does not retry non-diagnostic browser errors", () => {
  const retryProfile = getRetryBrowserRenderProfile({
    error: new Error("Rendered output is empty."),
    currentProfile: getBrowserRenderProfile("low"),
  });

  assert.equal(retryProfile, null);
});

test("getRetryBrowserRenderProfile does not retry beyond the extreme browser tier", () => {
  const retryProfile = getRetryBrowserRenderProfile({
    error: new Error(
      [
        "FFmpeg timed out while rendering.",
        "resolution=4K, clipCount=2, durationSeconds=120.000, timeoutMode=stall, exitCode=1",
      ].join("\n")
    ),
    currentProfile: getBrowserRenderProfile("extreme"),
  });

  assert.equal(retryProfile, null);
});
