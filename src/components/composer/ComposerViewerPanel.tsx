"use client";

import { Pause, Play, RotateCcw, Volume2, Waves } from "lucide-react";

import type { ComposerAssetRecord, ComposerQuality, ComposerRatio, ComposerTimelineItem } from "@/lib/composer/types";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  composerInsetClass,
  composerPanelClass,
  formatTime,
  offsetToObjectPosition,
} from "@/components/composer/utils";

interface ComposerViewerPanelProps {
  previewVideoRef: React.RefObject<HTMLVideoElement | null>;
  previewAudioRef: React.RefObject<HTMLAudioElement | null>;
  activeVideoObjectUrl: string | null;
  activeVideoItem: ComposerTimelineItem | undefined;
  activeVideoAsset: ComposerAssetRecord | null;
  activeAudioItem: ComposerTimelineItem | undefined;
  activeAudioAsset: ComposerAssetRecord | null;
  exportRatio: ComposerRatio;
  exportQuality: ComposerQuality;
  currentTimeSeconds: number;
  projectDurationSeconds: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onResetPlayhead: () => void;
  onSeek: (value: number) => void;
  scrubStepSeconds: number;
  timelineItemCount: number;
}

export function ComposerViewerPanel({
  previewVideoRef,
  previewAudioRef,
  activeVideoObjectUrl,
  activeVideoItem,
  activeVideoAsset,
  activeAudioItem,
  activeAudioAsset,
  exportRatio,
  exportQuality,
  currentTimeSeconds,
  projectDurationSeconds,
  isPlaying,
  onTogglePlay,
  onResetPlayhead,
  onSeek,
  scrubStepSeconds,
  timelineItemCount,
}: ComposerViewerPanelProps) {
  return (
    <section data-testid="composer-viewer-panel" className={`${composerPanelClass} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-[color:var(--composer-border)] px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--composer-muted)]">
            Program Monitor
          </div>
          <div className="mt-1 text-sm font-medium text-[color:var(--composer-text)]">
            Output preview
          </div>
        </div>
        <div className="composer-ui-mono rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
          {exportRatio} • {exportQuality}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <div className={`${composerInsetClass} flex min-h-0 flex-1 flex-col overflow-hidden`}>
          <div className="border-b border-[color:var(--composer-border)] px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
            Program
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-[10px] border border-[color:var(--composer-border)] bg-[#090b0d]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_52%)]" />
              <div className="relative aspect-video w-full max-w-full rounded-[8px] border border-[color:var(--composer-border)] bg-black shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="absolute inset-0 flex items-center justify-center bg-[#030405]">
                  <div
                    className={[
                      "relative max-h-[88%] overflow-hidden border border-white/6 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.02)]",
                      exportRatio === "9:16" ? "aspect-[9/16] h-[88%]" : "",
                      exportRatio === "1:1" ? "aspect-square h-[80%]" : "",
                      exportRatio === "16:9" ? "aspect-video h-[72%] w-[88%]" : "",
                    ].join(" ")}
                  >
                    {activeVideoObjectUrl ? (
                      <video
                        ref={previewVideoRef}
                        className="absolute inset-0 h-full w-full"
                        playsInline
                        preload="auto"
                        style={{
                          objectFit: activeVideoItem?.fitMode === "fit" ? "contain" : "cover",
                          objectPosition: `${offsetToObjectPosition(activeVideoItem?.offsetX)} ${offsetToObjectPosition(activeVideoItem?.offsetY)}`,
                        }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                        <div>
                          <div className="text-sm font-medium text-[color:var(--composer-text)]">
                            {timelineItemCount === 0 ? "Import media to begin editing" : "No visible video at this timecode"}
                          </div>
                          <div className="mt-1 text-xs text-[color:var(--composer-muted)]">
                            {timelineItemCount === 0
                              ? "The viewer will show your composition here."
                              : "The export will hold black frames until the next visible clip."}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
                  <span className="rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/60">
                    Live
                  </span>
                  {activeVideoAsset ? (
                    <span className="rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/60">
                      {activeVideoAsset.filename}
                    </span>
                  ) : null}
                </div>

                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2">
                  <span className="composer-ui-mono rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/70">
                    {formatTime(currentTimeSeconds)}
                  </span>
                  {activeAudioAsset ? (
                    <span className="rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white/60">
                      <Volume2 className="mr-1 inline size-3" />
                      {activeAudioAsset.filename}
                    </span>
                  ) : null}
                </div>
              </div>
              <audio ref={previewAudioRef} preload="auto" />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className={`${composerInsetClass} px-3 py-3`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={onTogglePlay}
                    className="h-9 border border-[#8f6a2b] bg-[color:var(--composer-accent)] px-3 text-black hover:bg-[#ffbc5c]"
                    disabled={projectDurationSeconds <= 0}
                  >
                    {isPlaying ? <Pause className="mr-2 size-4" /> : <Play className="mr-2 size-4" />}
                    {isPlaying ? "Pause" : "Play"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-9 border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
                    onClick={onResetPlayhead}
                  >
                    <RotateCcw className="mr-2 size-4" />
                    Reset
                  </Button>
                  <div className="composer-ui-mono ml-auto text-sm text-[color:var(--composer-text)]">
                    {formatTime(currentTimeSeconds)} / {formatTime(projectDurationSeconds)}
                  </div>
                </div>
                <div className="mt-3">
                  <Slider
                    value={[currentTimeSeconds]}
                    min={0}
                    max={Math.max(projectDurationSeconds, 1)}
                    step={scrubStepSeconds}
                    onValueChange={(value) => onSeek(value[0] ?? 0)}
                  />
                </div>
              </div>

              <div className={`${composerInsetClass} grid min-w-[220px] gap-2 px-3 py-3`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[color:var(--composer-muted)]">Visible clip</span>
                  <span className="truncate text-[color:var(--composer-text)]">
                    {activeVideoAsset?.filename ?? "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[color:var(--composer-muted)]">Audio clip</span>
                  <span className="truncate text-[color:var(--composer-text)]">
                    {activeAudioAsset?.filename ?? "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[color:var(--composer-muted)]">Audio state</span>
                  <span className="inline-flex items-center gap-1 text-[color:var(--composer-text)]">
                    <Waves className="size-3.5 text-[color:var(--composer-accent-secondary)]" />
                    {activeAudioItem ? "Active" : "Silent"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
