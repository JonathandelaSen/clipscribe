import type { ComposerAssetRecord } from "@/lib/composer/types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const total = Math.floor(safe);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  const fraction = Math.round((safe - total) * 10);
  return `${minutes}:${String(secs).padStart(2, "0")}${fraction > 0 ? `.${fraction}` : ""}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 10 || power === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

export function assetLabel(asset: ComposerAssetRecord): string {
  return `${asset.type === "audio" ? "Audio" : "Video"} • ${formatTime(asset.durationSeconds)}`;
}

export function offsetToObjectPosition(offset = 0): string {
  return `${50 + clamp(offset, -100, 100) / 2}%`;
}

export function getTimelineTickStep(pixelsPerSecond: number): number {
  if (pixelsPerSecond >= 180) return 1;
  if (pixelsPerSecond >= 120) return 2;
  if (pixelsPerSecond >= 80) return 5;
  return 10;
}

export function buildTimelineTicks(durationSeconds: number, pixelsPerSecond: number): number[] {
  const step = getTimelineTickStep(pixelsPerSecond);
  const ceiling = Math.max(step, Math.ceil(durationSeconds / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= ceiling + 0.0001; value += step) {
    ticks.push(Number(value.toFixed(3)));
  }
  return ticks;
}

export function getTimelineCanvasWidth(durationSeconds: number, pixelsPerSecond: number): number {
  return Math.max(Math.ceil(durationSeconds * pixelsPerSecond) + 240, 1200);
}

export const composerPanelClass =
  "flex h-full min-h-0 flex-col rounded-[12px] border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";

export const composerInsetClass =
  "rounded-[10px] border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)]";

