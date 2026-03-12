export const FFMPEG_CORE_VERSION = "0.12.10";
export const FFMPEG_CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
export const FFMPEG_LOAD_TIMEOUT_MS = 45_000;

type FfmpegResolution = "720p" | "1080p" | "4K";

const FFMPEG_EXEC_TIMEOUT_BASE_MS: Record<FfmpegResolution, number> = {
  "720p": 120_000,
  "1080p": 150_000,
  "4K": 240_000,
};

const FFMPEG_EXEC_TIMEOUT_PER_SECOND_MS: Record<FfmpegResolution, number> = {
  "720p": 4_000,
  "1080p": 6_000,
  "4K": 10_000,
};

const FFMPEG_EXEC_TIMEOUT_CAP_MS = 600_000;

export function getFfmpegExecTimeoutMs(resolution: FfmpegResolution, durationSeconds: number): number {
  const safeDurationSeconds = Math.max(0, Number(durationSeconds) || 0);
  const timeoutMs =
    FFMPEG_EXEC_TIMEOUT_BASE_MS[resolution] +
    safeDurationSeconds * FFMPEG_EXEC_TIMEOUT_PER_SECOND_MS[resolution];

  return Math.min(FFMPEG_EXEC_TIMEOUT_CAP_MS, Math.round(timeoutMs));
}
