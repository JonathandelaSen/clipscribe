import assert from "node:assert/strict";
import test from "node:test";

import { selectCreatorVideoEncoderFromFfmpegOutput } from "../../../src/lib/server/creator/shorts/encoder-policy";

test("selectCreatorVideoEncoderFromFfmpegOutput prefers videotoolbox when available", () => {
  const selection = selectCreatorVideoEncoderFromFfmpegOutput(`
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D libx264             libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
`);

  assert.equal(selection.encoderUsed, "h264_videotoolbox");
  assert.equal(selection.isHardwareAccelerated, true);
  assert.deepEqual(selection.outputArgs.slice(0, 2), ["-c:v", "h264_videotoolbox"]);
});

test("selectCreatorVideoEncoderFromFfmpegOutput falls back to libx264 when hardware encode is unavailable", () => {
  const selection = selectCreatorVideoEncoderFromFfmpegOutput(`
 V....D libx264             libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
`);

  assert.equal(selection.encoderUsed, "libx264");
  assert.equal(selection.isHardwareAccelerated, false);
  assert.deepEqual(selection.outputArgs.slice(0, 4), ["-c:v", "libx264", "-preset", "veryfast"]);
});
