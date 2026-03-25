import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCreatorShortSourcePlaybackProfile,
} from "../../../src/lib/server/creator/shorts/source-playback-profile";

test("classifyCreatorShortSourcePlaybackProfile detects still-video sources with single-frame video and long audio", () => {
  const profile = classifyCreatorShortSourcePlaybackProfile({
    hasVideo: true,
    hasAudio: true,
    videoDurationSeconds: 0.04,
    audioDurationSeconds: 914.38,
    videoFrameCount: 1,
  });

  assert.equal(profile.mode, "still");
  assert.equal(profile.videoFrameCount, 1);
});

test("classifyCreatorShortSourcePlaybackProfile keeps normal videos on the regular path", () => {
  const profile = classifyCreatorShortSourcePlaybackProfile({
    hasVideo: true,
    hasAudio: true,
    videoDurationSeconds: 914.38,
    audioDurationSeconds: 914.38,
    videoFrameCount: 27_431,
  });

  assert.equal(profile.mode, "normal");
});

test("classifyCreatorShortSourcePlaybackProfile treats silent single-frame assets as still-video", () => {
  const profile = classifyCreatorShortSourcePlaybackProfile({
    hasVideo: true,
    hasAudio: false,
    videoDurationSeconds: 0.03,
    videoFrameCount: 1,
  });

  assert.equal(profile.mode, "still");
});
