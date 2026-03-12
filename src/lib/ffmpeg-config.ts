export const FFMPEG_CORE_VERSION = "0.12.10";
export const FFMPEG_CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
export const FFMPEG_LOAD_TIMEOUT_MS = 45_000;

type FfmpegResolution = "720p" | "1080p" | "4K";

const FFMPEG_RENDER_STALL_TIMEOUT_MS: Record<FfmpegResolution, number> = {
  "720p": 90_000,
  "1080p": 120_000,
  "4K": 180_000,
};

export function getFfmpegRenderStallTimeoutMs(resolution: FfmpegResolution): number {
  return FFMPEG_RENDER_STALL_TIMEOUT_MS[resolution];
}
