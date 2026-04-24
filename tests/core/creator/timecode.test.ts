import test from "node:test";
import assert from "node:assert/strict";

import {
  applyClipRelativeTimingAction,
  createClipRelativeTimingFromPlayheadToEnd,
  formatShortTimecode,
  parseShortTimecode,
} from "../../../src/lib/creator/core/timecode";

test("formatShortTimecode renders minute-based shorts timecodes with tenths", () => {
  assert.equal(formatShortTimecode(5), "0:05.0");
  assert.equal(formatShortTimecode(83.44), "1:23.4");
  assert.equal(formatShortTimecode(3723.2), "62:03.2");
  assert.equal(formatShortTimecode(59.96), "1:00.0");
});

test("parseShortTimecode reads MM:SS.s inputs", () => {
  assert.equal(parseShortTimecode("0:05.0"), 5);
  assert.equal(parseShortTimecode("1:23.4"), 83.4);
  assert.equal(parseShortTimecode("62:03.2"), 3723.2);
  assert.equal(parseShortTimecode("1:2"), 62);
});

test("parseShortTimecode treats bare numbers as minutes and explicit s as seconds", () => {
  assert.equal(parseShortTimecode("1.5"), 90);
  assert.equal(parseShortTimecode("90s"), 90);
  assert.equal(parseShortTimecode("90.25s"), 90.3);
});

test("parseShortTimecode rejects malformed or negative inputs", () => {
  assert.equal(parseShortTimecode(""), null);
  assert.equal(parseShortTimecode("-1:00"), null);
  assert.equal(parseShortTimecode("1:60"), null);
  assert.equal(parseShortTimecode("1:02:03"), null);
  assert.equal(parseShortTimecode("abc"), null);
});

test("createClipRelativeTimingFromPlayheadToEnd keeps new overlays visible until clip end", () => {
  assert.deepEqual(
    createClipRelativeTimingFromPlayheadToEnd({
      clipDurationSeconds: 20,
      playheadOffsetSeconds: 8.2,
      minDurationSeconds: 1.4,
    }),
    { startOffsetSeconds: 8.2, durationSeconds: 11.8 }
  );

  assert.deepEqual(
    createClipRelativeTimingFromPlayheadToEnd({
      clipDurationSeconds: 20,
      playheadOffsetSeconds: 19.6,
      minDurationSeconds: 1.4,
    }),
    { startOffsetSeconds: 18.6, durationSeconds: 1.4 }
  );
});

test("applyClipRelativeTimingAction supports common overlay timing buttons", () => {
  const current = { startOffsetSeconds: 5, durationSeconds: 3 };

  assert.deepEqual(
    applyClipRelativeTimingAction({
      action: "until_end",
      current,
      clipDurationSeconds: 20,
      playheadOffsetSeconds: 12,
    }),
    { startOffsetSeconds: 5, durationSeconds: 15 }
  );

  assert.deepEqual(
    applyClipRelativeTimingAction({
      action: "full_clip",
      current,
      clipDurationSeconds: 20,
      playheadOffsetSeconds: 12,
    }),
    { startOffsetSeconds: 0, durationSeconds: 20 }
  );

  assert.deepEqual(
    applyClipRelativeTimingAction({
      action: "end_at_playhead",
      current,
      clipDurationSeconds: 20,
      playheadOffsetSeconds: 7.5,
    }),
    { startOffsetSeconds: 5, durationSeconds: 2.5 }
  );
});
