"use client";

import { useEffect, useMemo, useRef } from "react";
import { ClipboardCopy, Copy, Magnet, Scissors, Trash2, Volume2, VolumeX, ZoomIn } from "lucide-react";

import type { ComposerAssetRecord, ComposerTimelineItem } from "@/lib/composer/types";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import {
  buildTimelineTicks,
  composerPanelClass,
  formatTime,
  getTimelineCanvasWidth,
} from "@/components/composer/utils";
import { cn } from "@/lib/utils";

interface ComposerTimelinePanelProps {
  items: ComposerTimelineItem[];
  assetsById: Map<string, ComposerAssetRecord>;
  selectedItemId: string | null;
  currentTimeSeconds: number;
  projectDurationSeconds: number;
  timelineZoom: number;
  onTimelineZoomChange: (value: number) => void;
  onSeek: (seconds: number) => void;
  onSelectItem: (itemId: string) => void;
  onCopyItem: (itemId: string) => void;
  onDuplicateItem: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onToggleItemMute: (itemId: string) => void;
  onPasteClip: () => void;
  canPasteClip: boolean;
  snapEnabled: boolean;
  onSnapEnabledChange: (enabled: boolean) => void;
  isPlaying: boolean;
}

const RULER_HEIGHT = 34;
const TRACK_HEIGHT = 72;

export function ComposerTimelinePanel({
  items,
  assetsById,
  selectedItemId,
  currentTimeSeconds,
  projectDurationSeconds,
  timelineZoom,
  onTimelineZoomChange,
  onSeek,
  onSelectItem,
  onCopyItem,
  onDuplicateItem,
  onDeleteItem,
  onToggleItemMute,
  onPasteClip,
  canPasteClip,
  snapEnabled,
  onSnapEnabledChange,
  isPlaying,
}: ComposerTimelinePanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasWidth = useMemo(
    () => getTimelineCanvasWidth(projectDurationSeconds, timelineZoom),
    [projectDurationSeconds, timelineZoom]
  );
  const ticks = useMemo(
    () => buildTimelineTicks(projectDurationSeconds, timelineZoom),
    [projectDurationSeconds, timelineZoom]
  );
  const videoItems = useMemo(() => items.filter((item) => item.lane === "video"), [items]);
  const audioItems = useMemo(() => items.filter((item) => item.lane === "audio"), [items]);
  const playheadX = currentTimeSeconds * timelineZoom;

  useEffect(() => {
    if (!isPlaying) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const visibleStart = scroller.scrollLeft;
    const visibleEnd = visibleStart + scroller.clientWidth;
    if (playheadX < visibleStart + 48 || playheadX > visibleEnd - 72) {
      scroller.scrollTo({
        left: Math.max(0, playheadX - scroller.clientWidth / 3),
        behavior: "smooth",
      });
    }
  }, [isPlaying, playheadX]);

  const seekFromPointer = (clientX: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const localX = clientX - rect.left + scroller.scrollLeft;
    const rawSeconds = localX / timelineZoom;
    const nextSeconds = snapEnabled ? Math.round(rawSeconds * 4) / 4 : rawSeconds;
    onSeek(Math.max(0, nextSeconds));
  };

  return (
    <section data-testid="composer-timeline-panel" className={`${composerPanelClass} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-[color:var(--composer-border)] px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--composer-muted)]">
            Timeline
          </div>
          <div className="mt-1 text-sm font-medium text-[color:var(--composer-text)]">
            One video lane, one master audio lane
          </div>
        </div>
        <div className="composer-ui-mono text-sm text-[color:var(--composer-text)]">
          {formatTime(projectDurationSeconds)}
        </div>
      </div>

      <div className="border-b border-[color:var(--composer-border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-panel)]"
            onClick={() => selectedItemId && onCopyItem(selectedItemId)}
            disabled={!selectedItemId}
          >
            <ClipboardCopy className="mr-1.5 size-3.5" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-panel)]"
            onClick={() => selectedItemId && onDuplicateItem(selectedItemId)}
            disabled={!selectedItemId}
          >
            <Copy className="mr-1.5 size-3.5" />
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-panel)]"
            onClick={onPasteClip}
            disabled={!canPasteClip}
          >
            <ClipboardCopy className="mr-1.5 size-3.5" />
            Paste
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-panel)]"
            onClick={() => selectedItemId && onDeleteItem(selectedItemId)}
            disabled={!selectedItemId}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              "h-8 border border-[color:var(--composer-border)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-panel)]",
              snapEnabled ? "bg-[#253037]" : "bg-[color:var(--composer-raised)]"
            )}
            onClick={() => onSnapEnabledChange(!snapEnabled)}
          >
            <Magnet className="mr-1.5 size-3.5" />
            Snap {snapEnabled ? "on" : "off"}
          </Button>

          <div className="ml-auto flex min-w-[220px] items-center gap-3">
            <ZoomIn className="size-4 text-[color:var(--composer-muted)]" />
            <Slider
              value={[timelineZoom]}
              min={48}
              max={220}
              step={4}
              onValueChange={(value) => onTimelineZoomChange(value[0] ?? timelineZoom)}
            />
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[188px_minmax(0,1fr)]">
        <div className="border-r border-[color:var(--composer-border)] bg-[color:var(--composer-panel)]">
          <div
            className="border-b border-[color:var(--composer-border)] px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]"
            style={{ height: RULER_HEIGHT }}
          >
            Tracks
          </div>
          {[
            {
              label: "V1",
              title: "Video Lane",
              helper: videoItems.length === 0 ? "No clips" : `${videoItems.length} clips`,
              tone: "text-[color:var(--composer-accent)]",
            },
            {
              label: "A1",
              title: "Master Audio",
              helper: audioItems.length === 0 ? "No track" : `${audioItems.length} item`,
              tone: "text-[color:var(--composer-accent-secondary)]",
            },
          ].map((track) => (
            <div
              key={track.label}
              className="flex h-[72px] items-center gap-3 border-b border-[color:var(--composer-border)] px-3"
              style={{ height: TRACK_HEIGHT }}
            >
              <div className="composer-ui-mono w-9 text-sm font-medium text-[color:var(--composer-text)]">
                {track.label}
              </div>
              <div className="min-w-0">
                <div className={`text-sm font-medium ${track.tone}`}>{track.title}</div>
                <div className="text-xs text-[color:var(--composer-muted)]">{track.helper}</div>
              </div>
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 overflow-auto"
          onClick={(event) => seekFromPointer(event.clientX)}
        >
          <div style={{ width: canvasWidth }}>
            <div
              className="relative border-b border-[color:var(--composer-border)] bg-[color:var(--composer-raised)]"
              style={{ height: RULER_HEIGHT }}
            >
              {ticks.map((tick) => (
                <div
                  key={tick}
                  className="absolute bottom-0 top-0 border-l border-[color:var(--composer-border)]/80"
                  style={{ left: `${tick * timelineZoom}px` }}
                >
                  <div className="composer-ui-mono absolute left-2 top-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--composer-muted)]">
                    {formatTime(tick)}
                  </div>
                </div>
              ))}
              <div
                className="pointer-events-none absolute bottom-0 top-0 w-px bg-[color:var(--composer-accent-secondary)] shadow-[0_0_0_1px_rgba(70,185,217,0.22)]"
                style={{ left: `${playheadX}px` }}
              />
            </div>

            {[
              { lane: "video" as const, items: videoItems },
              { lane: "audio" as const, items: audioItems },
            ].map((track) => (
              <div
                key={track.lane}
                className="relative border-b border-[color:var(--composer-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.01),transparent)]"
                style={{ height: TRACK_HEIGHT }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_100%]" />
                <div
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-[color:var(--composer-accent-secondary)] shadow-[0_0_0_1px_rgba(70,185,217,0.22)]"
                  style={{ left: `${playheadX}px` }}
                />

                {track.items.map((item) => {
                  const asset = assetsById.get(item.assetId);
                  const width = Math.max(item.durationSeconds * timelineZoom, 88);
                  const left = item.timelineStartSeconds * timelineZoom;
                  const isSelected = selectedItemId === item.id;
                  const isMuted = item.muted;
                  const isVideo = item.lane === "video";

                  return (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "absolute top-2 bottom-2 overflow-hidden rounded-[10px] border px-3 py-2 text-left transition",
                            isVideo
                              ? "border-[#7f632d] bg-[linear-gradient(180deg,#3a2c12,#2b2418)] text-[#f0d3a0]"
                              : "border-[#336977] bg-[linear-gradient(180deg,#16323b,#17262c)] text-[#b7dbe6]",
                            isSelected && "ring-2 ring-[color:var(--composer-accent-secondary)] ring-offset-2 ring-offset-[color:var(--composer-panel)]"
                          )}
                          style={{ left, width }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectItem(item.id);
                          }}
                        >
                          <div className="absolute left-0 top-0 h-full w-1 bg-white/10" />
                          <div className="absolute right-0 top-0 h-full w-1 bg-black/30" />
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {asset?.filename ?? item.assetId}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-current/70">
                                <span>{formatTime(item.timelineStartSeconds)}</span>
                                <span>{formatTime(item.durationSeconds)}</span>
                              </div>
                            </div>
                            {isMuted ? (
                              <VolumeX className="size-3.5 shrink-0 text-current/75" />
                            ) : (
                              <Volume2 className="size-3.5 shrink-0 text-current/55" />
                            )}
                          </div>
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 opacity-40">
                            {isVideo ? (
                              <div className="h-full bg-[linear-gradient(90deg,transparent_0,transparent_15%,rgba(255,255,255,0.08)_15%,rgba(255,255,255,0.08)_16%,transparent_16%,transparent_32%,rgba(255,255,255,0.08)_32%,rgba(255,255,255,0.08)_33%,transparent_33%)]" />
                            ) : (
                              <div className="h-full bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_0,rgba(255,255,255,0.06)_4px,transparent_4px,transparent_8px)]" />
                            )}
                          </div>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => onSelectItem(item.id)}>
                          <Scissors className="size-4" />
                          Select
                        </ContextMenuItem>
                        {isVideo ? (
                          <>
                            <ContextMenuItem onClick={() => onCopyItem(item.id)}>
                              <ClipboardCopy className="size-4" />
                              Copy clip
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onDuplicateItem(item.id)}>
                              <Copy className="size-4" />
                              Duplicate clip
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                          </>
                        ) : null}
                        <ContextMenuItem onClick={() => onToggleItemMute(item.id)}>
                          {isMuted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                          {isMuted ? "Unmute" : "Mute"}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onDeleteItem(item.id)}>
                          <Trash2 className="size-4" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
