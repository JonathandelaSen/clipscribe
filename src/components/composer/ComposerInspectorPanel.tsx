"use client";

import { Download, FileOutput, HardDriveDownload, Info, Loader2, Scissors, Volume2, VolumeX } from "lucide-react";

import type {
  ComposerAssetRecord,
  ComposerExportRecord,
  ComposerQuality,
  ComposerRatio,
  ComposerTimelineItem,
} from "@/lib/composer/types";
import type { ComposerInspectorTab } from "@/lib/composer/core/workspace-prefs";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  assetLabel,
  composerInsetClass,
  composerPanelClass,
  formatBytes,
  formatTime,
} from "@/components/composer/utils";

type RatioOption = { value: ComposerRatio; label: string };
type QualityOption = { value: ComposerQuality; label: string; helper: string };

interface ComposerInspectorPanelProps {
  activeTab: ComposerInspectorTab;
  onTabChange: (value: ComposerInspectorTab) => void;
  selectedItem: ComposerTimelineItem | null;
  selectedAsset: ComposerAssetRecord | null;
  onUpdateSelectedItem: (updater: (item: ComposerTimelineItem) => ComposerTimelineItem) => void;
  onCopySelected: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  exportRatio: ComposerRatio;
  exportQuality: ComposerQuality;
  ratioOptions: RatioOption[];
  qualityOptions: QualityOption[];
  onExportRatioChange: (value: ComposerRatio) => void;
  onExportQualityChange: (value: ComposerQuality) => void;
  onExport: () => void;
  canExport: boolean;
  isExporting: boolean;
  exportProgressPct: number;
  exportError: string | null;
  exports: ComposerExportRecord[];
  onDownloadExport: (record: ComposerExportRecord) => void;
  onOpenExportDebug: (recordId: string) => void;
  sliderStepSeconds: number;
}

export function ComposerInspectorPanel({
  activeTab,
  onTabChange,
  selectedItem,
  selectedAsset,
  onUpdateSelectedItem,
  onCopySelected,
  onDuplicateSelected,
  onDeleteSelected,
  exportRatio,
  exportQuality,
  ratioOptions,
  qualityOptions,
  onExportRatioChange,
  onExportQualityChange,
  onExport,
  canExport,
  isExporting,
  exportProgressPct,
  exportError,
  exports,
  onDownloadExport,
  onOpenExportDebug,
  sliderStepSeconds,
}: ComposerInspectorPanelProps) {
  const hasSelectedVideo = !!selectedItem && selectedItem.lane === "video";
  const selectedAudioCapable = !!selectedItem && (selectedItem.lane === "audio" || selectedAsset?.hasAudio);

  return (
    <section data-testid="composer-inspector-panel" className={`${composerPanelClass} overflow-hidden`}>
      <div className="border-b border-[color:var(--composer-border)] px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--composer-muted)]">
          Inspector
        </div>
        <div className="mt-1 text-sm font-medium text-[color:var(--composer-text)]">
          Context-sensitive clip and export controls
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as ComposerInspectorTab)} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid h-9 grid-cols-3 rounded-lg border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-muted)]">
            <TabsTrigger value="clip" className="text-xs uppercase tracking-[0.22em] data-[state=active]:bg-[color:var(--composer-panel)] data-[state=active]:text-[color:var(--composer-text)]">
              Clip
            </TabsTrigger>
            <TabsTrigger value="audio" className="text-xs uppercase tracking-[0.22em] data-[state=active]:bg-[color:var(--composer-panel)] data-[state=active]:text-[color:var(--composer-text)]">
              Audio
            </TabsTrigger>
            <TabsTrigger value="export" className="text-xs uppercase tracking-[0.22em] data-[state=active]:bg-[color:var(--composer-panel)] data-[state=active]:text-[color:var(--composer-text)]">
              Export
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clip" className="mt-3 min-h-0 flex-1">
            {hasSelectedVideo && selectedItem && selectedAsset ? (
              <div className="space-y-3">
                <div className={`${composerInsetClass} p-3`}>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[color:var(--composer-text)]">
                        {selectedAsset.filename}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                        {assetLabel(selectedAsset)}
                      </div>
                    </div>
                    <span className="rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                      Selected
                    </span>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--composer-muted)]">
                        <span>Timeline start</span>
                        <span>{formatTime(selectedItem.timelineStartSeconds)}</span>
                      </div>
                      <Slider
                        value={[selectedItem.timelineStartSeconds]}
                        min={0}
                        max={Math.max(selectedItem.timelineStartSeconds + 10, 60)}
                        step={sliderStepSeconds}
                        onValueChange={(value) =>
                          onUpdateSelectedItem((item) => ({
                            ...item,
                            timelineStartSeconds: value[0] ?? item.timelineStartSeconds,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--composer-muted)]">
                        <span>Source in</span>
                        <span>{formatTime(selectedItem.sourceStartSeconds)}</span>
                      </div>
                      <Slider
                        value={[selectedItem.sourceStartSeconds]}
                        min={0}
                        max={Math.max(0, selectedAsset.durationSeconds - 0.1)}
                        step={sliderStepSeconds}
                        onValueChange={(value) =>
                          onUpdateSelectedItem((item) => ({
                            ...item,
                            sourceStartSeconds: value[0] ?? item.sourceStartSeconds,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--composer-muted)]">
                        <span>Clip duration</span>
                        <span>{formatTime(selectedItem.durationSeconds)}</span>
                      </div>
                      <Slider
                        value={[selectedItem.durationSeconds]}
                        min={0.25}
                        max={Math.max(0.25, selectedAsset.durationSeconds - selectedItem.sourceStartSeconds)}
                        step={sliderStepSeconds}
                        onValueChange={(value) =>
                          onUpdateSelectedItem((item) => ({
                            ...item,
                            durationSeconds: value[0] ?? item.durationSeconds,
                          }))
                        }
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2 text-xs text-[color:var(--composer-muted)]">
                        Fit mode
                        <Select
                          value={selectedItem.fitMode ?? "fill"}
                          onValueChange={(value) =>
                            onUpdateSelectedItem((item) => ({
                              ...item,
                              fitMode: value === "fit" ? "fit" : "fill",
                            }))
                          }
                        >
                          <SelectTrigger className="h-9 border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
                            <SelectItem value="fill">Fill frame</SelectItem>
                            <SelectItem value="fit">Fit inside</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>

                      <div className="grid gap-2">
                        <Button
                          size="sm"
                          className="h-9 border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
                          onClick={onCopySelected}
                        >
                          <Scissors className="mr-2 size-4" />
                          Copy clip
                        </Button>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--composer-muted)]">
                        <span>Horizontal framing</span>
                        <span>{Math.round(selectedItem.offsetX ?? 0)}</span>
                      </div>
                      <Slider
                        value={[selectedItem.offsetX ?? 0]}
                        min={-100}
                        max={100}
                        step={1}
                        onValueChange={(value) =>
                          onUpdateSelectedItem((item) => ({
                            ...item,
                            offsetX: value[0] ?? 0,
                          }))
                        }
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--composer-muted)]">
                        <span>Vertical framing</span>
                        <span>{Math.round(selectedItem.offsetY ?? 0)}</span>
                      </div>
                      <Slider
                        value={[selectedItem.offsetY ?? 0]}
                        min={-100}
                        max={100}
                        step={1}
                        onValueChange={(value) =>
                          onUpdateSelectedItem((item) => ({
                            ...item,
                            offsetY: value[0] ?? 0,
                          }))
                        }
                      />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        size="sm"
                        className="h-9 border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
                        onClick={onDuplicateSelected}
                      >
                        Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 border border-[color:var(--composer-border)] bg-transparent text-[#d9a1a1] hover:bg-[#2a2020]"
                        onClick={onDeleteSelected}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${composerInsetClass} px-4 py-6 text-sm leading-relaxed text-[color:var(--composer-muted)]`}>
                Select a video clip on the timeline to adjust trim, fit/fill, and framing.
              </div>
            )}
          </TabsContent>

          <TabsContent value="audio" className="mt-3 min-h-0 flex-1">
            {selectedItem && selectedAsset && selectedAudioCapable ? (
              <div className="space-y-3">
                <div className={`${composerInsetClass} p-3`}>
                  <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                    <Info className="size-3.5" />
                    Audio Controls
                  </div>
                  <div className="text-sm font-medium text-[color:var(--composer-text)]">
                    {selectedAsset.filename}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--composer-muted)]">
                    {selectedItem.lane === "audio"
                      ? "Master audio lane item"
                      : selectedAsset.hasAudio
                        ? "Embedded clip audio"
                        : "This clip does not carry audio"}
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs text-[color:var(--composer-muted)]">
                        <span>Volume</span>
                        <span>{Math.round(selectedItem.volume * 100)}%</span>
                      </div>
                      <Slider
                        value={[selectedItem.volume * 100]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(value) =>
                          onUpdateSelectedItem((item) => ({
                            ...item,
                            volume: Math.max(0, Math.min(1, (value[0] ?? 0) / 100)),
                          }))
                        }
                      />
                    </div>

                    <Button
                      className="h-9 border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-raised)]"
                      onClick={() =>
                        onUpdateSelectedItem((item) => ({
                          ...item,
                          muted: !item.muted,
                        }))
                      }
                    >
                      {selectedItem.muted ? (
                        <VolumeX className="mr-2 size-4" />
                      ) : (
                        <Volume2 className="mr-2 size-4" />
                      )}
                      {selectedItem.muted ? "Muted" : "Mute"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`${composerInsetClass} px-4 py-6 text-sm leading-relaxed text-[color:var(--composer-muted)]`}>
                Select an audio item or a video clip with embedded audio to adjust loudness and mute state.
              </div>
            )}
          </TabsContent>

          <TabsContent value="export" className="mt-3 min-h-0 flex-1">
            <div className="grid min-h-0 flex-1 gap-3">
              <div className={`${composerInsetClass} p-3`}>
                <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                  <FileOutput className="size-3.5" />
                  Output Settings
                </div>

                <div className="grid gap-3">
                  <label className="grid gap-2 text-xs text-[color:var(--composer-muted)]">
                    Ratio
                    <Select value={exportRatio} onValueChange={(value) => onExportRatioChange(value as ComposerRatio)}>
                      <SelectTrigger className="h-9 border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
                        {ratioOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="grid gap-2 text-xs text-[color:var(--composer-muted)]">
                    Quality
                    <Select value={exportQuality} onValueChange={(value) => onExportQualityChange(value as ComposerQuality)}>
                      <SelectTrigger className="h-9 border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
                        {qualityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label} • {option.helper}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <Button
                    onClick={onExport}
                    disabled={!canExport}
                    className="h-10 border border-[#8f6a2b] bg-[color:var(--composer-accent)] text-black hover:bg-[#ffbc5c]"
                  >
                    {isExporting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <HardDriveDownload className="mr-2 size-4" />
                    )}
                    {isExporting ? `Exporting ${exportProgressPct}%` : "Export MP4"}
                  </Button>

                  {isExporting ? (
                    <div className="space-y-2">
                      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--composer-border)]">
                        <div
                          className="h-full bg-[color:var(--composer-accent-secondary)] transition-[width] duration-150"
                          style={{ width: `${Math.max(exportProgressPct, 4)}%` }}
                        />
                      </div>
                      <div className="text-xs text-[color:var(--composer-muted)]">
                        Rendering locally with ffmpeg.wasm.
                      </div>
                    </div>
                  ) : null}

                  {exportError ? (
                    <div className="rounded-lg border border-[#613b3b] bg-[#261818] px-3 py-2 text-sm text-[#e6baba]">
                      {exportError}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={`${composerInsetClass} min-h-0 p-3`}>
                <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                  <Download className="size-3.5" />
                  Saved Exports
                </div>
                <div className="space-y-2">
                  {exports.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[color:var(--composer-border)] px-3 py-5 text-sm text-[color:var(--composer-muted)]">
                      No export saved yet.
                    </div>
                  ) : (
                    exports.slice(0, 6).map((record) => (
                      <div
                        key={record.id}
                        className="rounded-lg border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] px-3 py-3"
                      >
                        <div className="truncate text-sm font-medium text-[color:var(--composer-text)]">
                          {record.filename}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[color:var(--composer-muted)]">
                          {record.ratio} • {record.quality} • {record.resolution}
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--composer-muted)]">
                          {formatBytes(record.sizeBytes)}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            className="h-8 border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] text-[color:var(--composer-text)] hover:bg-[color:var(--composer-panel)]"
                            onClick={() => onDownloadExport(record)}
                            disabled={!record.fileBlob}
                          >
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 border border-[color:var(--composer-border)] bg-transparent text-[color:var(--composer-muted)] hover:bg-[color:var(--composer-panel)] hover:text-[color:var(--composer-text)]"
                            onClick={() => onOpenExportDebug(record.id)}
                          >
                            Debug
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
