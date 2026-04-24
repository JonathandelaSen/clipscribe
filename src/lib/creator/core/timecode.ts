export interface ClipRelativeTimingWindow {
  startOffsetSeconds: number;
  durationSeconds: number;
}

export type ClipRelativeTimingAction =
  | "start_at_clip_start"
  | "start_at_playhead"
  | "end_at_playhead"
  | "until_end"
  | "full_clip";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function safeNonNegativeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function formatShortTimecode(totalSeconds: number): string {
  const totalTenths = Math.round(safeNonNegativeNumber(totalSeconds) * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secondsTenths = totalTenths % 600;
  const seconds = Math.floor(secondsTenths / 10);
  const tenths = secondsTenths % 10;

  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export function parseShortTimecode(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;

  const secondsMatch = raw.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (secondsMatch) {
    return round1(Number(secondsMatch[1]));
  }

  if (raw.includes(":")) {
    const parts = raw.split(":");
    if (parts.length !== 2) return null;
    const [minutesRaw, secondsRaw] = parts;
    if (!/^\d+$/.test(minutesRaw) || !/^\d{1,2}(?:\.\d+)?$/.test(secondsRaw)) return null;

    const minutes = Number(minutesRaw);
    const seconds = Number(secondsRaw);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
    return round1(minutes * 60 + seconds);
  }

  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  return round1(Number(raw) * 60);
}

export function applyClipRelativeTimingAction(input: {
  action: ClipRelativeTimingAction;
  current: ClipRelativeTimingWindow;
  clipDurationSeconds: number;
  playheadOffsetSeconds: number;
  minDurationSeconds?: number;
}): ClipRelativeTimingWindow {
  const clipDuration = round1(safeNonNegativeNumber(input.clipDurationSeconds));
  if (clipDuration <= 0) {
    return { startOffsetSeconds: 0, durationSeconds: 0 };
  }

  const minDuration = Math.min(
    clipDuration,
    Math.max(0.1, round1(safeNonNegativeNumber(input.minDurationSeconds ?? 0.2, 0.2)))
  );
  const currentStart = clamp(round1(safeNonNegativeNumber(input.current.startOffsetSeconds)), 0, Math.max(0, clipDuration - minDuration));
  const currentDuration = clamp(
    round1(safeNonNegativeNumber(input.current.durationSeconds, minDuration)),
    minDuration,
    clipDuration - currentStart
  );
  const playhead = clamp(round1(safeNonNegativeNumber(input.playheadOffsetSeconds)), 0, clipDuration);

  if (input.action === "full_clip") {
    return { startOffsetSeconds: 0, durationSeconds: clipDuration };
  }

  if (input.action === "until_end") {
    return {
      startOffsetSeconds: currentStart,
      durationSeconds: round1(clipDuration - currentStart),
    };
  }

  if (input.action === "start_at_clip_start") {
    return {
      startOffsetSeconds: 0,
      durationSeconds: Math.min(currentDuration, clipDuration),
    };
  }

  if (input.action === "start_at_playhead") {
    const nextStart = clamp(playhead, 0, Math.max(0, clipDuration - minDuration));
    return {
      startOffsetSeconds: nextStart,
      durationSeconds: clamp(currentDuration, minDuration, clipDuration - nextStart),
    };
  }

  const nextEnd = clamp(playhead, minDuration, clipDuration);
  const nextStart = Math.min(currentStart, Math.max(0, nextEnd - minDuration));
  return {
    startOffsetSeconds: nextStart,
    durationSeconds: round1(nextEnd - nextStart),
  };
}

export function createClipRelativeTimingFromPlayheadToEnd(input: {
  clipDurationSeconds: number;
  playheadOffsetSeconds: number;
  minDurationSeconds?: number;
}): ClipRelativeTimingWindow {
  const clipDuration = round1(safeNonNegativeNumber(input.clipDurationSeconds));
  if (clipDuration <= 0) {
    return { startOffsetSeconds: 0, durationSeconds: 0 };
  }

  const minDuration = Math.min(
    clipDuration,
    Math.max(0.1, round1(safeNonNegativeNumber(input.minDurationSeconds ?? 0.2, 0.2)))
  );
  const startOffsetSeconds = clamp(
    round1(safeNonNegativeNumber(input.playheadOffsetSeconds)),
    0,
    Math.max(0, clipDuration - minDuration)
  );

  return {
    startOffsetSeconds,
    durationSeconds: round1(clipDuration - startOffsetSeconds),
  };
}
