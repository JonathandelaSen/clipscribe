"use client";

import {
  memo,
  useCallback,
  startTransition,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Film,
  FolderOpen,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Music4,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Split,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { BackgroundTaskBanner } from "@/components/tasks/BackgroundTaskBanner";
import { isBackgroundTaskActive } from "@/lib/background-tasks/core";
import {
  CREATOR_SUBTITLE_STYLE_LABELS,
  cssRgbaFromHex,
  cssTextShadowFromStyle,
  resolveCreatorSubtitleStyle,
} from "@/lib/creator/subtitle-style";
import { secondsToClock, type CreatorSubtitleTimingMode } from "@/lib/creator/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getLatestSubtitleForLanguage, getLatestTranscript, type HistoryItem } from "@/lib/history";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";
import { useEditorProject } from "@/hooks/useEditorLibrary";
import { useHistoryLibrary } from "@/hooks/useHistoryLibrary";
import { decodeAudio } from "@/lib/audio";
import { downloadBlob, readMediaMetadata } from "@/lib/editor/media";
import {
  buildProjectCaptionTimeline,
  getProjectSubtitleTrackEffectiveTimingMode,
  buildProjectSubtitleTimeline,
  hasProjectSubtitleTrack,
  hydrateProjectSubtitleTrackFromLegacyCaptions,
  type TimelineCaptionChunk,
} from "@/lib/editor/core/captions";
import {
  EDITOR_EXPORT_ENGINE_LABEL,
  getEditorExportCapability,
} from "@/lib/editor/export-capabilities";
import {
  EDITOR_ASPECT_RATIO_LABELS,
  getAspectRatioNumber,
  getEditorOutputDimensions,
} from "@/lib/editor/core/aspect-ratio";
import {
  buildEditorCanvasPreviewLayout,
  getEditorCanvasCoverZoom,
} from "@/lib/editor/core/canvas-frame";
import {
  appendTimelineAudioItem,
  clampAudioItemToAsset,
  clampVideoClipToAsset,
  canJoinTimelineClips,
  cloneTimelineAudioItemToFill,
  cloneTimelineClipGroupToFill,
  cloneTimelineClipToFill,
  createClonedTimelineImageItem,
  createClonedTimelineOverlayItem,
  createJoinedTimelineClipGroup,
  createClonedTimelineAudioItem,
  createClonedTimelineClip,
  duplicateTimelineClipGroup,
  ensureProjectSelection,
  findTimelineClipGroup,
  getVideoClipMediaTime,
  getProjectDuration,
  getSelectionForLaneIndex,
  getTimelineAudioPlacements,
  getTimelineClipPlacements,
  getTimelineImagePlacements,
  getTimelineOverlayPlacements,
  getTimelineSelectionForVideoBlock,
  getTimelineVideoBlockPlacements,
  insertTimelineAudioItemAfter,
  insertTimelineClipAfter,
  removeTimelineAudioItem,
  removeTimelineClip,
  removeTimelineClipGroup,
  removeTimelineImageItem,
  removeTimelineOverlayItem,
  reorderTimelineVideoBlock,
  replaceTimelineAudioItem,
  replaceTimelineClip,
  replaceTimelineClipGroupWithClip,
  replaceTimelineImageItem,
  replaceTimelineOverlayItem,
  resetTimelineAudioItemTrack,
  resetTimelineAudioItemTrim,
  resetTimelineVideoClipAudio,
  resetTimelineVideoClipFrame,
  resetTimelineVideoClipTrim,
  splitTimelineClip,
  trimTimelineAudioItemToMatchTrackEnd,
  trimTimelineClipGroupToMatchTrackEnd,
  trimTimelineClipToMatchTrackEnd,
  unjoinTimelineClipGroup,
  type TimelineVideoBlockPlacement,
} from "@/lib/editor/core/timeline";
import { prepareTimelineClipBake } from "@/lib/editor/core/bake";
import { buildEditorExportFilename } from "@/lib/editor/export-output";
import {
  isEditorSavePickerSupported,
  pickEditorSaveFileHandle,
  writeBlobToEditorSaveFileHandle,
  type EditorSaveFileHandle,
} from "@/lib/editor/save-file";
import { requestSystemEditorExport } from "@/lib/editor/system-export-client";
import {
  createActiveBrowserRenderSession,
  isBrowserRenderCancelableStage,
  isBrowserRenderCanceledError,
  type ActiveBrowserRenderSession,
  type BrowserRenderStage,
} from "@/lib/browser-render";
import {
  buildReversedClipPreviewCacheKey,
  renderReversedClipPreview,
} from "@/lib/editor/preview-proxy";
import {
  renderEditorSubtitlePreviewBlob,
  resolveEditorSubtitleTextLayout,
} from "@/lib/editor/subtitle-canvas";
import {
  buildProjectReactiveOverlayAudioAnalysis,
  type EditorReactiveAudioAnalysisTrack,
  type ReactiveOverlayFrameSequence,
} from "@/lib/editor/reactive-overlays";
import {
  MOTION_OVERLAY_PRESETS,
  getMotionOverlayPresetLabel,
  isAudioReactiveMotionOverlayItem,
  resolveMotionOverlayFrame,
  resolveMotionOverlayRect,
  type MotionOverlayPresetId,
  type ResolvedMotionOverlayFrame,
} from "@/lib/motion-overlays";
import {
  applyResolvedSubtitleStyle,
  buildEditorExportRecord,
  createDefaultAudioTrack,
  createDefaultImageTrackItem,
  createDefaultTimelineOverlayItem,
  createDefaultVideoClip,
  createEditorAssetRecord,
  getDefaultEditorSubtitleStyle,
  getEditorProjectPersistenceFingerprint,
  markEditorProjectFailed,
  markEditorProjectSaved,
  normalizeLegacyEditorProjectRecord,
  serializeEditorProjectForPersistence,
} from "@/lib/editor/storage";
import {
  EDITOR_SUBTITLE_TRACK_ID,
} from "@/lib/editor/types";
import type {
  EditorAssetRecord,
  EditorAspectRatio,
  EditorProjectRecord,
  EditorResolution,
  ResolvedEditorAsset,
  TimelineAudioPlacement,
  TimelineClipPlacement,
  TimelineAudioItem,
  TimelineClipGroup,
  TimelineImageItem,
  TimelineOverlayItem,
  TimelineOverlayPlacement,
  TimelineSelection,
  TimelineVideoClip,
} from "@/lib/editor/types";
import { parseSrt } from "@/lib/srt";
import { createDexieEditorRepository } from "@/lib/repositories/editor-repo";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { ExportSettingsDialog } from "@/components/editor/ExportSettingsDialog";

const ASPECT_OPTIONS: EditorAspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
const EDITOR_PANEL_CLASS =
  "h-full gap-0 overflow-hidden rounded-[0.9rem] border border-white/7 bg-[linear-gradient(180deg,rgba(13,17,24,0.98),rgba(7,10,15,0.98))] py-0 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_12px_28px_rgba(0,0,0,0.18)]";
const EDITOR_PANEL_CONTENT_CLASS = "flex h-full min-h-0 flex-col gap-0 p-0";
const EDITOR_PANEL_HEADER_CLASS =
  "flex min-h-10 items-center justify-between gap-2 border-b border-white/6 px-2.5 py-2";
const EDITOR_PANEL_BODY_CLASS = "flex min-h-0 flex-1 flex-col p-1.5 sm:p-2";
const EDITOR_SECTION_CLASS =
  "rounded-[0.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.012))] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";
const EDITOR_LABEL_CLASS = "text-[10px] font-medium uppercase tracking-[0.28em] text-white/38";
const EDITOR_TOOLBAR_BUTTON_CLASS =
  "h-8 rounded-[0.85rem] border border-white/8 bg-white/[0.035] px-3 text-xs text-white/72 hover:bg-white/[0.08] hover:text-white";
const EDITOR_TIMECODE_CLASS = "font-mono text-[11px] tracking-[0.18em] text-white/46";
const IMAGE_TRACK_MIN_ZOOM = 0.6;
const IMAGE_TRACK_MAX_ZOOM = 6;
const EDITOR_TASK_LOG_LIMIT = 250;
const EDITOR_SUBTITLE_TIMING_MODE_LABELS: Record<CreatorSubtitleTimingMode, string> = {
  segment: "Normal subtitles",
  word: "1 word",
  pair: "2 words",
  triple: "3 words",
};

function getExportTaskMessage(stage: BrowserRenderStage) {
  if (stage === "preparing") return "Preparing export snapshot";
  if (stage === "rendering") return "Rendering timeline export";
  if (stage === "handoff") return "Saving export output";
  return "Wrapping up export";
}

function getBakeTaskMessage(stage: BrowserRenderStage) {
  if (stage === "preparing") return "Preparing bake workspace";
  if (stage === "rendering") return "Baking joined clip";
  if (stage === "handoff") return "Applying baked clip to the timeline";
  return "Wrapping up bake";
}

function formatEditorTaskLogLine(message: string, startedAt: number, now: number) {
  const elapsedSeconds = ((now - startedAt) / 1000).toFixed(2);
  return `[${new Date(now).toISOString()} | +${elapsedSeconds}s] ${message}`;
}

function getTimelinePlaybackTimeFromVideo(input: {
  placement: TimelineClipPlacement;
  currentTime: number;
  isUsingReversePreview: boolean;
}) {
  const { placement, currentTime, isUsingReversePreview } = input;
  if (!Number.isFinite(currentTime)) return null;
  if (placement.clip.actions.reverse) {
    if (!isUsingReversePreview) return null;
    return clampNumber(
      placement.startSeconds + currentTime,
      placement.startSeconds,
      placement.endSeconds
    );
  }
  return clampNumber(
    placement.startSeconds + (currentTime - placement.clip.trimStartSeconds),
    placement.startSeconds,
    placement.endSeconds
  );
}

function getTimelinePlaybackTimeFromAudio(input: {
  placement: TimelineAudioPlacement;
  currentTime: number;
}) {
  const { placement, currentTime } = input;
  if (!Number.isFinite(currentTime)) return null;
  return clampNumber(
    placement.startSeconds + (currentTime - placement.item.trimStartSeconds),
    placement.startSeconds,
    placement.endSeconds
  );
}

type InspectorVideoTab = "edit" | "transform" | "join";

type PreviewMode =
  | {
      kind: "timeline";
    }
  | {
      kind: "asset";
      assetId: string;
    };

type PanelVisibilityState = {
  left: boolean;
  center: boolean;
  right: boolean;
};

type TimelineClipboardItem =
  | {
      kind: "image";
      item: TimelineImageItem;
    }
  | {
      kind: "video";
      item: TimelineVideoClip;
    }
  | {
      kind: "video-group";
      item: TimelineClipGroup;
      clips: TimelineVideoClip[];
    }
  | {
      kind: "audio";
      item: TimelineAudioItem;
    }
  | {
      kind: "overlay";
      item: TimelineOverlayItem;
    };

type ExportDestination = {
  handle: EditorSaveFileHandle;
  name: string;
};

type TimelineTrackActionState = {
  canCloneToFill: boolean;
  canTrimToMatch: boolean;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getTimelineAssetLabel(filename: string) {
  return filename.replace(/\.[^/.]+$/, "");
}

function isAbortLikeError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function omitReversePreviewCacheKeys(cache: Record<string, File>, keys: Set<string>) {
  let removed = false;
  const nextCache: Record<string, File> = {};
  for (const [key, file] of Object.entries(cache)) {
    if (keys.has(key)) {
      removed = true;
      continue;
    }
    nextCache[key] = file;
  }
  return removed ? nextCache : cache;
}

function isShortcutTargetEditable(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return Boolean(
    element.closest(
      'input, textarea, select, [contenteditable="true"], [role="combobox"], video, audio'
    )
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    const didCopy = document.execCommand("copy");
    if (!didCopy) {
      throw new Error("Clipboard copy is unavailable.");
    }
  } finally {
    textarea.remove();
  }
}

function useObjectUrl(file: Blob | null | undefined) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}

function SectionResetButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 rounded-md px-2 text-[10px] uppercase tracking-[0.2em] text-white/46 hover:bg-white/[0.06] hover:text-white"
      onClick={onClick}
    >
      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
      Reset
    </Button>
  );
}

function ProjectAssetThumbnail({
  resolvedAsset,
  isActive,
  onSelect,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  resolvedAsset: ResolvedEditorAsset | undefined;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const asset = resolvedAsset?.asset;
  const videoUrl = useObjectUrl(asset?.kind === "video" ? resolvedAsset?.file : null);
  const imageUrl = useObjectUrl(asset?.kind === "image" ? resolvedAsset?.file : null);

  if (!asset) return null;

  const isVideo = asset.kind === "video";
  const isImage = asset.kind === "image";
  const durationLabel = asset.kind === "image" ? "Still" : secondsToClock(asset.durationSeconds);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative overflow-hidden rounded-xl border text-left transition-all duration-200",
        isActive
          ? "border-white/80 shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_0_18px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.22)]"
          : "border-white/[0.06] hover:border-white/20 hover:shadow-[0_0_16px_rgba(255,255,255,0.03)]",
        isDragging
          ? "scale-[0.97] opacity-50 ring-1 ring-cyan-300/28"
          : "cursor-grab active:cursor-grabbing hover:scale-[1.02]"
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="relative aspect-video overflow-hidden bg-black">
          {isVideo && videoUrl ? (
            <video
              src={videoUrl}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : isImage && imageUrl ? (
            <Image
              src={imageUrl}
              alt={asset.filename}
              fill
              unoptimized
              sizes="(max-width: 1280px) 50vw, 20vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center",
                isVideo
                  ? "bg-[radial-gradient(circle_at_40%_30%,rgba(56,189,248,0.16),transparent_50%),linear-gradient(145deg,rgba(15,19,28,0.98),rgba(8,11,17,0.98))]"
                  : isImage
                    ? "bg-[radial-gradient(circle_at_50%_24%,rgba(16,185,129,0.16),transparent_48%),linear-gradient(145deg,rgba(10,22,20,0.98),rgba(6,12,14,0.98))]"
                  : "bg-[radial-gradient(ellipse_at_50%_20%,rgba(251,191,36,0.14),transparent_55%),linear-gradient(145deg,rgba(18,16,24,0.98),rgba(10,9,15,0.98))]"
              )}
            >
              <div
                className={cn(
                  "rounded-xl border p-3 backdrop-blur-sm",
                  isVideo
                    ? "border-cyan-300/12 bg-cyan-400/[0.06] text-cyan-200/60"
                    : isImage
                      ? "border-emerald-300/12 bg-emerald-400/[0.06] text-emerald-200/70"
                    : "border-amber-300/12 bg-amber-400/[0.06] text-amber-200/60"
                )}
              >
                {isVideo ? <Film className="h-5 w-5" /> : isImage ? <ImageIcon className="h-5 w-5" /> : <Music4 className="h-5 w-5" />}
              </div>
            </div>
          )}
          {/* Gradient overlay for text readability */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(0,0,0,0.75))]" />

          {/* Bottom info bar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-1 px-2.5 pb-2">
            <div className="min-w-0 flex-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="truncate text-[12px] font-semibold leading-tight text-white/90">
                    {asset.filename}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="z-50 border border-white/10 bg-slate-900 px-3 py-1.5 text-[11px] text-white backdrop-blur-md shadow-xl">
                  {asset.filename}
                </TooltipContent>
              </Tooltip>
            </div>
            <div
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] tracking-wide",
                isVideo
                  ? "bg-white/10 text-white/55"
                  : isImage
                    ? "bg-emerald-400/10 text-emerald-100/70"
                  : "bg-amber-400/10 text-amber-200/55"
              )}
            >
              {durationLabel}
            </div>
          </div>
        </div>
      </button>

      {/* Delete button — appears on hover */}
      <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          draggable={false}
          title={`Delete ${asset.filename}`}
          aria-label={`Delete ${asset.filename}`}
          className="h-7 w-7 rounded-lg border border-white/[0.06] bg-black/65 p-0 text-white/50 backdrop-blur-md hover:border-red-400/20 hover:bg-red-500/20 hover:text-red-200"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ReactiveOverlayPreviewFrame({
  frame,
}: {
  frame: ResolvedMotionOverlayFrame;
}) {
  if (frame.kind === "emoji_bounce" || frame.kind === "emoji_orbit") {
    return (
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="h-full w-full overflow-visible">
        {frame.kind === "emoji_orbit" ? (
          <circle
            cx={frame.width / 2}
            cy={frame.height / 2}
            r={frame.orbitRadius}
            fill="none"
            stroke={frame.glowColor}
            strokeWidth={Math.max(1, frame.fontSize * 0.06)}
            opacity={frame.trailOpacity}
          />
        ) : null}
        <text
          x={frame.centerX}
          y={frame.centerY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={frame.fontSize}
          transform={`rotate(${frame.rotationDeg} ${frame.centerX} ${frame.centerY}) scale(${frame.glyphScale})`}
          style={{ filter: `drop-shadow(0 0 ${Math.max(8, frame.fontSize * 0.14)}px ${frame.glowColor})` }}
          opacity={frame.opacity}
        >
          {frame.emoji}
        </text>
      </svg>
    );
  }

  if (frame.kind === "sparkle_drift") {
    return (
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="h-full w-full overflow-visible">
        {frame.particles.map((particle, index) => (
          <text
            key={`${index}_${particle.x}_${particle.y}`}
            x={particle.x}
            y={particle.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={particle.size}
            fill={particle.color}
            opacity={frame.opacity * particle.opacity}
            transform={`rotate(${particle.rotationDeg} ${particle.x} ${particle.y})`}
          >
            {particle.glyph}
          </text>
        ))}
      </svg>
    );
  }

  if (frame.kind === "pulse_ring") {
    return (
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="h-full w-full overflow-visible">
        <circle cx={frame.centerX} cy={frame.centerY} r={frame.glowRadius} fill={frame.glowFill} />
        <circle
          cx={frame.centerX}
          cy={frame.centerY}
          r={frame.radius}
          fill="none"
          stroke={frame.stroke}
          strokeWidth={frame.strokeWidth}
        />
        <circle cx={frame.centerX} cy={frame.centerY} r={frame.innerRadius} fill={frame.stroke} />
      </svg>
    );
  }

  if (frame.kind === "equalizer_bars") {
    return (
      <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="h-full w-full overflow-visible">
        {frame.bars.map((bar, index) => (
          <g key={`${bar.x}-${index}`}>
            <rect
              x={bar.x}
              y={Math.max(0, bar.y - 6)}
              width={bar.width}
              height={Math.min(frame.height, bar.height + 6)}
              rx={bar.radius}
              fill={frame.glowFill}
            />
            <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={bar.radius} fill={frame.fill} />
          </g>
        ))}
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${frame.width} ${frame.height}`} className="h-full w-full overflow-visible">
      <path
        d={frame.glowPath}
        fill="none"
        stroke={frame.stroke}
        strokeOpacity={0.26}
        strokeWidth={frame.strokeWidth * 2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={frame.path}
        fill="none"
        stroke={frame.stroke}
        strokeWidth={frame.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TimelineWorkspaceHeader = memo(function TimelineWorkspaceHeader({
  projectName,
  projectAspectRatio,
  lastError,
  saveState,
  panelVisibility,
  isRenderBusy,
  onProjectNameChange,
  onAspectRatioChange,
  onTogglePanel,
  onCopyLastError,
  onDeleteLastError,
  onExport,
}: {
  projectName: string;
  projectAspectRatio: EditorAspectRatio;
  lastError?: string | null;
  saveState: "saved" | "saving" | "dirty";
  panelVisibility: PanelVisibilityState;
  isRenderBusy: boolean;
  onProjectNameChange: (value: string) => void;
  onAspectRatioChange: (value: EditorAspectRatio) => void;
  onTogglePanel: (panel: keyof PanelVisibilityState) => void;
  onCopyLastError?: () => void | Promise<void>;
  onDeleteLastError?: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
}) {
  const errorHeadline = lastError?.split("\n")[0] || "Export failed";

  return (
    <header className="shrink-0 border-b border-white/8 bg-[linear-gradient(180deg,rgba(11,14,20,0.98),rgba(7,10,15,0.98))] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" className="h-8 rounded-lg px-2.5 text-white/68 hover:bg-white/[0.06] hover:text-white">
            <Link href="/creator/editor">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Projects
            </Link>
          </Button>
          <div className="h-7 w-px bg-white/8" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/16 bg-cyan-400/8 px-2.5 py-1 text-[10px] uppercase tracking-[0.28em] text-cyan-100/84">
                <Film className="h-4 w-4" />
                Timeline Studio
              </div>
              <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-white/44">
                {saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "Saved"}
              </span>
            </div>
            <Input
              value={projectName}
              onChange={(event) => onProjectNameChange(event.target.value)}
              className="h-10 max-w-xl rounded-none border-none bg-transparent px-0 text-[1.25rem] font-semibold tracking-[-0.02em] placeholder:text-white/24 focus-visible:ring-0"
              placeholder="Project name"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={projectAspectRatio} onValueChange={(value) => onAspectRatioChange(value as EditorAspectRatio)}>
            <SelectTrigger className="h-9 w-[146px] rounded-lg border-white/8 bg-white/[0.04] text-white">
              <SelectValue placeholder="Aspect" />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-slate-950 text-white">
              {ASPECT_OPTIONS.map((aspect) => (
                <SelectItem key={aspect} value={aspect}>
                  {aspect} · {EDITOR_ASPECT_RATIO_LABELS[aspect]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mx-1 h-7 w-px bg-white/8" />
          <div className="flex flex-wrap items-center gap-1 rounded-[0.9rem] border border-white/8 bg-black/25 p-1">
            {([
              ["left", "Assets"],
              ["center", "Preview"],
              ["right", "Inspector"],
            ] as const).map(([panel, label]) => (
              <Button
                key={panel}
                variant="ghost"
                className={cn(
                  "h-8 rounded-[0.7rem] px-2.5 text-[10px] uppercase tracking-[0.24em]",
                  panelVisibility[panel]
                    ? "bg-white/[0.08] text-white hover:bg-white/[0.12]"
                    : "text-white/30 hover:bg-white/[0.05] hover:text-white/72"
                )}
                onClick={() => onTogglePanel(panel)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            onClick={() => void onExport()}
            disabled={isRenderBusy}
            className="h-9 rounded-lg border border-amber-300/15 bg-amber-300/90 px-4 text-sm font-semibold text-slate-950 hover:bg-amber-200"
          >
            {isRenderBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export
          </Button>
          {lastError && (
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-9 px-3 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Export Error
                </Button>
              </DialogTrigger>
              <DialogContent className="border-red-500/20 bg-slate-950 sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-red-500">Last Export Error</DialogTitle>
                  <DialogDescription className="text-sm text-slate-400">
                    {errorHeadline}
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-2">
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-red-500/20 bg-red-950/20 p-3 text-[11px] leading-5 text-red-200/90">
                    {lastError}
                  </pre>
                </div>
                <DialogFooter className="mt-4 sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-slate-400 hover:text-slate-300"
                    onClick={() => void onDeleteLastError?.()}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Error
                  </Button>
                  <div className="flex gap-2">
                    <DialogClose asChild>
                      <Button type="button" variant="outline" className="border-white/10 bg-transparent text-white hover:bg-white/5">
                        Close
                      </Button>
                    </DialogClose>
                    <Button
                      type="button"
                      className="bg-red-500 text-white hover:bg-red-600 border-red-500"
                      onClick={() => void onCopyLastError?.()}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Details
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </header>
  );
});

export function TimelineEditorWorkspace({ projectId }: { projectId: string }) {
  const topPanelsRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const timelinePreviewFrameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autosaveHashRef = useRef<string>("");
  const animationFrameIdRef = useRef<number | null>(null);
  const lastAnimationFrameRef = useRef<number | null>(null);
  const persistedPlayheadSecondsRef = useRef(0);
  const playheadRef = useRef(0);
  const pendingPreviewSeekSecondsRef = useRef<number | null>(null);
  const pendingPreviewSeekUntilRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isTimelinePreviewRef = useRef(false);
  const projectDurationRef = useRef(0);
  const clipboardRef = useRef<TimelineClipboardItem | null>(null);
  const dragVideoBlockRef = useRef<Pick<TimelineVideoBlockPlacement, "id" | "kind"> | null>(null);
  const dragAssetIdRef = useRef<string | null>(null);
  const dragAssetKindRef = useRef<EditorAssetRecord["kind"] | null>(null);
  const reversePreviewKeysByClipIdRef = useRef(new Map<string, Set<string>>());
  const reversePreviewInflightRef = useRef(new Map<string, Promise<void>>());
  const reversePreviewTokensRef = useRef(new Map<string, number>());
  const reversePreviewSessionRef = useRef(0);
  const renderSessionCounterRef = useRef(0);
  const exportSessionRef = useRef<ActiveBrowserRenderSession | null>(null);
  const bakeSessionRef = useRef<ActiveBrowserRenderSession | null>(null);
  const mountedRef = useRef(false);
  const projectStateRef = useRef<EditorProjectRecord | null>(null);
  const editorRepositoryRef = useRef(createDexieEditorRepository());
  const reactiveOverlayDecodedAudioCacheRef = useRef(new Map<string, Float32Array>());
  const reactiveOverlayAnalysisStateRef = useRef<{
    fingerprint: string;
    analysis: EditorReactiveAudioAnalysisTrack | null;
  }>({
    fingerprint: "",
    analysis: null,
  });
  const reactiveOverlayAnalysisRequestRef = useRef<{
    fingerprint: string;
    promise: Promise<EditorReactiveAudioAnalysisTrack | null>;
  } | null>(null);
  const reactiveOverlaySequenceCacheRef = useRef(new Map<string, ReactiveOverlayFrameSequence[]>());

  const {
    project: loadedProject,
    assets: loadedAssets,
    isLoading,
    error,
    saveProject,
    saveAssets,
    deleteAsset,
    resolveAssetFile,
  } = useEditorProject(projectId);
  const { history } = useHistoryLibrary(projectId);
  const { startTimelineBake, startTimelineExport, getTaskForResource, cancelTask } = useBackgroundTasks();

  const [project, setProject] = useState<EditorProjectRecord | null>(null);
  const [assets, setAssets] = useState<EditorAssetRecord[]>([]);
  const [resolvedAssets, setResolvedAssets] = useState<ResolvedEditorAsset[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const deferredLibrarySearch = useDeferredValue(librarySearch);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [exportResolution, setExportResolution] = useState<EditorResolution>("1080p");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportDestination, setExportDestination] = useState<ExportDestination | null>(null);
  const [isPickingExportDestination, setIsPickingExportDestination] = useState(false);
  const [isSavePickerSupported, setIsSavePickerSupported] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>({ kind: "timeline" });
  const [inspectorVideoTab, setInspectorVideoTab] = useState<InspectorVideoTab>("edit");
  const [selectedVideoClipIds, setSelectedVideoClipIds] = useState<string[]>([]);
  const [reversePreviewCache, setReversePreviewCache] = useState<Record<string, File>>({});
  const [reversePreviewLoadingKeys, setReversePreviewLoadingKeys] = useState<string[]>([]);
  const [reversePreviewFailedKeys, setReversePreviewFailedKeys] = useState<string[]>([]);
  const [draggingVideoBlockId, setDraggingVideoBlockId] = useState<string | null>(null);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [draggingAssetKind, setDraggingAssetKind] = useState<EditorAssetRecord["kind"] | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSubtitleHistoryDialogOpen, setIsSubtitleHistoryDialogOpen] = useState(false);
  const [focusedJoinedClipId, setFocusedJoinedClipId] = useState<string | null>(null);
  const [timelinePreviewFrameSize, setTimelinePreviewFrameSize] = useState({ width: 0, height: 0 });
  const [currentCaptionPreviewBlob, setCurrentCaptionPreviewBlob] = useState<Blob | null>(null);
  const [reactiveOverlayAnalysis, setReactiveOverlayAnalysis] = useState<EditorReactiveAudioAnalysisTrack | null>(null);
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibilityState>({
    left: true,
    center: true,
    right: true,
  });
  const [panelWidths, setPanelWidths] = useState({
    leftPct: 24,
    rightPct: 24,
  });
  const activeExportTask = getTaskForResource({ kind: "timeline-export", projectId });
  const activeBakeTask = getTaskForResource({ kind: "timeline-bake", projectId });
  const isExporting = Boolean(activeExportTask && isBackgroundTaskActive(activeExportTask));
  const isBakingClip = Boolean(activeBakeTask && isBackgroundTaskActive(activeBakeTask));
  const isRenderBusy = isExporting || isBakingClip;
  const isInteractionLocked = isBakingClip;

  const beginRenderSession = useCallback(() => {
    return createActiveBrowserRenderSession(++renderSessionCounterRef.current);
  }, []);

  const createTaskLogSync = useCallback(
    (task: { update: (patch: { logLines?: string[] }) => void }) => {
      let startedAt = 0;
      let lines: string[] = [];

      const pushLine = (message: string, reset = false) => {
        const now = Date.now();
        if (reset || startedAt <= 0) {
          startedAt = now;
          lines = [];
        }
        const line = formatEditorTaskLogLine(message, startedAt, now);
        if (lines[lines.length - 1] === line) return;
        lines =
          lines.length >= EDITOR_TASK_LOG_LIMIT
            ? [...lines.slice(lines.length - (EDITOR_TASK_LOG_LIMIT - 1)), line]
            : [...lines, line];
        task.update({ logLines: lines });
      };

      return {
        begin(message: string) {
          pushLine(message, true);
        },
        append(message: string) {
          pushLine(message);
        },
      };
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    projectStateRef.current = project;
  }, [project]);

  useEffect(() => {
    setIsSavePickerSupported(isEditorSavePickerSupported());
  }, []);

  useEffect(() => {
    const element = timelinePreviewFrameRef.current;
    if (!element) return;

    const syncSize = () => {
      const rect = element.getBoundingClientRect();
      const nextWidth = Math.max(0, Math.round(rect.width));
      const nextHeight = Math.max(0, Math.round(rect.height));
      setTimelinePreviewFrameSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      );
    };

    syncSize();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      syncSize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [panelVisibility.center, previewMode.kind, project?.aspectRatio]);

  const handleOpenExportDialog = useCallback(() => {
    setIsExportDialogOpen(true);
  }, []);

  const handleExportResolutionChange = useCallback((nextResolution: EditorResolution) => {
    setExportResolution(nextResolution);
    setExportDestination(null);
  }, []);

  const handlePickExportDestination = useCallback(async () => {
    if (!project) return;

    setIsPickingExportDestination(true);
    try {
      const suggestedName = buildEditorExportFilename(
        project.name,
        project.aspectRatio,
        exportResolution
      );
      const handle = await pickEditorSaveFileHandle(suggestedName);
      if (!handle) return;
      setExportDestination({
        handle,
        name: handle.name,
      });
    } catch (error) {
      console.error("Failed to choose export destination", error);
      const message =
        error instanceof Error ? error.message : "Could not choose an export destination.";
      toast.error(message);
    } finally {
      setIsPickingExportDestination(false);
    }
  }, [exportResolution, project]);

  const historyMap = useMemo(() => new Map(history.map((item) => [item.id, item])), [history]);

  useEffect(() => {
    if (!loadedProject) return;
    const hydratedProject = ensureProjectSelection(
      applyResolvedSubtitleStyle(
        hydrateProjectSubtitleTrackFromLegacyCaptions({
          project: {
            ...normalizeLegacyEditorProjectRecord(loadedProject),
            assetIds: loadedAssets.map((asset) => asset.id),
          },
          assets: loadedAssets,
          historyMap,
        })
      )
    );
    const hydratedDuration = getProjectDuration(hydratedProject);
    const hydratedPlayheadSeconds = clampNumber(
      hydratedProject.timeline.playheadSeconds,
      0,
      Math.max(hydratedDuration, 0)
    );
    const hydratedSnapshot = getEditorProjectPersistenceFingerprint(
      hydratedProject,
      loadedAssets.map((asset) => asset.id),
      hydratedPlayheadSeconds
    );

    if (autosaveHashRef.current === hydratedSnapshot) {
      return;
    }

    const shouldResetPlayhead = project?.id !== hydratedProject.id;
    setProject(hydratedProject);
    setAssets(loadedAssets);
    persistedPlayheadSecondsRef.current = hydratedPlayheadSeconds;
    if (shouldResetPlayhead) {
      projectDurationRef.current = hydratedDuration;
      playheadRef.current = hydratedPlayheadSeconds;
      setPlayheadSeconds(hydratedPlayheadSeconds);
    }
    autosaveHashRef.current = hydratedSnapshot;
    setSaveState("saved");
  }, [historyMap, loadedAssets, loadedProject, project?.id]);

  useEffect(() => {
    let cancelled = false;
    const resolveAssets = async () => {
      const nextResolved = await Promise.all(
        assets.map(async (asset) => {
          if (asset.sourceType === "upload") {
            return {
              asset,
              file: asset.fileBlob ?? null,
              missing: !asset.fileBlob,
            };
          }
          const mediaId = asset.sourceAssetId ?? asset.sourceMediaId ?? asset.sourceProjectId;
          const mediaFile = mediaId ? await resolveAssetFile(mediaId) : undefined;
          return {
            asset,
            file: mediaFile?.file ?? null,
            missing: !mediaFile?.file,
          };
        })
      );
      if (!cancelled) setResolvedAssets(nextResolved);
    };
    void resolveAssets();
    return () => {
      cancelled = true;
    };
  }, [assets, resolveAssetFile]);

  useEffect(() => {
    reversePreviewSessionRef.current += 1;
    reversePreviewKeysByClipIdRef.current.clear();
    reversePreviewInflightRef.current.clear();
    reversePreviewTokensRef.current.clear();
    setReversePreviewCache({});
    setReversePreviewLoadingKeys([]);
    setReversePreviewFailedKeys([]);
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    const snapshot = getEditorProjectPersistenceFingerprint(
      project,
      assets.map((asset) => asset.id),
      persistedPlayheadSecondsRef.current
    );
    if (snapshot === autosaveHashRef.current) return;

    setSaveState("dirty");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const savedRecord = markEditorProjectSaved(
        serializeEditorProjectForPersistence(
          {
            ...project,
            assetIds: assets.map((asset) => asset.id),
          },
          persistedPlayheadSecondsRef.current
        ),
        Date.now()
      );
      persistedPlayheadSecondsRef.current = savedRecord.timeline.playheadSeconds;
      autosaveHashRef.current = getEditorProjectPersistenceFingerprint(
        savedRecord,
        assets.map((asset) => asset.id),
        savedRecord.timeline.playheadSeconds
      );
      await saveProject(savedRecord);
      setProject(savedRecord);
      setSaveState("saved");
    }, 500);

    return () => window.clearTimeout(timer);
  }, [assets, project, saveProject]);

  const resolvedAssetsMap = useMemo(() => new Map(resolvedAssets.map((entry) => [entry.asset.id, entry])), [resolvedAssets]);
  const hasAudioCapableTimelineAsset = useMemo(
    () =>
      resolvedAssets.some(
        (entry) => Boolean(entry.file) && (entry.asset.kind === "audio" || (entry.asset.kind === "video" && entry.asset.hasAudio))
      ),
    [resolvedAssets]
  );
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const clipPlacements = useMemo(
    () => (project ? getTimelineClipPlacements(project.timeline.videoClips) : []),
    [project]
  );
  const videoClipGroups = useMemo(
    () => project?.timeline.videoClipGroups ?? [],
    [project]
  );
  const videoBlockPlacements = useMemo(
    () => (project ? getTimelineVideoBlockPlacements(project.timeline.videoClips, project.timeline.videoClipGroups) : []),
    [project]
  );
  const audioPlacements = useMemo(
    () => (project ? getTimelineAudioPlacements(project.timeline.audioItems) : []),
    [project]
  );
  const imagePlacements = useMemo(
    () => (project ? getTimelineImagePlacements(project) : []),
    [project]
  );
  const projectDuration = useMemo(() => (project ? getProjectDuration(project) : 0), [project]);
  const exportCapability = useMemo(
    () =>
      project
        ? getEditorExportCapability({
            project,
            assets: resolvedAssets.map(({ asset }) => ({ asset })),
          })
        : { supported: false, reasons: [] as string[] },
    [project, resolvedAssets]
  );
  const exportBlockingReasons = useMemo(() => {
    const reasons = [...exportCapability.reasons];

    if (!project) {
      reasons.push("Project data is still loading.");
      return reasons;
    }

    const missingTimelineAsset = project.timeline.videoClips.some(
      (clip) => resolvedAssetsMap.get(clip.assetId)?.missing
    );
    const missingImageAsset = project.timeline.imageItems.some(
      (item) => resolvedAssetsMap.get(item.assetId)?.missing
    );
    const missingAudioAsset = project.timeline.audioItems.some(
      (item) => resolvedAssetsMap.get(item.assetId)?.missing
    );
    if (missingTimelineAsset || missingImageAsset || missingAudioAsset) {
      reasons.push("One or more timeline assets are missing. Replace them before exporting.");
    }
    if (isSavePickerSupported && !exportDestination) {
      reasons.push("Choose where to save the exported MP4.");
    }

    return reasons;
  }, [exportCapability.reasons, exportDestination, isSavePickerSupported, project, resolvedAssetsMap]);

  const selectedItem = project?.timeline.selectedItem;
  const clipMap = useMemo(
    () => new Map((project?.timeline.videoClips ?? []).map((clip) => [clip.id, clip])),
    [project]
  );
  const audioItemMap = useMemo(
    () => new Map((project?.timeline.audioItems ?? []).map((item) => [item.id, item])),
    [project]
  );
  const videoGroupMap = useMemo(
    () => new Map(videoClipGroups.map((group) => [group.id, group])),
    [videoClipGroups]
  );
  const videoGroupBlockMap = useMemo(
    () =>
      new Map(
        videoBlockPlacements
          .filter((block): block is Extract<TimelineVideoBlockPlacement, { kind: "group" }> => block.kind === "group")
          .map((block) => [block.id, block])
      ),
    [videoBlockPlacements]
  );
  const videoTrackEnd = clipPlacements.at(-1)?.endSeconds ?? 0;
  const audioTrackEnd = audioPlacements.at(-1)?.endSeconds ?? 0;
  const selectedClip = useMemo(
    () =>
      selectedItem?.kind === "video"
        ? project?.timeline.videoClips.find((clip) => clip.id === selectedItem.id)
        : undefined,
    [project, selectedItem]
  );
  const selectedVideoGroup = useMemo(
    () =>
      selectedItem?.kind === "video-group"
        ? findTimelineClipGroup(videoClipGroups, selectedItem.id)
        : undefined,
    [selectedItem, videoClipGroups]
  );
  const selectedAudioItem = useMemo(
    () =>
      selectedItem?.kind === "audio"
        ? project?.timeline.audioItems.find((item) => item.id === selectedItem.id)
        : undefined,
    [project, selectedItem]
  );
  const selectedImageItem = useMemo(
    () =>
      selectedItem?.kind === "image"
        ? project?.timeline.imageItems.find((item) => item.id === selectedItem.id)
        : undefined,
    [project, selectedItem]
  );
  const selectedOverlayItem = useMemo(
    () =>
      selectedItem?.kind === "overlay"
        ? project?.timeline.overlayItems.find((item) => item.id === selectedItem.id)
        : undefined,
    [project, selectedItem]
  );
  const subtitleTrackAvailable = useMemo(() => (project ? hasProjectSubtitleTrack(project) : false), [project]);
  const selectedSubtitleTrack = useMemo(
    () =>
      selectedItem?.kind === "subtitle" && project && subtitleTrackAvailable
        ? project.subtitles
        : undefined,
    [project, selectedItem, subtitleTrackAvailable]
  );
  const selectedGroupClipPlacements = useMemo(
    () =>
      selectedVideoGroup
        ? clipPlacements.filter((placement) => selectedVideoGroup.clipIds.includes(placement.clip.id))
        : [],
    [clipPlacements, selectedVideoGroup]
  );
  const getTimelineTrackActionState = useCallback(
    (selection: TimelineSelection | undefined): TimelineTrackActionState => {
      if (!selection) {
        return {
          canCloneToFill: false,
          canTrimToMatch: false,
        };
      }

      if (selection.kind === "video") {
        const lastPlacement = clipPlacements.at(-1);
        const overshootSeconds = videoTrackEnd - audioTrackEnd;
        return {
          canCloneToFill: clipMap.has(selection.id) && audioTrackEnd > videoTrackEnd,
          canTrimToMatch:
            lastPlacement?.clip.id === selection.id &&
            overshootSeconds > 0 &&
            lastPlacement.durationSeconds - overshootSeconds >= 0.5,
        };
      }

      if (selection.kind === "video-group") {
        const lastBlock = videoBlockPlacements.at(-1);
        const groupBlock = videoGroupBlockMap.get(selection.id);
        const tailPlacement = groupBlock?.clipPlacements.at(-1);
        const overshootSeconds = videoTrackEnd - audioTrackEnd;
        return {
          canCloneToFill: videoGroupMap.has(selection.id) && audioTrackEnd > videoTrackEnd,
          canTrimToMatch:
            lastBlock?.kind === "group" &&
            lastBlock.id === selection.id &&
            Boolean(tailPlacement) &&
            overshootSeconds > 0 &&
            (tailPlacement?.durationSeconds ?? 0) - overshootSeconds >= 0.5,
        };
      }

      if (selection.kind === "image") {
        return {
          canCloneToFill: false,
          canTrimToMatch: false,
        };
      }

      if (selection.kind === "overlay") {
        return {
          canCloneToFill: false,
          canTrimToMatch: false,
        };
      }

      if (selection.kind === "subtitle") {
        return {
          canCloneToFill: false,
          canTrimToMatch: false,
        };
      }

      const lastPlacement = audioPlacements.at(-1);
      const overshootSeconds = audioTrackEnd - videoTrackEnd;
      return {
        canCloneToFill: audioItemMap.has(selection.id) && videoTrackEnd > audioTrackEnd,
        canTrimToMatch:
          lastPlacement?.item.id === selection.id &&
          overshootSeconds > 0 &&
          lastPlacement.durationSeconds - overshootSeconds >= 0.5,
      };
    },
    [
      audioItemMap,
      audioPlacements,
      audioTrackEnd,
      clipMap,
      clipPlacements,
      videoBlockPlacements,
      videoGroupBlockMap,
      videoGroupMap,
      videoTrackEnd,
    ]
  );
  const selectedTrackActionState = useMemo(
    () => getTimelineTrackActionState(selectedItem),
    [getTimelineTrackActionState, selectedItem]
  );
  const focusedJoinedClip = useMemo(() => {
    if (!selectedVideoGroup || !project) return undefined;
    const fallbackClipId = selectedVideoGroup.clipIds[0];
    const focusedClipId =
      focusedJoinedClipId && selectedVideoGroup.clipIds.includes(focusedJoinedClipId)
        ? focusedJoinedClipId
        : fallbackClipId;
    return project.timeline.videoClips.find((clip) => clip.id === focusedClipId);
  }, [focusedJoinedClipId, project, selectedVideoGroup]);
  const inspectorClip = selectedClip ?? focusedJoinedClip;
  const inspectorClipAsset = useMemo(
    () => (inspectorClip ? assetMap.get(inspectorClip.assetId) : undefined),
    [assetMap, inspectorClip]
  );
  const selectedAudioAsset = useMemo(
    () => (selectedAudioItem ? assetMap.get(selectedAudioItem.assetId) : undefined),
    [assetMap, selectedAudioItem]
  );
  const selectedImageAsset = useMemo(
    () => (selectedImageItem ? assetMap.get(selectedImageItem.assetId) : undefined),
    [assetMap, selectedImageItem]
  );
  const selectedImageCoverZoom = useMemo(() => {
    if (!project || !selectedImageAsset?.width || !selectedImageAsset?.height) return 1;
    const { width, height } = getEditorOutputDimensions(project.aspectRatio, "1080p");
    return getEditorCanvasCoverZoom({
      sourceWidth: selectedImageAsset.width,
      sourceHeight: selectedImageAsset.height,
      outputWidth: width,
      outputHeight: height,
    });
  }, [project, selectedImageAsset?.height, selectedImageAsset?.width]);
  const imageZoomSliderMax = useMemo(() => {
    const currentZoom = selectedImageItem?.canvas.zoom ?? 1;
    return Math.min(
      IMAGE_TRACK_MAX_ZOOM,
      Math.max(2.4, Math.ceil(Math.max(selectedImageCoverZoom, currentZoom) * 10) / 10 + 0.2)
    );
  }, [selectedImageCoverZoom, selectedImageItem?.canvas.zoom]);
  const selectedSubtitleSourceDuration = useMemo(() => {
    if (!selectedSubtitleTrack) return 0;
    return selectedSubtitleTrack.chunks.reduce((max, chunk) => {
      const start = chunk.timestamp?.[0];
      const end = chunk.timestamp?.[1];
      const safeStart = typeof start === "number" && Number.isFinite(start) ? start : 0;
      const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : safeStart;
      return Math.max(max, safeEnd);
    }, 0);
  }, [selectedSubtitleTrack]);
  const effectiveSubtitleTimingMode = useMemo<CreatorSubtitleTimingMode>(() => {
    if (!project || !subtitleTrackAvailable) return "segment";
    return getProjectSubtitleTrackEffectiveTimingMode({
      project,
      historyMap,
    });
  }, [historyMap, project, subtitleTrackAvailable]);
  const activePlacement = useMemo(() => {
    return (
      clipPlacements.find(
        (placement) =>
          playheadSeconds >= placement.startSeconds &&
          playheadSeconds < placement.endSeconds
      ) ?? clipPlacements[0]
    );
  }, [clipPlacements, playheadSeconds]);
  const activeAudioPlacement = useMemo(() => {
    return audioPlacements.find(
      (placement) =>
        playheadSeconds >= placement.startSeconds &&
        playheadSeconds < placement.endSeconds
    );
  }, [audioPlacements, playheadSeconds]);
  const activeImagePlacement = useMemo(() => {
    return (
      imagePlacements.find(
        (placement) =>
          playheadSeconds >= placement.startSeconds &&
          playheadSeconds < placement.endSeconds
      ) ?? imagePlacements[0]
    );
  }, [imagePlacements, playheadSeconds]);
  const overlayPlacements = useMemo(
    () => (project ? getTimelineOverlayPlacements(project.timeline.overlayItems, getProjectDuration(project)) : []),
    [project]
  );
  const activeOverlayPlacements = useMemo(
    () =>
      overlayPlacements.filter(
        (placement) =>
          playheadSeconds >= placement.startSeconds &&
          playheadSeconds < placement.endSeconds
      ),
    [overlayPlacements, playheadSeconds]
  );
  const activeResolvedAsset = activePlacement ? resolvedAssetsMap.get(activePlacement.clip.assetId) : undefined;
  const activeResolvedImageAsset = activeImagePlacement ? resolvedAssetsMap.get(activeImagePlacement.item.assetId) : undefined;
  const activeResolvedAudioAsset = activeAudioPlacement ? resolvedAssetsMap.get(activeAudioPlacement.item.assetId) : undefined;
  const subtitleTrackTimeline = useMemo(() => {
    if (!project || !subtitleTrackAvailable) return [] as TimelineCaptionChunk[];
    return buildProjectSubtitleTimeline({
      project: {
        ...project,
        subtitles: {
          ...project.subtitles,
          enabled: true,
        },
      },
      historyMap,
    });
  }, [historyMap, project, subtitleTrackAvailable]);
  const subtitleTrackDuration = subtitleTrackTimeline.reduce((max, chunk) => {
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1];
    const safeStart = typeof start === "number" && Number.isFinite(start) ? start : 0;
    const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : safeStart;
    return Math.max(max, safeEnd);
  }, 0);
  const captionTimeline = useMemo(() => {
    if (!project) return [] as TimelineCaptionChunk[];
    return buildProjectCaptionTimeline({
      project,
      assets,
      historyMap,
    });
  }, [assets, historyMap, project]);
  const currentCaption = useMemo(() => {
    return captionTimeline.find((chunk) => {
      const start = chunk.timestamp?.[0] ?? 0;
      const end = chunk.timestamp?.[1] ?? start;
      return playheadSeconds >= start && playheadSeconds <= end;
    });
  }, [captionTimeline, playheadSeconds]);
  const filteredHistory = useMemo(() => {
    const query = deferredLibrarySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter((item) => item.filename.toLowerCase().includes(query));
  }, [deferredLibrarySearch, history]);
  const historyItemsWithSubtitles = useMemo(
    () =>
      history.filter((item) => {
        const transcript = getLatestTranscript(item);
        return Boolean(transcript?.subtitles.length);
      }),
    [history]
  );
  const isTimelinePreview = previewMode.kind === "timeline";
  const previewedAsset =
    previewMode.kind === "asset" ? assets.find((asset) => asset.id === previewMode.assetId) : undefined;
  const previewedResolvedAsset = previewedAsset ? resolvedAssetsMap.get(previewedAsset.id) : undefined;
  const previewVideoAsset = isTimelinePreview ? activeResolvedAsset : previewedResolvedAsset?.asset.kind === "video" ? previewedResolvedAsset : undefined;
  const previewImageAsset = isTimelinePreview
    ? activeResolvedImageAsset
    : previewedResolvedAsset?.asset.kind === "image"
    ? previewedResolvedAsset
    : undefined;
  const previewAudioAsset = isTimelinePreview
    ? activeResolvedAudioAsset
    : previewedResolvedAsset?.asset.kind === "audio"
    ? previewedResolvedAsset
    : undefined;
  const previewVideoUrl = useObjectUrl(previewVideoAsset?.file);
  const previewImageUrl = useObjectUrl(previewImageAsset?.file);
  const previewAudioUrl = useObjectUrl(previewAudioAsset?.file);
  const reactiveOverlayAnalysisFingerprint = useMemo(() => {
    if (!project || project.timeline.overlayItems.length === 0) return "";
    return JSON.stringify({
      overlays: project.timeline.overlayItems.map((item) => ({
        id: item.id,
        presetId: item.presetId,
        behavior: item.behavior,
      })),
      video: project.timeline.videoClips.map((clip) => ({
        id: clip.id,
        assetId: clip.assetId,
        trimStartSeconds: clip.trimStartSeconds,
        trimEndSeconds: clip.trimEndSeconds,
        volume: clip.volume,
        muted: clip.muted,
        reverse: clip.actions.reverse,
      })),
      audio: project.timeline.audioItems.map((item) => ({
        id: item.id,
        assetId: item.assetId,
        startOffsetSeconds: item.startOffsetSeconds,
        trimStartSeconds: item.trimStartSeconds,
        trimEndSeconds: item.trimEndSeconds,
        volume: item.volume,
        muted: item.muted,
      })),
      assets: resolvedAssets
        .filter(
          (entry) =>
            Boolean(entry.file) &&
            (entry.asset.kind === "audio" || (entry.asset.kind === "video" && entry.asset.hasAudio))
        )
        .map((entry) => ({
          id: entry.asset.id,
          updatedAt: entry.asset.updatedAt,
          size: entry.asset.sizeBytes,
      })),
    });
  }, [project, resolvedAssets]);
  const buildReactiveOverlaySequenceCacheKey = useCallback(
    (projectRecord: EditorProjectRecord, resolution: EditorResolution) => {
      const { width, height } = getEditorOutputDimensions(projectRecord.aspectRatio, resolution);
      return JSON.stringify({
        analysisFingerprint: reactiveOverlayAnalysisFingerprint,
        aspectRatio: projectRecord.aspectRatio,
        resolution,
        width,
        height,
        overlays: projectRecord.timeline.overlayItems.map((item) => ({
          id: item.id,
          presetId: item.presetId,
          behavior: item.behavior,
          startOffsetSeconds: item.startOffsetSeconds,
          durationSeconds: item.durationSeconds,
          positionXPercent: item.positionXPercent,
          positionYPercent: item.positionYPercent,
          widthPercent: item.widthPercent,
          heightPercent: item.heightPercent,
          scale: item.scale,
          opacity: item.opacity,
          tintHex: item.tintHex,
          sensitivity: item.behavior === "audio_reactive" ? item.sensitivity : undefined,
          smoothing: item.behavior === "audio_reactive" ? item.smoothing : undefined,
          loopDurationSeconds: item.behavior === "autonomous" ? item.loopDurationSeconds : undefined,
          motionAmount: item.behavior === "autonomous" ? item.motionAmount : undefined,
          seed: item.behavior === "autonomous" ? item.seed : undefined,
          emoji: item.behavior === "autonomous" ? item.emoji : undefined,
        })),
      });
    },
    [reactiveOverlayAnalysisFingerprint]
  );
  const subtitlePreviewRenderSize = useMemo(
    () => (project ? getEditorOutputDimensions(project.aspectRatio, "1080p") : null),
    [project]
  );

  useEffect(() => {
    if (!project || project.timeline.overlayItems.length === 0 || !project.timeline.overlayItems.some(isAudioReactiveMotionOverlayItem)) {
      reactiveOverlayAnalysisStateRef.current = {
        fingerprint: "",
        analysis: null,
      };
      reactiveOverlayAnalysisRequestRef.current = null;
      setReactiveOverlayAnalysis(null);
      return;
    }

    const controller = new AbortController();
    const fingerprint = reactiveOverlayAnalysisFingerprint;
    const analysisPromise = (async () => {
      const decodedSamplesByAssetId = new Map<string, Float32Array>();
      const relevantAssets = resolvedAssets.filter(
        (entry) =>
          Boolean(entry.file) &&
          (entry.asset.kind === "audio" || (entry.asset.kind === "video" && entry.asset.hasAudio))
      );

      for (const entry of relevantAssets) {
        if (controller.signal.aborted || !entry.file) return null;
        const cacheKey = `${entry.asset.id}:${entry.asset.updatedAt}:${entry.asset.sizeBytes}`;
        const cached = reactiveOverlayDecodedAudioCacheRef.current.get(cacheKey);
        if (cached) {
          decodedSamplesByAssetId.set(entry.asset.id, cached);
          continue;
        }

        const decoded = await decodeAudio(entry.file);
        if (controller.signal.aborted) return null;
        reactiveOverlayDecodedAudioCacheRef.current.set(cacheKey, decoded);
        decodedSamplesByAssetId.set(entry.asset.id, decoded);
      }

      const analysis = buildProjectReactiveOverlayAudioAnalysis({
        project,
        decodedSamplesByAssetId,
      });
      if (controller.signal.aborted) return null;
      return analysis;
    })();
    reactiveOverlayAnalysisRequestRef.current = {
      fingerprint,
      promise: analysisPromise,
    };

    void analysisPromise.then((analysis) => {
      if (controller.signal.aborted || !analysis) return;
      reactiveOverlayAnalysisStateRef.current = {
        fingerprint,
        analysis,
      };
      startTransition(() => {
        setReactiveOverlayAnalysis(analysis);
      });
    }).catch(() => {
      if (controller.signal.aborted) return;
      reactiveOverlayAnalysisStateRef.current = {
        fingerprint: "",
        analysis: null,
      };
      setReactiveOverlayAnalysis(null);
    });

    return () => {
      controller.abort();
      if (reactiveOverlayAnalysisRequestRef.current?.fingerprint === fingerprint) {
        reactiveOverlayAnalysisRequestRef.current = null;
      }
    };
  }, [project, reactiveOverlayAnalysisFingerprint, resolvedAssets]);
  const currentCaptionStyle = useMemo(
    () => (project ? resolveCreatorSubtitleStyle(project.subtitles.preset, project.subtitles.style) : null),
    [project]
  );
  const currentCaptionLayout = useMemo(() => {
    if (!project || !currentCaption || !subtitlePreviewRenderSize) {
      return null;
    }
    return resolveEditorSubtitleTextLayout({
      width: subtitlePreviewRenderSize.width,
      height: subtitlePreviewRenderSize.height,
      text: String(currentCaption.text ?? ""),
      project,
    });
  }, [currentCaption, project, subtitlePreviewRenderSize]);
  const currentCaptionPreviewScale = useMemo(() => {
    if (!subtitlePreviewRenderSize || timelinePreviewFrameSize.width <= 0 || timelinePreviewFrameSize.height <= 0) {
      return 1;
    }
    return Math.min(
      timelinePreviewFrameSize.width / subtitlePreviewRenderSize.width,
      timelinePreviewFrameSize.height / subtitlePreviewRenderSize.height
    );
  }, [subtitlePreviewRenderSize, timelinePreviewFrameSize.height, timelinePreviewFrameSize.width]);
  const currentCaptionPreviewUrl = useObjectUrl(currentCaptionPreviewBlob);
  const timelineImagePreviewLayout = useMemo(() => {
    if (
      !isTimelinePreview ||
      !activeImagePlacement ||
      !previewImageAsset?.asset.width ||
      !previewImageAsset.asset.height ||
      timelinePreviewFrameSize.width <= 0 ||
      timelinePreviewFrameSize.height <= 0
    ) {
      return null;
    }

    return buildEditorCanvasPreviewLayout({
      sourceWidth: previewImageAsset.asset.width,
      sourceHeight: previewImageAsset.asset.height,
      canvas: activeImagePlacement.item.canvas,
      viewportWidth: timelinePreviewFrameSize.width,
      viewportHeight: timelinePreviewFrameSize.height,
    });
  }, [
    activeImagePlacement,
    isTimelinePreview,
    previewImageAsset?.asset.height,
    previewImageAsset?.asset.width,
    timelinePreviewFrameSize.height,
    timelinePreviewFrameSize.width,
  ]);
  const activeReactiveOverlayPreviewItems = useMemo(() => {
    if (
      !isTimelinePreview ||
      timelinePreviewFrameSize.width <= 0 ||
      timelinePreviewFrameSize.height <= 0
    ) {
      return [];
    }

    return activeOverlayPlacements.map((placement) => {
      const rect = resolveMotionOverlayRect({
        overlay: placement.item,
        frameWidth: timelinePreviewFrameSize.width,
        frameHeight: timelinePreviewFrameSize.height,
      });
      return {
        placement,
        rect,
        frame: resolveMotionOverlayFrame({
          overlay: placement.item,
          rect,
          analysis: placement.item.behavior === "audio_reactive" ? reactiveOverlayAnalysis : null,
          projectTimeSeconds: playheadSeconds,
          localTimeSeconds: Math.max(0, playheadSeconds - placement.startSeconds),
        }),
      };
    });
  }, [
    activeOverlayPlacements,
    isTimelinePreview,
    playheadSeconds,
    reactiveOverlayAnalysis,
    timelinePreviewFrameSize.height,
    timelinePreviewFrameSize.width,
  ]);
  const activeReversePreviewRequest = useMemo(() => {
    if (!isTimelinePreview || !activePlacement?.clip.actions.reverse || !activeResolvedAsset?.file) {
      return null;
    }

    return {
      key: buildReversedClipPreviewCacheKey({
        clip: activePlacement.clip,
        file: activeResolvedAsset.file,
      }),
      clipId: activePlacement.clip.id,
      clip: activePlacement.clip,
      file: activeResolvedAsset.file,
      hasAudio: Boolean(activeResolvedAsset.asset.hasAudio),
    };
  }, [activePlacement, activeResolvedAsset, isTimelinePreview]);
  const activeReversePreviewFile =
    activeReversePreviewRequest != null
      ? reversePreviewCache[activeReversePreviewRequest.key] ?? null
      : null;
  const activeReversePreviewUrl = useObjectUrl(activeReversePreviewFile);
  const activeReversePreviewFailed =
    activeReversePreviewRequest != null &&
    reversePreviewFailedKeys.includes(activeReversePreviewRequest.key);
  const isReversePreviewLoading =
    activeReversePreviewRequest != null &&
    reversePreviewLoadingKeys.includes(activeReversePreviewRequest.key);
  const isUsingActiveReversePreview =
    activeReversePreviewRequest != null && activeReversePreviewUrl != null;
  const selectedVideoClipSet = useMemo(() => new Set(selectedVideoClipIds), [selectedVideoClipIds]);
  const selectedVideoPlacements = useMemo(
    () =>
      clipPlacements
        .filter((placement) => selectedVideoClipSet.has(placement.clip.id))
        .sort((left, right) => left.index - right.index),
    [clipPlacements, selectedVideoClipSet]
  );
  const canJoinSelectedVideoClips = useMemo(
    () => (project ? canJoinTimelineClips(project.timeline.videoClips, project.timeline.videoClipGroups, selectedVideoClipIds) : false),
    [project, selectedVideoClipIds]
  );
  const effectiveTimelineVideoUrl =
    isTimelinePreview && activePlacement?.clip.actions.reverse
      ? activeReversePreviewFailed
        ? previewVideoUrl
        : activeReversePreviewUrl
      : previewVideoUrl;
  const timelineZoomLevel = Math.max(1, project?.timeline.zoomLevel ?? 1);
  const maxVisibleDuration = Math.max(projectDuration, 1);
  const minVisibleDuration = Math.min(maxVisibleDuration, Math.max(3, maxVisibleDuration * 0.15));
  const visibleDuration = clampNumber(maxVisibleDuration / timelineZoomLevel, minVisibleDuration, maxVisibleDuration);
  const maxVisibleStart = Math.max(0, maxVisibleDuration - visibleDuration);
  const visibleStart = clampNumber(playheadSeconds - visibleDuration / 2, 0, maxVisibleStart);
  const visibleEnd = visibleStart + visibleDuration;
  const timelineTickStep = visibleDuration <= 12 ? 1 : visibleDuration <= 30 ? 2 : visibleDuration <= 60 ? 5 : visibleDuration <= 180 ? 10 : 30;
  const timelineTicks = useMemo(() => {
    const ticks: number[] = [];
    const firstTick = Math.floor(visibleStart / timelineTickStep) * timelineTickStep;
    for (let second = firstTick; second <= visibleEnd + timelineTickStep; second += timelineTickStep) {
      if (second >= visibleStart && second <= visibleEnd) {
        ticks.push(second);
      }
    }
    return ticks;
  }, [timelineTickStep, visibleEnd, visibleStart]);
  const timelineMinorTickStep = Math.max(0.5, timelineTickStep / 2);
  const timelineMinorTicks = useMemo(() => {
    const ticks: number[] = [];
    const firstTick = Math.floor(visibleStart / timelineMinorTickStep) * timelineMinorTickStep;
    for (let second = firstTick; second <= visibleEnd + timelineMinorTickStep; second += timelineMinorTickStep) {
      const roundedSecond = Number(second.toFixed(3));
      const isMajorTick = timelineTicks.some((major) => Math.abs(major - roundedSecond) < 0.001);
      if (!isMajorTick && roundedSecond >= visibleStart && roundedSecond <= visibleEnd) {
        ticks.push(roundedSecond);
      }
    }
    return ticks;
  }, [timelineMinorTickStep, timelineTicks, visibleEnd, visibleStart]);
  const visibleVideoBlocks = useMemo(() => {
    return videoBlockPlacements.flatMap((block) => {
      const overlapStart = Math.max(block.startSeconds, visibleStart);
      const overlapEnd = Math.min(block.endSeconds, visibleEnd);
      if (overlapEnd <= overlapStart) return [];
      return [
        {
          ...block,
          leftPct: ((overlapStart - visibleStart) / visibleDuration) * 100,
          widthPct: ((overlapEnd - overlapStart) / visibleDuration) * 100,
        },
      ];
    });
  }, [videoBlockPlacements, visibleDuration, visibleEnd, visibleStart]);
  const visibleImagePlacements = useMemo(() => {
    return imagePlacements.flatMap((placement) => {
      const overlapStart = Math.max(placement.startSeconds, visibleStart);
      const overlapEnd = Math.min(placement.endSeconds, visibleEnd);
      if (overlapEnd <= overlapStart) return [];
      return [
        {
          ...placement,
          leftPct: ((overlapStart - visibleStart) / visibleDuration) * 100,
          widthPct: ((overlapEnd - overlapStart) / visibleDuration) * 100,
        },
      ];
    });
  }, [imagePlacements, visibleDuration, visibleEnd, visibleStart]);
  const visibleOverlayPlacements = useMemo(() => {
    return overlayPlacements.flatMap((placement) => {
      const overlapStart = Math.max(placement.startSeconds, visibleStart);
      const overlapEnd = Math.min(placement.endSeconds, visibleEnd);
      if (overlapEnd <= overlapStart) return [];
      return [
        {
          ...placement,
          leftPct: ((overlapStart - visibleStart) / visibleDuration) * 100,
          widthPct: ((overlapEnd - overlapStart) / visibleDuration) * 100,
        },
      ];
    });
  }, [overlayPlacements, visibleDuration, visibleEnd, visibleStart]);
  const visibleAudioPlacements = useMemo(() => {
    return audioPlacements.flatMap((placement) => {
      const overlapStart = Math.max(placement.startSeconds, visibleStart);
      const overlapEnd = Math.min(placement.endSeconds, visibleEnd);
      if (overlapEnd <= overlapStart) return [];
      return [
        {
          ...placement,
          leftPct: ((overlapStart - visibleStart) / visibleDuration) * 100,
          widthPct: ((overlapEnd - overlapStart) / visibleDuration) * 100,
        },
      ];
    });
  }, [audioPlacements, visibleDuration, visibleEnd, visibleStart]);
  const visibleSubtitleChunks = useMemo(() => {
    return subtitleTrackTimeline.flatMap((chunk, index) => {
      const rawStart = chunk.timestamp?.[0];
      if (typeof rawStart !== "number" || !Number.isFinite(rawStart)) return [];
      const rawEndValue = chunk.timestamp?.[1];
      const rawEnd = typeof rawEndValue === "number" && Number.isFinite(rawEndValue) ? rawEndValue : rawStart;
      const overlapStart = Math.max(rawStart, visibleStart);
      const overlapEnd = Math.min(rawEnd, visibleEnd);
      if (overlapEnd <= overlapStart) return [];
      return [
        {
          chunk,
          index,
          leftPct: ((overlapStart - visibleStart) / visibleDuration) * 100,
          widthPct: ((overlapEnd - overlapStart) / visibleDuration) * 100,
        },
      ];
    });
  }, [subtitleTrackTimeline, visibleDuration, visibleEnd, visibleStart]);
  const visibleSubtitleTrackBlock = useMemo(() => {
    if (!subtitleTrackAvailable || subtitleTrackTimeline.length === 0) return null;
    const trackStart = subtitleTrackTimeline.reduce((min, chunk) => {
      const start = chunk.timestamp?.[0];
      return typeof start === "number" && Number.isFinite(start) ? Math.min(min, start) : min;
    }, Number.POSITIVE_INFINITY);
    const overlapStart = Math.max(Number.isFinite(trackStart) ? trackStart : 0, visibleStart);
    const overlapEnd = Math.min(subtitleTrackDuration, visibleEnd);
    if (overlapEnd <= overlapStart) return null;
    return {
      leftPct: ((overlapStart - visibleStart) / visibleDuration) * 100,
      widthPct: ((overlapEnd - overlapStart) / visibleDuration) * 100,
    };
  }, [subtitleTrackAvailable, subtitleTrackDuration, subtitleTrackTimeline, visibleDuration, visibleEnd, visibleStart]);

  useEffect(() => {
    playheadRef.current = playheadSeconds;
  }, [playheadSeconds]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isTimelinePreviewRef.current = isTimelinePreview;
  }, [isTimelinePreview]);

  useEffect(() => {
    projectDurationRef.current = projectDuration;
  }, [projectDuration]);

  useEffect(() => {
    setPlayheadSeconds((current) => {
      const clamped = clampNumber(current, 0, projectDuration);
      return Math.abs(current - clamped) < 0.001 ? current : clamped;
    });
  }, [projectDuration]);

  useEffect(() => {
    if (panelVisibility.left) return;
    setIsHistoryOpen(false);
  }, [panelVisibility.left]);

  useEffect(() => {
    if (!isHistoryOpen || isInteractionLocked) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (historyPanelRef.current?.contains(target) || historyButtonRef.current?.contains(target))) {
        return;
      }
      setIsHistoryOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHistoryOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHistoryOpen, isInteractionLocked]);

  useEffect(() => {
    if (!isInteractionLocked) return;
    setIsHistoryOpen(false);
    setIsPlaying(false);
  }, [isInteractionLocked]);

  useEffect(() => {
    if (!isRenderBusy) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isRenderBusy]);

  useEffect(() => {
    if (!project || !currentCaption || !subtitlePreviewRenderSize || !project.subtitles.enabled) {
      setCurrentCaptionPreviewBlob(null);
      return;
    }

    const controller = new AbortController();
    void renderEditorSubtitlePreviewBlob({
      width: subtitlePreviewRenderSize.width,
      height: subtitlePreviewRenderSize.height,
      text: String(currentCaption.text ?? ""),
      project,
      signal: controller.signal,
    })
      .then((blob) => {
        if (controller.signal.aborted) return;
        setCurrentCaptionPreviewBlob(blob);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCurrentCaptionPreviewBlob(null);
      });

    return () => {
      controller.abort();
    };
  }, [currentCaption, project, subtitlePreviewRenderSize]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isTimelinePreview || !activePlacement) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }
    if (!effectiveTimelineVideoUrl) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }
    const clipMaxTime = Math.max(
      activePlacement.clip.trimStartSeconds,
      activePlacement.clip.trimEndSeconds - 0.001
    );
    const nextTime = clampNumber(
      isUsingActiveReversePreview
        ? playheadSeconds - activePlacement.startSeconds
        : getVideoClipMediaTime(
            activePlacement.clip,
            activePlacement.startSeconds,
            playheadSeconds
          ),
      isUsingActiveReversePreview ? 0 : activePlacement.clip.trimStartSeconds,
      isUsingActiveReversePreview ? Math.max(0, activePlacement.durationSeconds - 0.001) : clipMaxTime
    );
    if (!Number.isFinite(nextTime)) return;
    const isPendingSeek =
      pendingPreviewSeekSecondsRef.current != null &&
      Date.now() <= pendingPreviewSeekUntilRef.current &&
      Math.abs(playheadSeconds - pendingPreviewSeekSecondsRef.current) < 0.05;
    const seekThreshold =
      activePlacement.clip.actions.reverse && !isUsingActiveReversePreview
        ? 0.015
        : isPlaying
          ? 0.35
          : 0.05;
    if (isPendingSeek || Math.abs(video.currentTime - nextTime) > seekThreshold) {
      try {
        video.currentTime = nextTime;
      } catch {}
    }
  }, [activePlacement, effectiveTimelineVideoUrl, isPlaying, isTimelinePreview, isUsingActiveReversePreview, playheadSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (
      !isTimelinePreview ||
      !activePlacement ||
      !effectiveTimelineVideoUrl ||
      (activePlacement.clip.actions.reverse && !isUsingActiveReversePreview)
    ) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    if (isPlaying) {
      if (video.paused) {
        void video.play().catch(() => {});
      }
      return;
    }

    if (!video.paused) {
      video.pause();
    }
  }, [activePlacement, effectiveTimelineVideoUrl, isPlaying, isTimelinePreview, isUsingActiveReversePreview]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isTimelinePreview || !activePlacement) return;
    const shouldMute = activePlacement.clip.actions.reverse
      ? !isUsingActiveReversePreview || activePlacement.clip.muted
      : activePlacement.clip.muted;
    video.muted = shouldMute;
    video.volume = shouldMute ? 0 : clampNumber(activePlacement.clip.volume, 0, 1);
  }, [activePlacement, effectiveTimelineVideoUrl, isTimelinePreview, isUsingActiveReversePreview]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isTimelinePreview || !activeAudioPlacement) {
      if (!audio.paused) {
        audio.pause();
      }
      return;
    }
    const item = activeAudioPlacement.item;
    if (playheadSeconds < activeAudioPlacement.startSeconds || playheadSeconds > activeAudioPlacement.endSeconds || item.muted) {
      if (!audio.paused) {
        audio.pause();
      }
      return;
    }
    const currentTime = item.trimStartSeconds + (playheadSeconds - activeAudioPlacement.startSeconds);
    const isPendingSeek =
      pendingPreviewSeekSecondsRef.current != null &&
      Date.now() <= pendingPreviewSeekUntilRef.current &&
      Math.abs(playheadSeconds - pendingPreviewSeekSecondsRef.current) < 0.05;
    if (isPendingSeek || Math.abs(audio.currentTime - currentTime) > (isPlaying ? 0.35 : 0.05)) {
      try {
        audio.currentTime = currentTime;
      } catch {}
    }
    audio.volume = item.volume;
  }, [activeAudioPlacement, isPlaying, isTimelinePreview, playheadSeconds, previewAudioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (
      !isTimelinePreview ||
      !activeAudioPlacement ||
      !previewAudioUrl ||
      playheadSeconds < activeAudioPlacement.startSeconds ||
      playheadSeconds > activeAudioPlacement.endSeconds ||
      activeAudioPlacement.item.muted
    ) {
      if (!audio.paused) {
        audio.pause();
      }
      return;
    }

    if (isPlaying) {
      if (audio.paused) {
        void audio.play().catch(() => {});
      }
      return;
    }

    if (!audio.paused) {
      audio.pause();
    }
  }, [activeAudioPlacement, isPlaying, isTimelinePreview, playheadSeconds, previewAudioUrl]);

  useEffect(() => {
    if (!isTimelinePreview || !isPlaying) {
      if (animationFrameIdRef.current != null) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      lastAnimationFrameRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (!isPlayingRef.current || !isTimelinePreviewRef.current) {
        animationFrameIdRef.current = null;
        lastAnimationFrameRef.current = null;
        return;
      }

      const lastFrame = lastAnimationFrameRef.current ?? now;
      const deltaSeconds = Math.max(0, (now - lastFrame) / 1000);
      lastAnimationFrameRef.current = now;

      const video = videoRef.current;
      const audio = audioRef.current;
      const forcedSeekTime =
        pendingPreviewSeekSecondsRef.current != null &&
        Date.now() <= pendingPreviewSeekUntilRef.current
          ? pendingPreviewSeekSecondsRef.current
          : null;
      const mediaDrivenTime =
        video &&
        activePlacement &&
        effectiveTimelineVideoUrl &&
        !video.paused &&
        video.readyState >= 2
          ? getTimelinePlaybackTimeFromVideo({
              placement: activePlacement,
              currentTime: video.currentTime,
              isUsingReversePreview: isUsingActiveReversePreview,
            })
          : audio &&
              activeAudioPlacement &&
              previewAudioUrl &&
              !activeAudioPlacement.item.muted &&
              !audio.paused &&
              audio.readyState >= 2
            ? getTimelinePlaybackTimeFromAudio({
                placement: activeAudioPlacement,
              currentTime: audio.currentTime,
              })
            : null;
      const nextTime = Math.min(
        projectDurationRef.current,
        forcedSeekTime ?? mediaDrivenTime ?? (playheadRef.current + deltaSeconds)
      );
      if (forcedSeekTime != null) {
        pendingPreviewSeekSecondsRef.current = null;
        pendingPreviewSeekUntilRef.current = 0;
      }
      playheadRef.current = nextTime;

      startTransition(() => {
        setPlayheadSeconds((current) => {
          if (Math.abs(current - nextTime) < 0.001) {
            return current;
          }
          return nextTime;
        });
      });

      if (nextTime >= projectDurationRef.current) {
        animationFrameIdRef.current = null;
        lastAnimationFrameRef.current = null;
        setIsPlaying(false);
        return;
      }

      animationFrameIdRef.current = requestAnimationFrame(tick);
    };

    animationFrameIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameIdRef.current != null) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      lastAnimationFrameRef.current = null;
    };
  }, [
    activeAudioPlacement,
    activePlacement,
    effectiveTimelineVideoUrl,
    isPlaying,
    isTimelinePreview,
    isUsingActiveReversePreview,
    previewAudioUrl,
  ]);

  useEffect(() => {
    if (previewMode.kind === "timeline") return;
    setIsPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
  }, [previewMode.kind]);

  useEffect(() => {
    if (previewMode.kind === "timeline") return;
    if (assets.some((asset) => asset.id === previewMode.assetId)) return;
    setPreviewMode({ kind: "timeline" });
  }, [assets, previewMode]);

  useEffect(() => {
    const validVideoClipIds = new Set(project?.timeline.videoClips.map((clip) => clip.id) ?? []);
    setSelectedVideoClipIds((current) => {
      const filtered = current.filter((clipId) => validVideoClipIds.has(clipId));
      let next: string[];
      if (selectedItem?.kind !== "video") {
        next = [];
      } else if (filtered.length === 0 || !filtered.includes(selectedItem.id)) {
        next = [selectedItem.id];
      } else {
        next = filtered.slice(-2);
      }
      
      // Prevent returning a new array reference if contents are identical
      if (current.length === next.length && current.every((val, i) => val === next[i])) {
        return current;
      }
      return next;
    });

    if (selectedItem?.kind === "video-group") {
      setFocusedJoinedClipId((current) => {
        const nextClipId =
          current && selectedVideoGroup?.clipIds.includes(current)
            ? current
            : selectedVideoGroup?.clipIds[0] ?? null;
        return current === nextClipId ? current : nextClipId;
      });
    } else if (focusedJoinedClipId != null) {
      setFocusedJoinedClipId(null);
    }

    if (selectedItem?.kind === "audio" || selectedItem?.kind === "image" || selectedItem?.kind === "overlay") {
      setInspectorVideoTab((prev) => (prev === "edit" ? prev : "edit"));
    }
  }, [focusedJoinedClipId, project?.timeline.videoClips, selectedItem, selectedVideoGroup]);

  const invalidateReversePreviewCache = useCallback((clipId?: string) => {
    if (!clipId) {
      reversePreviewSessionRef.current += 1;
      reversePreviewKeysByClipIdRef.current.clear();
      reversePreviewInflightRef.current.clear();
      reversePreviewTokensRef.current.clear();
      setReversePreviewCache({});
      setReversePreviewLoadingKeys([]);
      setReversePreviewFailedKeys([]);
      return;
    }

    const keys = [...(reversePreviewKeysByClipIdRef.current.get(clipId) ?? [])];
    reversePreviewKeysByClipIdRef.current.delete(clipId);
    if (!keys.length) return;

    const keySet = new Set(keys);
    keys.forEach((key) => {
      reversePreviewTokensRef.current.set(
        key,
        (reversePreviewTokensRef.current.get(key) ?? 0) + 1
      );
      reversePreviewInflightRef.current.delete(key);
    });
    setReversePreviewCache((current) => omitReversePreviewCacheKeys(current, keySet));
    setReversePreviewLoadingKeys((current) =>
      current.some((key) => keySet.has(key))
        ? current.filter((key) => !keySet.has(key))
        : current
    );
    setReversePreviewFailedKeys((current) =>
      current.some((key) => keySet.has(key))
        ? current.filter((key) => !keySet.has(key))
        : current
    );
  }, []);

  useEffect(() => {
    if (!activeReversePreviewRequest) return;
    const { key, clipId, clip, file, hasAudio } = activeReversePreviewRequest;
    if (reversePreviewCache[key] || reversePreviewFailedKeys.includes(key)) return;

    const clipKeys = reversePreviewKeysByClipIdRef.current.get(clipId) ?? new Set<string>();
    clipKeys.add(key);
    reversePreviewKeysByClipIdRef.current.set(clipId, clipKeys);

    if (reversePreviewInflightRef.current.has(key)) return;

    const sessionId = reversePreviewSessionRef.current;
    const requestToken = reversePreviewTokensRef.current.get(key) ?? 0;
    setReversePreviewLoadingKeys((current) =>
      current.includes(key) ? current : [...current, key]
    );

    const request = renderReversedClipPreview({
      clip,
      file,
      hasAudio,
    })
      .then((previewFile) => {
        if (
          reversePreviewSessionRef.current !== sessionId ||
          (reversePreviewTokensRef.current.get(key) ?? 0) !== requestToken
        ) {
          return;
        }
        setReversePreviewCache((current) => ({
          ...current,
          [key]: previewFile,
        }));
        setReversePreviewFailedKeys((current) =>
          current.includes(key) ? current.filter((entry) => entry !== key) : current
        );
      })
      .catch((error) => {
        if (
          reversePreviewSessionRef.current !== sessionId ||
          (reversePreviewTokensRef.current.get(key) ?? 0) !== requestToken
        ) {
          return;
        }
        console.error("Failed to prepare reversed preview proxy", error);
        setReversePreviewFailedKeys((current) =>
          current.includes(key) ? current : [...current, key]
        );
        toast.error("Could not build the reversed preview. Falling back to direct playback.");
      })
      .finally(() => {
        if (reversePreviewInflightRef.current.get(key) !== request) {
          return;
        }
        reversePreviewInflightRef.current.delete(key);
        setReversePreviewLoadingKeys((current) =>
          current.includes(key) ? current.filter((entry) => entry !== key) : current
        );
      });

    reversePreviewInflightRef.current.set(key, request);
  }, [activeReversePreviewRequest, reversePreviewCache, reversePreviewFailedKeys]);

  const setTimelinePlayhead = useCallback((nextPlayheadSeconds: number) => {
    const clampedPlayheadSeconds = clampNumber(
      nextPlayheadSeconds,
      0,
      Math.max(projectDurationRef.current, 0)
    );
    pendingPreviewSeekSecondsRef.current = clampedPlayheadSeconds;
    pendingPreviewSeekUntilRef.current = Date.now() + 250;
    lastAnimationFrameRef.current = null;
    if (isTimelinePreviewRef.current && isPlayingRef.current) {
      videoRef.current?.pause();
      audioRef.current?.pause();
    }
    playheadRef.current = clampedPlayheadSeconds;
    setPlayheadSeconds((current) =>
      Math.abs(current - clampedPlayheadSeconds) < 0.001 ? current : clampedPlayheadSeconds
    );
  }, []);

  const updateProject = useCallback((updater: (current: EditorProjectRecord) => EditorProjectRecord) => {
    setProject((current) => {
      if (!current) return current;
      return ensureProjectSelection(updater(current));
    });
  }, []);

  const clearTimelineDragState = useCallback(() => {
    dragVideoBlockRef.current = null;
    dragAssetIdRef.current = null;
    dragAssetKindRef.current = null;
    setDraggingVideoBlockId(null);
    setDraggingAssetId(null);
    setDraggingAssetKind(null);
    setDropTargetIndex(null);
  }, []);

  const togglePanel = useCallback((panel: keyof PanelVisibilityState) => {
    setPanelVisibility((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }, []);

  const beginPanelResize = (target: "left" | "right") => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!topPanelsRef.current) return;
    event.preventDefault();
    const container = topPanelsRef.current;
    const { left, width } = container.getBoundingClientRect();
    const minSidePct = 16;
    const minCenterPct = 30;

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      const relativeX = moveEvent.clientX - left;
      setPanelWidths((current) => {
        if (target === "left") {
          const maxLeftPct = 100 - (panelVisibility.right ? current.rightPct : 0) - minCenterPct;
          return {
            ...current,
            leftPct: clampNumber((relativeX / width) * 100, minSidePct, maxLeftPct),
          };
        }
        const rightPct = ((left + width - moveEvent.clientX) / width) * 100;
        const maxRightPct = 100 - (panelVisibility.left ? current.leftPct : 0) - minCenterPct;
        return {
          ...current,
          rightPct: clampNumber(rightPct, minSidePct, maxRightPct),
        };
      });
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  const seekVisibleTimelineAtClientX = (clientX: number) => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const pct = clampNumber((clientX - rect.left) / rect.width, 0, 1);
    const nextTime = visibleStart + visibleDuration * pct;
    setPreviewMode({ kind: "timeline" });
    setTimelinePlayhead(nextTime);
  };

  const seekVisibleTimeline = (event: ReactMouseEvent<HTMLDivElement>) => {
    seekVisibleTimelineAtClientX(event.clientX);
  };

  const beginPlayheadDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsPlaying(false);
    seekVisibleTimelineAtClientX(event.clientX);

    const onPointerMove = (moveEvent: globalThis.PointerEvent) => {
      seekVisibleTimelineAtClientX(moveEvent.clientX);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };

  const updateInspectorClip = (updater: (clip: TimelineVideoClip) => TimelineVideoClip) => {
    if (!inspectorClip || !inspectorClipAsset) return;
    const nextClip = clampVideoClipToAsset(updater(inspectorClip), inspectorClipAsset.durationSeconds);
    const needsReversePreviewRefresh =
      inspectorClip.trimStartSeconds !== nextClip.trimStartSeconds ||
      inspectorClip.trimEndSeconds !== nextClip.trimEndSeconds ||
      inspectorClip.actions.reverse !== nextClip.actions.reverse;
    if (needsReversePreviewRefresh) {
      invalidateReversePreviewCache(inspectorClip.id);
    }
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        videoClips: replaceTimelineClip(current.timeline.videoClips, nextClip),
      },
    }));
  };

  const updateSelectedAudioItem = (updater: (item: TimelineAudioItem) => TimelineAudioItem) => {
    if (!selectedAudioItem || !selectedAudioAsset) return;
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        audioItems: replaceTimelineAudioItem(
          current.timeline.audioItems,
          clampAudioItemToAsset(updater(selectedAudioItem), selectedAudioAsset.durationSeconds)
        ),
      },
    }));
  };

  const updateSelectedImageItem = (updater: (item: TimelineImageItem) => TimelineImageItem) => {
    if (!selectedImageItem) return;
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        imageItems: replaceTimelineImageItem(current.timeline.imageItems, updater(selectedImageItem)),
      },
    }));
  };

  const updateSelectedOverlayItem = (updater: (item: TimelineOverlayItem) => TimelineOverlayItem) => {
    if (!selectedOverlayItem) return;
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        overlayItems: replaceTimelineOverlayItem(current.timeline.overlayItems, updater(selectedOverlayItem)),
      },
    }));
  };

  const updateSubtitleTrack = (updater: (subtitles: EditorProjectRecord["subtitles"]) => EditorProjectRecord["subtitles"]) => {
    updateProject((current) => ({
      ...current,
      subtitles: updater(current.subtitles),
    }));
  };

  const resetInspectorClipTrim = () => {
    if (!inspectorClipAsset) return;
    updateInspectorClip((clip) => resetTimelineVideoClipTrim(clip, inspectorClipAsset.durationSeconds));
  };

  const resetInspectorClipFrame = () => {
    updateInspectorClip(resetTimelineVideoClipFrame);
  };

  const resetInspectorClipAudio = () => {
    updateInspectorClip(resetTimelineVideoClipAudio);
  };

  const resetInspectorClipTransform = () => {
    updateInspectorClip((clip) => ({
      ...clip,
      actions: {
        ...clip.actions,
        reverse: false,
      },
    }));
  };

  const resetSubtitleTrackTiming = () => {
    updateSubtitleTrack((subtitles) => ({
      ...subtitles,
      offsetSeconds: 0,
      trimStartSeconds: 0,
      trimEndSeconds: subtitles.chunks.reduce((max, chunk) => {
        const start = chunk.timestamp?.[0];
        const end = chunk.timestamp?.[1];
        const safeStart = typeof start === "number" && Number.isFinite(start) ? start : 0;
        const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : safeStart;
        return Math.max(max, safeEnd);
      }, 0),
    }));
  };

  const resetSubtitleTrackStyle = () => {
    updateSubtitleTrack((subtitles) => ({
      ...subtitles,
      preset: "clean_caption",
      positionXPercent: 50,
      positionYPercent: 78,
      scale: 1,
      style: getDefaultEditorSubtitleStyle("clean_caption"),
    }));
  };

  const resetSelectedAudioTrim = () => {
    if (!selectedAudioAsset) return;
    updateSelectedAudioItem((item) => resetTimelineAudioItemTrim(item, selectedAudioAsset.durationSeconds));
  };

  const resetSelectedAudioTrack = () => {
    if (!selectedAudioItem) return;
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        audioItems: resetTimelineAudioItemTrack(current.timeline.audioItems, selectedAudioItem.id),
      },
    }));
  };

  const resetSelectedImageFrame = () => {
    updateSelectedImageItem((item) => ({
      ...item,
      canvas: {
        zoom: 1,
        panX: 0,
        panY: 0,
      },
    }));
  };

  const resetSelectedOverlayItem = () => {
    if (!selectedOverlayItem) return;
    updateSelectedOverlayItem((item) => ({
      ...createDefaultTimelineOverlayItem({
        presetId: item.presetId,
        startOffsetSeconds: item.startOffsetSeconds,
        durationSeconds: item.durationSeconds,
      }),
      id: item.id,
    }));
  };

  const fitSelectedImageToFrame = () => {
    if (!project || !selectedImageAsset?.width || !selectedImageAsset?.height) return;
    const { width, height } = getEditorOutputDimensions(project.aspectRatio, "1080p");
    const nextZoom = clampNumber(
      getEditorCanvasCoverZoom({
        sourceWidth: selectedImageAsset.width,
        sourceHeight: selectedImageAsset.height,
        outputWidth: width,
        outputHeight: height,
      }),
      IMAGE_TRACK_MIN_ZOOM,
      IMAGE_TRACK_MAX_ZOOM
    );

    updateSelectedImageItem((item) => ({
      ...item,
      canvas: {
        ...item.canvas,
        zoom: nextZoom,
        panX: 0,
        panY: 0,
      },
    }));
  };

  const focusTimelineSelection = (
    selection: TimelineSelection,
    nextPlayheadSeconds?: number,
    options?: { extendVideoSelection?: boolean }
  ) => {
    setPreviewMode({ kind: "timeline" });
    if (selection.kind === "video") {
      setSelectedVideoClipIds((current) => {
        if (!options?.extendVideoSelection) return [selection.id];
        if (current.includes(selection.id)) {
          const next = current.filter((clipId) => clipId !== selection.id);
          return next.length === 0 ? [selection.id] : next.slice(-2);
        }
        const next = [...current, selection.id];
        return next.slice(-2);
      });
    } else {
      setSelectedVideoClipIds([]);
    }
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        selectedItem: selection,
      },
    }));
    if (nextPlayheadSeconds != null) {
      setTimelinePlayhead(nextPlayheadSeconds);
    }
  };

  const insertVideoAssetAtTimelineIndex = (asset: EditorAssetRecord, index: number) => {
    if (!project) return;
    const clip = createDefaultVideoClip({
      assetId: asset.id,
      label: getTimelineAssetLabel(asset.filename),
      durationSeconds: asset.durationSeconds,
    });
    const nextClips = [...project.timeline.videoClips];
    const safeIndex = clampNumber(index, 0, nextClips.length);
    nextClips.splice(safeIndex, 0, clip);
    const insertedPlacement = getTimelineClipPlacements(nextClips).find(
      (placement) => placement.clip.id === clip.id
    );
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        selectedItem: { kind: "video", id: clip.id },
        videoClips: nextClips,
      },
    }));
    setTimelinePlayhead(insertedPlacement?.startSeconds ?? playheadRef.current);
    setPreviewMode({ kind: "timeline" });
  };

  const setImageAssetOnTimeline = (asset: EditorAssetRecord) => {
    if (!project) return;
    const existingItem = project.timeline.imageItems[0];
    const imageItem = createDefaultImageTrackItem({
      assetId: asset.id,
      label: getTimelineAssetLabel(asset.filename),
    });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        imageItems: [imageItem],
        selectedItem: { kind: "image", id: imageItem.id },
      },
    }));
    setPreviewMode({ kind: "timeline" });
    if (existingItem) {
      toast.success(`Replaced the image track with ${asset.filename}`);
    } else {
      toast.success(`Added ${asset.filename} across the full image track`);
    }
  };

  const addReactiveOverlayToTimeline = (presetId: TimelineOverlayItem["presetId"]) => {
    if (!project) return;
    if (
      (presetId === "waveform_line" || presetId === "equalizer_bars" || presetId === "pulse_ring") &&
      !hasAudioCapableTimelineAsset
    ) {
      toast.error("Audio-reactive motion overlays need at least one audio-capable asset in the timeline.");
      return;
    }
    const overlayItem = createDefaultTimelineOverlayItem({
      presetId,
      startOffsetSeconds: playheadRef.current,
      durationSeconds: Math.min(4, Math.max(1.5, projectDuration || 3)),
    });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        overlayItems: [...current.timeline.overlayItems, overlayItem],
        selectedItem: { kind: "overlay", id: overlayItem.id },
      },
    }));
    setPreviewMode({ kind: "timeline" });
    toast.success(`${getMotionOverlayPresetLabel(presetId)} added`);
  };

  const joinSelectedTimelineClips = () => {
    if (!project || !canJoinSelectedVideoClips) return;

    const joinedGroup = createJoinedTimelineClipGroup({
      clips: project.timeline.videoClips,
      groups: project.timeline.videoClipGroups,
      clipIds: selectedVideoPlacements.map((placement) => placement.clip.id),
    });
    if (!joinedGroup) return;

    const firstPlacement = selectedVideoPlacements[0];
    setPreviewMode({ kind: "timeline" });
    setFocusedJoinedClipId(joinedGroup.clipIds[0] ?? null);
    setSelectedVideoClipIds([]);
    setInspectorVideoTab("join");
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        videoClipGroups: [...current.timeline.videoClipGroups, joinedGroup],
        selectedItem: { kind: "video-group", id: joinedGroup.id },
      },
    }));
    if (firstPlacement) {
      setTimelinePlayhead(firstPlacement.startSeconds);
    }
    toast.success(`Joined ${selectedVideoPlacements.length} clips into one timeline block`);
  };

  const unjoinSelectedTimelineGroup = () => {
    if (!project || !selectedVideoGroup) return;
    const firstClipId = selectedVideoGroup.clipIds[0];
    const firstPlacement = selectedGroupClipPlacements[0];
    setPreviewMode({ kind: "timeline" });
    setFocusedJoinedClipId(null);
    setSelectedVideoClipIds(selectedVideoGroup.clipIds.slice(0, 2));
    setInspectorVideoTab("join");
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        videoClipGroups: unjoinTimelineClipGroup(current.timeline.videoClipGroups, selectedVideoGroup.id),
        selectedItem: firstClipId ? { kind: "video", id: firstClipId } : current.timeline.selectedItem,
      },
    }));
    if (firstPlacement) {
      setTimelinePlayhead(firstPlacement.startSeconds);
    }
    toast.success("Clips unjoined");
  };

  const handleCancelBake = useCallback(() => {
    if (!activeBakeTask) return;
    cancelTask(activeBakeTask.id);
  }, [activeBakeTask, cancelTask]);

  const handleCancelExport = useCallback(() => {
    if (!activeExportTask) return;
    cancelTask(activeExportTask.id);
  }, [activeExportTask, cancelTask]);

  const bakeSelectedTimelineGroup = async () => {
    if (!project || !selectedVideoGroup || selectedGroupClipPlacements.length !== selectedVideoGroup.clipIds.length) {
      return;
    }

    const missingAsset = selectedGroupClipPlacements.find(
      (placement) => resolvedAssetsMap.get(placement.clip.assetId)?.missing
    );
    if (missingAsset) {
      toast.error(`Missing source media for "${missingAsset.clip.label}". Replace it before baking.`);
      return;
    }

    const { bakeProject, bakedClipIds, bakedLabel, requiredAssetIds } = prepareTimelineClipBake({
      project,
      clipPlacements: selectedGroupClipPlacements,
    });
    const requiredAssetIdSet = new Set(requiredAssetIds);
    const bakeResolvedAssets = resolvedAssets.filter((resolved) => requiredAssetIdSet.has(resolved.asset.id));
    startTimelineBake({
      projectId,
      title: `Baking ${selectedVideoGroup.label}`,
      message: `Rendering a reusable baked clip from ${selectedVideoGroup.label}`,
      run: async (task) => {
        const taskLog = createTaskLogSync(task);
        const session = beginRenderSession();
        bakeSessionRef.current = session;
        setIsPlaying(false);
        taskLog.begin(
          `Bake started for ${selectedVideoGroup.label}: resolution=${exportResolution}, assets=${bakeResolvedAssets.length}.`
        );
        task.update({
          status: "preparing",
          progress: 1,
          message: getBakeTaskMessage(session.stage),
        });
        task.setCancel(() => {
          if (!isBrowserRenderCancelableStage(session.stage)) return;
          taskLog.append("Cancel requested by user.");
          session.controller.abort();
          bakeSessionRef.current = null;
          toast("Bake canceled");
        });

        try {
          session.stage = "rendering";
          taskLog.append("Stage -> rendering.");
          task.update({
            status: "running",
            progress: 18,
            message: "Baking joined clip",
          });
          const systemResult = await requestSystemEditorExport({
            project: bakeProject,
            resolvedAssets: bakeResolvedAssets,
            resolution: exportResolution,
            signal: session.controller.signal,
            onDebugLog: taskLog.append,
            onServerProgress: (progressPct) => {
              task.update({
                status: "running",
                progress: 18 + progressPct * 0.74,
                message: "Baking joined clip",
              });
            },
          });
          session.stage = "handoff";
          taskLog.append("Stage -> handoff.");
          const result = {
            file: systemResult.file,
            width: systemResult.width,
            height: systemResult.height,
          };
          if (bakeSessionRef.current?.id !== session.id || task.isCanceled()) return;

          task.update({
            status: "finalizing",
            progress: 96,
            message: "Applying baked clip to the timeline",
          });
          taskLog.append("Applying baked clip to the timeline.");

          const metadata = await readMediaMetadata(result.file);
          if (bakeSessionRef.current?.id !== session.id || task.isCanceled()) return;

          const bakedAsset = createEditorAssetRecord({
            projectId: project.id,
            role: "derived",
            origin: "timeline-export",
            kind: "video",
            filename: result.file.name,
            mimeType: result.file.type || "video/mp4",
            sizeBytes: result.file.size,
            durationSeconds: metadata.durationSeconds || getProjectDuration(bakeProject),
            width: metadata.width ?? result.width,
            height: metadata.height ?? result.height,
            hasAudio: metadata.hasAudio,
            sourceType: "upload",
            captionSource: { kind: "none" },
            fileBlob: result.file,
          });
          const bakedClip = createDefaultVideoClip({
            assetId: bakedAsset.id,
            label: bakedLabel,
            durationSeconds: bakedAsset.durationSeconds,
          });

          const latestProject = projectStateRef.current ?? project;
          if (!latestProject) return;

          const nextTimeline = replaceTimelineClipGroupWithClip(
            latestProject.timeline.videoClips,
            latestProject.timeline.videoClipGroups,
            selectedVideoGroup.id,
            bakedClip
          );
          const bakedPlacement = getTimelineClipPlacements(nextTimeline.videoClips).find(
            (placement) => placement.clip.id === bakedClip.id
          );
          const nextProject = markEditorProjectSaved(
            serializeEditorProjectForPersistence(
              {
                ...latestProject,
                assetIds: latestProject.assetIds.includes(bakedAsset.id)
                  ? latestProject.assetIds
                  : [...latestProject.assetIds, bakedAsset.id],
                timeline: {
                  ...latestProject.timeline,
                  videoClips: nextTimeline.videoClips,
                  videoClipGroups: nextTimeline.videoClipGroups,
                  selectedItem: { kind: "video", id: bakedClip.id },
                },
              },
              latestProject.timeline.playheadSeconds
            ),
            Date.now()
          );

          await editorRepositoryRef.current.bulkPutAssets([bakedAsset]);
          await editorRepositoryRef.current.putProject(nextProject);
          if (task.isCanceled()) return;

          bakedClipIds.forEach((clipId) => invalidateReversePreviewCache(clipId));

          if (mountedRef.current) {
            setAssets((current) => [...current, bakedAsset]);
            setProject(nextProject);
            setPreviewMode({ kind: "timeline" });
            if (bakedPlacement) {
              setTimelinePlayhead(bakedPlacement.startSeconds);
            }
            setFocusedJoinedClipId(null);
            setSelectedVideoClipIds([bakedClip.id]);
            setInspectorVideoTab("edit");
          }

          taskLog.append(`Bake complete: ${bakedAsset.filename}.`);
          toast.success(`Baked ${selectedVideoGroup.label} into one rendered clip`);
        } catch (error) {
          if (
            isBrowserRenderCanceledError(error) ||
            isAbortLikeError(error) ||
            session.controller.signal.aborted ||
            task.isCanceled()
          ) {
            return;
          }
          const message = error instanceof Error ? error.message : "Failed to bake the joined clip.";
          taskLog.append(`Bake failed: ${message.split("\n")[0] || "Failed to bake the joined clip."}.`);
          console.error("Failed to bake joined clip", error);
          toast.error(message.split("\n")[0] || "Failed to bake the joined clip.");
          throw error;
        } finally {
          if (bakeSessionRef.current?.id === session.id) {
            bakeSessionRef.current = null;
          }
        }
      },
    });
  };

  const appendAudioAssetToTimeline = (asset: EditorAssetRecord) => {
    if (!project) return;
    const audioItem = clampAudioItemToAsset(
      createDefaultAudioTrack({
        assetId: asset.id,
        durationSeconds: asset.durationSeconds,
      }),
      asset.durationSeconds
    );
    const nextAudioItems = appendTimelineAudioItem(project.timeline.audioItems, audioItem);
    const insertedItem = nextAudioItems.find((item) => item.id === audioItem.id);
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        audioItems: nextAudioItems,
        selectedItem: { kind: "audio", id: audioItem.id },
      },
    }));
    if (insertedItem) {
      setTimelinePlayhead(insertedItem.startOffsetSeconds);
    }
    setPreviewMode({ kind: "timeline" });
  };

  const copySelectedTimelineItem = () => {
    if (selectedOverlayItem) {
      clipboardRef.current = {
        kind: "overlay",
        item: { ...selectedOverlayItem },
      };
      return true;
    }
    if (selectedImageItem) {
      clipboardRef.current = {
        kind: "image",
        item: {
          ...selectedImageItem,
          canvas: { ...selectedImageItem.canvas },
        },
      };
      return true;
    }
    if (selectedClip) {
      clipboardRef.current = {
        kind: "video",
        item: {
          ...selectedClip,
          canvas: { ...selectedClip.canvas },
        },
      };
      return true;
    }
    if (selectedVideoGroup && project) {
      const clipsById = new Map(project.timeline.videoClips.map((clip) => [clip.id, clip]));
      const clips = selectedVideoGroup.clipIds.flatMap((clipId) => {
        const clip = clipsById.get(clipId);
        return clip
          ? [
              {
                ...clip,
                canvas: { ...clip.canvas },
                actions: { ...clip.actions },
              },
            ]
          : [];
      });
      if (clips.length !== selectedVideoGroup.clipIds.length) {
        return false;
      }
      clipboardRef.current = {
        kind: "video-group",
        item: {
          ...selectedVideoGroup,
          clipIds: [...selectedVideoGroup.clipIds],
        },
        clips,
      };
      return true;
    }
    if (selectedAudioItem) {
      clipboardRef.current = {
        kind: "audio",
        item: { ...selectedAudioItem },
      };
      return true;
    }
    return false;
  };

  const pasteTimelineClipboardItem = () => {
    const clipboardItem = clipboardRef.current;
    if (!clipboardItem || !project) return false;

    setPreviewMode({ kind: "timeline" });
    if (clipboardItem.kind === "video") {
      const nextClip = createClonedTimelineClip(clipboardItem.item);
      const afterClipId =
        project.timeline.selectedItem?.kind === "video"
          ? project.timeline.selectedItem.id
          : project.timeline.selectedItem?.kind === "video-group"
            ? findTimelineClipGroup(project.timeline.videoClipGroups, project.timeline.selectedItem.id)?.clipIds.at(-1)
            : undefined;
      const nextClips = insertTimelineClipAfter(project.timeline.videoClips, nextClip, afterClipId);
      const placement = getTimelineClipPlacements(nextClips).find((item) => item.clip.id === nextClip.id);
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          videoClips: nextClips,
          selectedItem: { kind: "video", id: nextClip.id },
        },
      }));
      if (placement) {
        setTimelinePlayhead(placement.startSeconds);
      }
      return true;
    }

    if (clipboardItem.kind === "video-group") {
      const clonedClips = clipboardItem.clips.map((clip) => createClonedTimelineClip(clip));
      const firstInsertedClipId = clonedClips[0]?.id;
      const afterClipId =
        project.timeline.selectedItem?.kind === "video"
          ? project.timeline.selectedItem.id
          : project.timeline.selectedItem?.kind === "video-group"
            ? findTimelineClipGroup(project.timeline.videoClipGroups, project.timeline.selectedItem.id)?.clipIds.at(-1)
            : undefined;
      let nextClips = project.timeline.videoClips;
      clonedClips.forEach((clip, index) => {
        nextClips = insertTimelineClipAfter(nextClips, clip, index === 0 ? afterClipId : clonedClips[index - 1]?.id);
      });
      const insertedGroup = createJoinedTimelineClipGroup({
        clips: nextClips,
        groups: project.timeline.videoClipGroups,
        clipIds: clonedClips.map((clip) => clip.id),
      });
      const placement = firstInsertedClipId
        ? getTimelineClipPlacements(nextClips).find((item) => item.clip.id === firstInsertedClipId)
        : undefined;
      updateProject((current) => {
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: nextClips,
            videoClipGroups: insertedGroup
              ? [...current.timeline.videoClipGroups, insertedGroup]
              : current.timeline.videoClipGroups,
            selectedItem: insertedGroup
              ? { kind: "video-group", id: insertedGroup.id }
              : firstInsertedClipId
                ? { kind: "video", id: firstInsertedClipId }
                : current.timeline.selectedItem,
          },
        };
      });
      if (placement) {
        setTimelinePlayhead(placement.startSeconds);
      }
      setFocusedJoinedClipId(insertedGroup?.clipIds[0] ?? null);
      return true;
    }

    if (clipboardItem.kind === "image") {
      const nextItem = createClonedTimelineImageItem(clipboardItem.item);
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          imageItems: [nextItem],
          selectedItem: { kind: "image", id: nextItem.id },
        },
      }));
      return true;
    }

    if (clipboardItem.kind === "overlay") {
      const nextItem = createClonedTimelineOverlayItem(clipboardItem.item);
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          overlayItems: [...current.timeline.overlayItems, nextItem],
          selectedItem: { kind: "overlay", id: nextItem.id },
        },
      }));
      setTimelinePlayhead(nextItem.startOffsetSeconds);
      return true;
    }

    const nextItem = createClonedTimelineAudioItem(clipboardItem.item);
    const afterItemId = project.timeline.selectedItem?.kind === "audio" ? project.timeline.selectedItem.id : undefined;
    const nextAudioItems = insertTimelineAudioItemAfter(project.timeline.audioItems, nextItem, afterItemId);
    const insertedItem = nextAudioItems.find((item) => item.id === nextItem.id);
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        audioItems: nextAudioItems,
        selectedItem: { kind: "audio", id: nextItem.id },
      },
    }));
    if (insertedItem) {
      setTimelinePlayhead(insertedItem.startOffsetSeconds);
    }
    return true;
  };

  const duplicateSelectedTimelineItem = () => {
    if (!project) return false;

    if (selectedOverlayItem) {
      const nextItem = createClonedTimelineOverlayItem(selectedOverlayItem);
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          overlayItems: [...current.timeline.overlayItems, nextItem],
          selectedItem: { kind: "overlay", id: nextItem.id },
        },
      }));
      setTimelinePlayhead(nextItem.startOffsetSeconds);
      return true;
    }

    if (selectedImageItem) {
      const nextItem = createClonedTimelineImageItem(selectedImageItem);
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          imageItems: [nextItem],
          selectedItem: { kind: "image", id: nextItem.id },
        },
      }));
      return true;
    }

    if (selectedVideoGroup) {
      const result = duplicateTimelineClipGroup(
        project.timeline.videoClips,
        project.timeline.videoClipGroups,
        selectedVideoGroup.id
      );
      if (!result) return false;
      const duplicatedStartSeconds = getTimelineClipPlacements(result.videoClips).find(
        (placement) => placement.clip.id === result.duplicatedGroup.clipIds[0]
      )?.startSeconds;
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: result.videoClips,
            videoClipGroups: result.videoClipGroups,
            selectedItem: { kind: "video-group", id: result.duplicatedGroup.id },
          },
        };
      });
      if (duplicatedStartSeconds != null) {
        setTimelinePlayhead(duplicatedStartSeconds);
      }
      setFocusedJoinedClipId(result.duplicatedGroup.clipIds[0] ?? null);
      return true;
    }

    if (selectedClip) {
      const nextClip = createClonedTimelineClip(selectedClip);
      setPreviewMode({ kind: "timeline" });
      const nextClips = insertTimelineClipAfter(project.timeline.videoClips, nextClip, selectedClip.id);
      const placement = getTimelineClipPlacements(nextClips).find((item) => item.clip.id === nextClip.id);
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          videoClips: nextClips,
          selectedItem: { kind: "video", id: nextClip.id },
        },
      }));
      if (placement) {
        setTimelinePlayhead(placement.startSeconds);
      }
      return true;
    }

    if (selectedAudioItem) {
      const nextItem = createClonedTimelineAudioItem(selectedAudioItem);
      setPreviewMode({ kind: "timeline" });
      const nextAudioItems = insertTimelineAudioItemAfter(project.timeline.audioItems, nextItem, selectedAudioItem.id);
      const insertedItem = nextAudioItems.find((item) => item.id === nextItem.id);
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          audioItems: nextAudioItems,
          selectedItem: { kind: "audio", id: nextItem.id },
        },
      }));
      if (insertedItem) {
        setTimelinePlayhead(insertedItem.startOffsetSeconds);
      }
      return true;
    }

    return false;
  };

  const cloneTimelineSelectionToFill = (selection: TimelineSelection | undefined) => {
    if (!project || !selection || !getTimelineTrackActionState(selection).canCloneToFill) return false;

    if (selection.kind === "video-group") {
      const result = cloneTimelineClipGroupToFill(
        project.timeline.videoClips,
        project.timeline.videoClipGroups,
        selection.id,
        audioTrackEnd
      );
      if (result.cloneCount === 0 || !result.lastInsertedGroupId) return false;
      const insertedGroupId = result.lastInsertedGroupId;
      const insertedBlock = getTimelineVideoBlockPlacements(result.videoClips, result.videoClipGroups).find(
        (block) => block.kind === "group" && block.id === insertedGroupId
      );
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          videoClips: result.videoClips,
          videoClipGroups: result.videoClipGroups,
          selectedItem: { kind: "video-group", id: insertedGroupId },
        },
      }));
      setSelectedVideoClipIds([]);
      setFocusedJoinedClipId(insertedBlock?.clipIds[0] ?? null);
      if (insertedBlock) {
        setTimelinePlayhead(insertedBlock.startSeconds);
      }
      toast.success(`Filled the video track with ${result.cloneCount} block clone${result.cloneCount === 1 ? "" : "s"}`);
      return true;
    }

    if (selection.kind === "video") {
      const result = cloneTimelineClipToFill(project.timeline.videoClips, selection.id, audioTrackEnd);
      if (result.cloneCount === 0 || !result.lastInsertedClipId) return false;
      const insertedClipId = result.lastInsertedClipId;
      const placement = getTimelineClipPlacements(result.videoClips).find(
        (entry) => entry.clip.id === insertedClipId
      );
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          videoClips: result.videoClips,
          selectedItem: { kind: "video", id: insertedClipId },
        },
      }));
      setSelectedVideoClipIds([insertedClipId]);
      if (placement) {
        setTimelinePlayhead(placement.startSeconds);
      }
      toast.success(`Filled the video track with ${result.cloneCount} clone${result.cloneCount === 1 ? "" : "s"}`);
      return true;
    }

    const result = cloneTimelineAudioItemToFill(project.timeline.audioItems, selection.id, videoTrackEnd);
    if (result.cloneCount === 0 || !result.lastInsertedItemId) return false;
    const insertedItemId = result.lastInsertedItemId;
    const insertedItem = result.audioItems.find((item) => item.id === insertedItemId);
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        audioItems: result.audioItems,
        selectedItem: { kind: "audio", id: insertedItemId },
      },
    }));
    setSelectedVideoClipIds([]);
    if (insertedItem) {
      setTimelinePlayhead(insertedItem.startOffsetSeconds);
    }
    toast.success(`Filled the audio track with ${result.cloneCount} clone${result.cloneCount === 1 ? "" : "s"}`);
    return true;
  };

  const trimTimelineSelectionToMatchTrack = (selection: TimelineSelection | undefined) => {
    if (!project || !selection || !getTimelineTrackActionState(selection).canTrimToMatch) return false;

    if (selection.kind === "video-group") {
      const result = trimTimelineClipGroupToMatchTrackEnd(
        project.timeline.videoClips,
        project.timeline.videoClipGroups,
        selection.id,
        audioTrackEnd
      );
      if (!result.trimmed) return false;
      if (result.tailClipId) {
        invalidateReversePreviewCache(result.tailClipId);
      }
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          videoClips: result.videoClips,
          videoClipGroups: result.videoClipGroups,
          selectedItem: { kind: "video-group", id: selection.id },
        },
      }));
      setSelectedVideoClipIds([]);
      toast.success("Trimmed the video track to match the audio track");
      return true;
    }

    if (selection.kind === "video") {
      const result = trimTimelineClipToMatchTrackEnd(project.timeline.videoClips, selection.id, audioTrackEnd);
      if (!result.trimmed) return false;
      invalidateReversePreviewCache(selection.id);
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => ({
        ...current,
        timeline: {
          ...current.timeline,
          videoClips: result.videoClips,
          selectedItem: { kind: "video", id: selection.id },
        },
      }));
      setSelectedVideoClipIds([selection.id]);
      toast.success("Trimmed the video track to match the audio track");
      return true;
    }

    const result = trimTimelineAudioItemToMatchTrackEnd(project.timeline.audioItems, selection.id, videoTrackEnd);
    if (!result.trimmed) return false;
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        audioItems: result.audioItems,
        selectedItem: { kind: "audio", id: selection.id },
      },
    }));
    setSelectedVideoClipIds([]);
    toast.success("Trimmed the audio track to match the video track");
    return true;
  };

  const cloneSelectedTimelineItemToFill = () => cloneTimelineSelectionToFill(selectedItem);

  const trimSelectedTimelineItemToMatchTrack = () => trimTimelineSelectionToMatchTrack(selectedItem);

  const removeSelectedTimelineItem = () => {
    if (!project?.timeline.selectedItem) return false;

    if (project.timeline.selectedItem.kind === "video-group") {
      const removedBlockIndex = videoBlockPlacements.findIndex(
        (block) => block.kind === "group" && block.id === project.timeline.selectedItem?.id
      );
      if (removedBlockIndex < 0 || !selectedVideoGroup) return false;
      selectedVideoGroup.clipIds.forEach((clipId) => invalidateReversePreviewCache(clipId));
      setPreviewMode({ kind: "timeline" });
      setFocusedJoinedClipId(null);
      updateProject((current) => {
        const nextTimeline = removeTimelineClipGroup(
          current.timeline.videoClips,
          current.timeline.videoClipGroups,
          project.timeline.selectedItem?.id ?? ""
        );
        const nextBlocks = getTimelineVideoBlockPlacements(nextTimeline.videoClips, nextTimeline.videoClipGroups);
        const nextSelection =
          nextBlocks[removedBlockIndex] ??
          nextBlocks[Math.max(0, removedBlockIndex - 1)];
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: nextTimeline.videoClips,
            videoClipGroups: nextTimeline.videoClipGroups,
            selectedItem: nextSelection
              ? getTimelineSelectionForVideoBlock(nextSelection)
              : getSelectionForLaneIndex(
                  "audio",
                  0,
                  nextTimeline.videoClips,
                  current.timeline.audioItems,
                  nextTimeline.videoClipGroups,
                  current.timeline.imageItems,
                  current.timeline.overlayItems,
                  hasProjectSubtitleTrack(current)
                ),
          },
        };
      });
      return true;
    }

    if (project.timeline.selectedItem.kind === "video") {
      const removedIndex = project.timeline.videoClips.findIndex((clip) => clip.id === project.timeline.selectedItem?.id);
      if (removedIndex < 0) return false;
      invalidateReversePreviewCache(project.timeline.selectedItem.id);
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        const nextClips = removeTimelineClip(current.timeline.videoClips, current.timeline.selectedItem?.id ?? "");
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: nextClips,
            selectedItem: getSelectionForLaneIndex(
              "video",
              removedIndex,
              nextClips,
              current.timeline.audioItems,
              current.timeline.videoClipGroups,
              current.timeline.imageItems,
              current.timeline.overlayItems,
              hasProjectSubtitleTrack(current)
            ),
          },
        };
      });
      return true;
    }

    if (project.timeline.selectedItem.kind === "overlay") {
      const removedIndex = project.timeline.overlayItems.findIndex((item) => item.id === project.timeline.selectedItem?.id);
      if (removedIndex < 0) return false;
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        const nextOverlayItems = removeTimelineOverlayItem(current.timeline.overlayItems, current.timeline.selectedItem?.id ?? "");
        return {
          ...current,
          timeline: {
            ...current.timeline,
            overlayItems: nextOverlayItems,
            selectedItem: getSelectionForLaneIndex(
              "overlay",
              removedIndex,
              current.timeline.videoClips,
              current.timeline.audioItems,
              current.timeline.videoClipGroups,
              current.timeline.imageItems,
              nextOverlayItems,
              hasProjectSubtitleTrack(current)
            ),
          },
        };
      });
      return true;
    }

    if (project.timeline.selectedItem.kind === "image") {
      const removedIndex = project.timeline.imageItems.findIndex((item) => item.id === project.timeline.selectedItem?.id);
      if (removedIndex < 0) return false;
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        const nextImageItems = removeTimelineImageItem(current.timeline.imageItems, current.timeline.selectedItem?.id ?? "");
        return {
          ...current,
          timeline: {
            ...current.timeline,
            imageItems: nextImageItems,
            selectedItem: getSelectionForLaneIndex(
              "image",
              removedIndex,
              current.timeline.videoClips,
              current.timeline.audioItems,
              current.timeline.videoClipGroups,
              nextImageItems,
              current.timeline.overlayItems,
              hasProjectSubtitleTrack(current)
            ),
          },
        };
      });
      return true;
    }

    if (project.timeline.selectedItem.kind === "subtitle") {
      clearProjectSubtitleTrack();
      return true;
    }

    const removedIndex = project.timeline.audioItems.findIndex((item) => item.id === project.timeline.selectedItem?.id);
    if (removedIndex < 0) return false;
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => {
      const nextAudioItems = removeTimelineAudioItem(current.timeline.audioItems, current.timeline.selectedItem?.id ?? "");
      return {
        ...current,
        timeline: {
          ...current.timeline,
          audioItems: nextAudioItems,
          selectedItem: getSelectionForLaneIndex(
            "audio",
            removedIndex,
            current.timeline.videoClips,
            nextAudioItems,
            current.timeline.videoClipGroups,
            current.timeline.imageItems,
            current.timeline.overlayItems,
            hasProjectSubtitleTrack(current)
          ),
        },
      };
    });
    return true;
  };

  const splitSelectedTimelineClip = () => {
    if (!selectedClip) return false;
    invalidateReversePreviewCache(selectedClip.id);
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        videoClips: splitTimelineClip(
          current.timeline.videoClips,
          current.timeline.selectedItem?.kind === "video" ? current.timeline.selectedItem.id : "",
          playheadRef.current
        ),
      },
    }));
    return true;
  };

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || !project) return;
    const incoming = Array.from(files);
    const nextAssets: EditorAssetRecord[] = [];
    for (const file of incoming) {
      const metadata = await readMediaMetadata(file);
      const asset = createEditorAssetRecord({
        projectId: project.id,
        role: "support",
        origin: "upload",
        kind: metadata.kind,
        filename: file.name,
        mimeType:
          file.type ||
          (metadata.kind === "video"
            ? "video/mp4"
            : metadata.kind === "image"
              ? "image/png"
              : "audio/mpeg"),
        sizeBytes: file.size,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        hasAudio: metadata.hasAudio,
        sourceType: "upload",
        captionSource: { kind: "none" },
        fileBlob: file,
      });
      nextAssets.push(asset);
    }

    if (!nextAssets.length) return;
    setAssets((current) => [...current, ...nextAssets]);
    await saveAssets(nextAssets);
    toast.success(`${nextAssets.length} asset${nextAssets.length === 1 ? "" : "s"} added to the media bin`);
  };

  const handleAddHistoryItem = async (item: HistoryItem) => {
    if (!project) return;
    const mediaFile = await resolveAssetFile(item.id);
    if (!mediaFile?.file) {
      toast.error("The source file for this history item is not available.");
      return;
    }

    const metadata = await readMediaMetadata(mediaFile.file);
    const transcript = getLatestTranscript(item);
    const subtitle = transcript
      ? getLatestSubtitleForLanguage(
          transcript,
          transcript.detectedLanguage ?? transcript.requestedLanguage
        ) ?? transcript.subtitles[0]
      : undefined;

    const asset = createEditorAssetRecord({
      projectId: project.id,
      kind: metadata.kind,
      filename: item.filename,
      mimeType:
        mediaFile.file.type ||
        (metadata.kind === "video"
          ? "video/mp4"
          : metadata.kind === "image"
            ? "image/png"
            : "audio/mpeg"),
      sizeBytes: mediaFile.file.size,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      hasAudio: metadata.hasAudio,
      role: "support",
      origin: "manual",
      sourceType: "history",
      sourceAssetId: item.id,
      sourceMediaId: item.id,
      sourceProjectId: item.id,
      captionSource:
        metadata.kind === "video" && transcript && subtitle
          ? {
              kind: "asset-subtitle",
              sourceAssetId: item.id,
              transcriptId: transcript.id,
              subtitleId: subtitle.id,
              language: subtitle.language,
              label: subtitle.label,
            }
          : { kind: "none" },
    });

    setAssets((current) => [...current, asset]);
    await saveAssets([asset]);
    toast.success(`Added ${item.filename} to the media bin`);
  };

  const clearProjectSubtitleTrack = useCallback(() => {
    updateProject((current) => ({
      ...current,
      subtitles: {
        ...current.subtitles,
        source: { kind: "none" },
        label: undefined,
        language: undefined,
        chunks: [],
        offsetSeconds: 0,
        trimStartSeconds: 0,
        trimEndSeconds: 0,
      },
      timeline: {
        ...current.timeline,
        selectedItem:
          current.timeline.selectedItem?.kind === "subtitle"
            ? getSelectionForLaneIndex(
                "video",
                0,
                current.timeline.videoClips,
                current.timeline.audioItems,
                current.timeline.videoClipGroups,
                current.timeline.imageItems,
                current.timeline.overlayItems,
                false
              )
            : current.timeline.selectedItem,
      },
    }));
  }, [updateProject]);

  const handleSelectHistorySubtitle = useCallback(
    (item: HistoryItem, transcriptId: string, subtitleId: string) => {
      const transcript = item.transcripts.find((entry) => entry.id === transcriptId) ?? getLatestTranscript(item);
      const subtitle = transcript?.subtitles.find((entry) => entry.id === subtitleId);
      if (!transcript || !subtitle) {
        toast.error("That subtitle version is no longer available.");
        return;
      }

      const trimEndSeconds = subtitle.chunks.reduce((max, chunk) => {
        const start = chunk.timestamp?.[0];
        const end = chunk.timestamp?.[1];
        const safeStart = typeof start === "number" && Number.isFinite(start) ? start : 0;
        const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : safeStart;
        return Math.max(max, safeEnd);
      }, 0);

      updateProject((current) => ({
        ...current,
        subtitles: {
          ...current.subtitles,
          source: {
            kind: "history-subtitle",
            sourceProjectId: item.id,
            transcriptId: transcript.id,
            subtitleId: subtitle.id,
          },
          label: subtitle.label,
          language: subtitle.language,
          chunks: subtitle.chunks,
          offsetSeconds: 0,
          trimStartSeconds: 0,
          trimEndSeconds,
        },
        timeline: {
          ...current.timeline,
          selectedItem: {
            kind: "subtitle",
            id: EDITOR_SUBTITLE_TRACK_ID,
          },
        },
      }));
      setIsSubtitleHistoryDialogOpen(false);
      toast.success(`Loaded ${subtitle.label} into S1`);
    },
    [updateProject]
  );

  const handleAttachSubtitleSrt = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (srtInputRef.current) {
      srtInputRef.current.value = "";
    }
    if (!file) return;
    const text = await file.text();
    const chunks = parseSrt(text);
    if (!chunks.length) {
      toast.error("The SRT file did not contain any valid subtitle rows.");
      return;
    }
    const trimEndSeconds = chunks.reduce((max, chunk) => {
      const start = chunk.timestamp?.[0];
      const end = chunk.timestamp?.[1];
      const safeStart = typeof start === "number" && Number.isFinite(start) ? start : 0;
      const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : safeStart;
      return Math.max(max, safeEnd);
    }, 0);

    updateProject((current) => ({
      ...current,
      subtitles: {
        ...current.subtitles,
        source: { kind: "uploaded-srt" },
        label: file.name,
        language: current.subtitles.language,
        chunks,
        offsetSeconds: 0,
        trimStartSeconds: 0,
        trimEndSeconds,
      },
      timeline: {
        ...current.timeline,
        selectedItem: {
          kind: "subtitle",
          id: EDITOR_SUBTITLE_TRACK_ID,
        },
      },
    }));
    toast.success(`Loaded ${file.name} into S1`);
  };

  const handleDeleteAsset = async (asset: EditorAssetRecord) => {
    if (!project) return;
    const removedClipIds = project.timeline.videoClips
      .filter((clip) => clip.assetId === asset.id)
      .map((clip) => clip.id);
    removedClipIds.forEach((clipId) => invalidateReversePreviewCache(clipId));
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    await deleteAsset(asset.id);
    updateProject((current) => ({
      ...current,
      assetIds: current.assetIds.filter((id) => id !== asset.id),
      timeline: {
        ...current.timeline,
        imageItems: current.timeline.imageItems.filter((item) => item.assetId !== asset.id),
        videoClips: current.timeline.videoClips.filter((clip) => clip.assetId !== asset.id),
        audioItems: current.timeline.audioItems.filter((item) => item.assetId !== asset.id),
      },
    }));
  };

  const handleExport = useCallback(async () => {
    if (!project) return;
    if (exportBlockingReasons.length > 0) {
      toast.error(exportBlockingReasons[0] || "Export settings are incomplete.");
      return;
    }

    const selectedResolution = exportResolution;
    const destination = exportDestination;
    const usesSavePicker = Boolean(isSavePickerSupported && destination);
    setIsExportDialogOpen(false);
    const exportSnapshot = serializeEditorProjectForPersistence(project, persistedPlayheadSecondsRef.current);

    startTimelineExport({
      projectId,
      title: `Exporting ${project.name}`,
      message: `${selectedResolution} · ${EDITOR_EXPORT_ENGINE_LABEL}`,
      run: async (task) => {
        const taskLog = createTaskLogSync(task);
        const session = beginRenderSession();
        exportSessionRef.current = session;
        taskLog.begin(`Export started for ${project.name}: resolution=${selectedResolution}.`);
        task.update({
          status: "preparing",
          progress: 1,
          message: getExportTaskMessage(session.stage),
        });
        task.setCancel(() => {
          if (!isBrowserRenderCancelableStage(session.stage)) return;
          taskLog.append("Cancel requested by user.");
          session.controller.abort();
          exportSessionRef.current = null;
          toast("Export canceled");
        });

        try {
          session.stage = "rendering";
          taskLog.append("Stage -> rendering.");
          task.update({
            status: "running",
            progress: 18,
            message: "Rendering timeline export",
          });
          let exportReactiveOverlayAnalysis: EditorReactiveAudioAnalysisTrack | null = null;
          let analysisReuseWaitMs = 0;
          let cachedReactiveOverlaySequences: ReactiveOverlayFrameSequence[] | null = null;
          let reactiveOverlaySequenceCacheKey = "";

          if (exportSnapshot.timeline.overlayItems.length > 0 && reactiveOverlayAnalysisFingerprint) {
            if (reactiveOverlayAnalysisStateRef.current.fingerprint === reactiveOverlayAnalysisFingerprint) {
              exportReactiveOverlayAnalysis = reactiveOverlayAnalysisStateRef.current.analysis;
            } else if (reactiveOverlayAnalysisRequestRef.current?.fingerprint === reactiveOverlayAnalysisFingerprint) {
              const analysisWaitStartedAt = performance.now();
              exportReactiveOverlayAnalysis = await reactiveOverlayAnalysisRequestRef.current.promise;
              analysisReuseWaitMs = performance.now() - analysisWaitStartedAt;
              if (analysisReuseWaitMs >= 1) {
                taskLog.append(
                  `Waited ${Math.round(analysisReuseWaitMs)}ms for reactive overlay analysis already in progress.`
                );
              }
            }

            reactiveOverlaySequenceCacheKey = buildReactiveOverlaySequenceCacheKey(exportSnapshot, selectedResolution);
            const cachedSequences = reactiveOverlaySequenceCacheRef.current.get(reactiveOverlaySequenceCacheKey);
            if (cachedSequences) {
              cachedReactiveOverlaySequences = cachedSequences;
              taskLog.append(`Reusing ${cachedSequences.length} cached reactive overlay sequence input(s).`);
            }
          }

          const systemResult = await requestSystemEditorExport({
            project: exportSnapshot,
            resolvedAssets,
            resolution: selectedResolution,
            reactiveOverlayAnalysis: exportReactiveOverlayAnalysis,
            reactiveOverlaySequences: cachedReactiveOverlaySequences,
            analysisReuseWaitMs,
            onReactiveOverlaySequencesPrepared:
              reactiveOverlaySequenceCacheKey && !cachedReactiveOverlaySequences
                ? (sequences) => {
                    reactiveOverlaySequenceCacheRef.current.set(reactiveOverlaySequenceCacheKey, sequences);
                  }
                : undefined,
            signal: session.controller.signal,
            onDebugLog: taskLog.append,
            onServerProgress: (progressPct) => {
              task.update({
                status: "running",
                progress: 18 + progressPct * 0.74,
                message: "Rendering timeline export",
              });
            },
          });
          session.stage = "handoff";
          taskLog.append("Stage -> handoff.");
          const result = {
            file: systemResult.file,
            width: systemResult.width,
            height: systemResult.height,
            warnings: systemResult.warnings,
            ffmpegCommandPreview: systemResult.debugFfmpegCommand,
            notes: systemResult.debugNotes,
            encoderUsed: systemResult.encoderUsed,
            hardwareAccelerated: systemResult.hardwareAccelerated,
            timingsMs: systemResult.timingsMs,
            counts: systemResult.counts,
          };
          if (exportSessionRef.current?.id !== session.id || task.isCanceled()) return;

          task.update({
            status: "finalizing",
            progress: 96,
            message: "Saving export output",
          });
          taskLog.append("Saving export output.");

          if (usesSavePicker && destination) {
            await writeBlobToEditorSaveFileHandle(destination.handle, result.file);
          } else {
            downloadBlob(result.file);
          }
          if (exportSessionRef.current?.id !== session.id || task.isCanceled()) return;

          if (result.encoderUsed) {
            taskLog.append(
              `Export diagnostics: encoder=${result.encoderUsed}${result.hardwareAccelerated ? " (hardware)" : " (software)"}.`
            );
          }
          if (result.timingsMs) {
            const timingParts = [
              result.timingsMs.analysisReuseWait ? `analysisReuseWait=${Math.round(result.timingsMs.analysisReuseWait)}ms` : null,
              result.timingsMs.overlayPreparation ? `overlayPreparation=${Math.round(result.timingsMs.overlayPreparation)}ms` : null,
              result.timingsMs.upload ? `upload=${Math.round(result.timingsMs.upload)}ms` : null,
              result.timingsMs.serverFfmpeg ? `serverFfmpeg=${Math.round(result.timingsMs.serverFfmpeg)}ms` : null,
              result.timingsMs.total ? `total=${Math.round(result.timingsMs.total)}ms` : null,
            ].filter(Boolean);
            if (timingParts.length > 0) {
              taskLog.append(`Export timings: ${timingParts.join(", ")}.`);
            }
          }

          const recordedFilename = usesSavePicker && destination ? destination.name : result.file.name;
          const now = Date.now();
          const outputAsset = createEditorAssetRecord({
            projectId: exportSnapshot.id,
            role: "derived",
            origin: "timeline-export",
            kind: "video",
            filename: recordedFilename,
            mimeType: result.file.type || "video/mp4",
            sizeBytes: result.file.size,
            durationSeconds: projectDuration,
            width: result.width,
            height: result.height,
            hasAudio: true,
            sourceType: "upload",
            captionSource: { kind: "none" },
            fileBlob: result.file,
            now,
          });
          await editorRepositoryRef.current.bulkPutAssets([outputAsset]);
          if (task.isCanceled()) return;

          const exportRecord = buildEditorExportRecord({
            projectId: exportSnapshot.id,
            outputAssetId: outputAsset.id,
            filename: recordedFilename,
            mimeType: result.file.type,
            sizeBytes: result.file.size,
            durationSeconds: projectDuration,
            aspectRatio: exportSnapshot.aspectRatio,
            resolution: selectedResolution,
            width: result.width,
            height: result.height,
            warnings: result.warnings,
            debugFfmpegCommand: result.ffmpegCommandPreview,
            debugNotes: result.notes,
            encoderUsed: result.encoderUsed,
            hardwareAccelerated: result.hardwareAccelerated,
            timingsMs: result.timingsMs,
            counts: result.counts,
          });
          await editorRepositoryRef.current.putExport(exportRecord);
          if (task.isCanceled()) return;

          const latestProject = projectStateRef.current ?? exportSnapshot;
          const nextProject = markEditorProjectSaved(
            serializeEditorProjectForPersistence(
              {
                ...latestProject,
                assetIds: latestProject.assetIds.includes(outputAsset.id)
                  ? latestProject.assetIds
                  : [...latestProject.assetIds, outputAsset.id],
                latestExport: {
                  id: exportRecord.id,
                  createdAt: exportRecord.createdAt,
                  filename: exportRecord.filename,
                  aspectRatio: exportRecord.aspectRatio,
                  resolution: exportRecord.resolution,
                  engine: exportRecord.engine,
                  status: exportRecord.status,
                },
                lastError: undefined,
              },
              latestProject.timeline.playheadSeconds
            ),
            now
          );
          await editorRepositoryRef.current.putProject(nextProject);
          if (task.isCanceled()) return;

          if (mountedRef.current) {
            setAssets((current) => [...current, outputAsset]);
            setProject(nextProject);
            setExportDestination(null);
          }

          taskLog.append(`Export complete: ${recordedFilename}.`);
          toast.success(`Exported ${recordedFilename}`);
        } catch (err) {
          if (isBrowserRenderCanceledError(err) || session.controller.signal.aborted || task.isCanceled()) {
            return;
          }
          if (isAbortLikeError(err)) {
            return;
          }

          const message = err instanceof Error ? err.message : "Export failed";
          const toastMessage = message.split("\n")[0] || "Export failed";
          taskLog.append(`Export failed: ${toastMessage}.`);
          try {
            const failedRecord = buildEditorExportRecord({
              projectId: exportSnapshot.id,
              filename: usesSavePicker && destination
                ? destination.name
                : buildEditorExportFilename(exportSnapshot.name, exportSnapshot.aspectRatio, selectedResolution),
              mimeType: "video/mp4",
              sizeBytes: 0,
              durationSeconds: projectDuration,
              aspectRatio: exportSnapshot.aspectRatio,
              resolution: selectedResolution,
              width: 0,
              height: 0,
              error: message,
              status: "failed",
            });
            await editorRepositoryRef.current.putExport(failedRecord);
            const latestProject = projectStateRef.current ?? exportSnapshot;
            const nextProject = markEditorProjectFailed(latestProject, message, Date.now());
            await editorRepositoryRef.current.putProject(nextProject);
            if (mountedRef.current) {
              setProject(nextProject);
            }
          } catch (persistError) {
            console.error("Failed to persist export failure state", persistError);
            if (mountedRef.current) {
              setProject(markEditorProjectFailed(projectStateRef.current ?? exportSnapshot, message, Date.now()));
            }
          }
          toast.error(toastMessage);
          throw err;
        } finally {
          if (exportSessionRef.current?.id === session.id) {
            exportSessionRef.current = null;
          }
          if (mountedRef.current) {
            setExportDestination(null);
          }
        }
      },
    });
  }, [
    beginRenderSession,
    buildReactiveOverlaySequenceCacheKey,
    createTaskLogSync,
    exportBlockingReasons,
    exportDestination,
    exportResolution,
    isSavePickerSupported,
    project,
    projectDuration,
    reactiveOverlayAnalysisFingerprint,
    resolvedAssets,
    projectId,
    startTimelineExport,
  ]);

  const handleCopyLastError = useCallback(async () => {
    const lastError = project?.lastError;
    if (!lastError) return;

    try {
      await copyTextToClipboard(lastError);
      toast.success("Copied the export error details.");
    } catch (error) {
      console.error("Failed to copy the export error details", error);
      toast.error("Could not copy the export error details.");
    }
  }, [project?.lastError]);

  const handleDeleteLastError = useCallback(async () => {
    if (!project?.lastError) return;

    const previousProject = project;
    const previousSaveState = saveState;
    const previousAutosaveHash = autosaveHashRef.current;
    const previousPersistedPlayheadSeconds = persistedPlayheadSecondsRef.current;
    const nextProject = markEditorProjectSaved(
      serializeEditorProjectForPersistence(
        {
          ...project,
          lastError: undefined,
        },
        persistedPlayheadSecondsRef.current
      ),
      Date.now()
    );
    const nextAutosaveHash = getEditorProjectPersistenceFingerprint(
      nextProject,
      assets.map((asset) => asset.id),
      nextProject.timeline.playheadSeconds
    );

    persistedPlayheadSecondsRef.current = nextProject.timeline.playheadSeconds;
    autosaveHashRef.current = nextAutosaveHash;
    setProject(nextProject);
    setSaveState("saved");

    try {
      await saveProject(nextProject);
      toast.success("Removed the last export error.");
    } catch (error) {
      console.error("Failed to clear the last export error", error);
      persistedPlayheadSecondsRef.current = previousPersistedPlayheadSeconds;
      autosaveHashRef.current = previousAutosaveHash;
      setProject(previousProject);
      setSaveState(previousSaveState);
      toast.error("Could not remove the last export error.");
    }
  }, [assets, project, saveProject, saveState]);

  const handleShortcutKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isInteractionLocked) return;
    if (isShortcutTargetEditable(event.target)) return;

    const usesCommand = event.metaKey || event.ctrlKey;
    const lowerKey = event.key.toLowerCase();
    const selection = window.getSelection();
    const isTextSelected = Boolean(selection && selection.type === "Range" && selection.toString().length > 0);

    if (!usesCommand && !event.altKey && event.code === "Space" && previewMode.kind === "timeline") {
      event.preventDefault();
      setIsPlaying((current) => !current);
      return;
    }

    if (usesCommand && !event.altKey && !event.shiftKey && lowerKey === "c") {
      if (isTextSelected) return;
      if (copySelectedTimelineItem()) {
        event.preventDefault();
      }
      return;
    }

    if (usesCommand && !event.altKey && !event.shiftKey && lowerKey === "v") {
      if (pasteTimelineClipboardItem()) {
        event.preventDefault();
      }
      return;
    }

    if (usesCommand && !event.altKey && !event.shiftKey && lowerKey === "d") {
      if (duplicateSelectedTimelineItem()) {
        event.preventDefault();
      }
      return;
    }

    if (!usesCommand && !event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
      if (removeSelectedTimelineItem()) {
        event.preventDefault();
      }
    }
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleShortcutKeyDown(event);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleProjectNameChange = useCallback((nextName: string) => {
    updateProject((current) => ({
      ...current,
      name: nextName,
    }));
  }, [updateProject]);

  const handleAspectRatioChange = useCallback((nextAspectRatio: EditorAspectRatio) => {
    updateProject((current) => ({
      ...current,
      aspectRatio: nextAspectRatio,
    }));
  }, [updateProject]);

  if (isLoading || !project) {
    return (
      <main className="min-h-screen px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/10 bg-black/30 p-10 text-center text-white/60">
          Loading timeline project…
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-red-400/20 bg-red-500/10 p-10 text-red-100">
          {error}
        </div>
      </main>
    );
  }

  const aspectRatioValue = getAspectRatioNumber(project.aspectRatio);
  const showLeftResizeHandle =
    panelVisibility.left && (panelVisibility.center || (!panelVisibility.center && panelVisibility.right));
  const showRightResizeHandle = panelVisibility.center && panelVisibility.right;
  const playheadPct = clampNumber(
    ((playheadSeconds - visibleStart) / Math.max(visibleDuration, 0.001)) * 100,
    0,
    100
  );
  const previewTitle =
    previewMode.kind === "asset"
      ? previewedAsset?.filename ?? "Asset Preview"
      : activePlacement?.clip.label ?? activeImagePlacement?.item.label ?? "Timeline Preview";
  const previewMeta =
    previewMode.kind === "asset"
      ? previewedAsset
        ? `${previewedAsset.kind} · ${previewedAsset.kind === "image" ? "Still" : secondsToClock(previewedAsset.durationSeconds)} · ${previewedAsset.sourceType}`
        : "This asset is no longer available."
      : `${secondsToClock(playheadSeconds)} / ${secondsToClock(projectDuration)}`;
  const previewBadge =
    previewMode.kind === "asset"
      ? previewedAsset?.kind === "audio"
        ? "Asset audio"
        : previewedAsset?.kind === "image"
          ? "Asset image"
          : "Asset clip"
      : activeImagePlacement
        ? `${project.aspectRatio} timeline + image`
        : `${project.aspectRatio} timeline`;
  const selectedTimelineLabel =
    selectedItem?.kind === "video-group"
      ? selectedVideoGroup?.label
      : selectedItem?.kind === "video"
        ? selectedClip?.label
      : selectedItem?.kind === "overlay"
        ? selectedOverlayItem
          ? `${getMotionOverlayPresetLabel(selectedOverlayItem.presetId)}`
          : "Reactive overlay"
      : selectedItem?.kind === "image"
        ? selectedImageItem?.label ?? selectedImageAsset?.filename
      : selectedItem?.kind === "subtitle"
        ? project.subtitles.label ?? "Subtitle track"
      : selectedAudioAsset?.filename ?? (selectedAudioItem ? "Audio item" : undefined);
  const visibleWindowLabel = `${secondsToClock(visibleStart)} - ${secondsToClock(
    Math.min(projectDuration, visibleEnd)
  )}`;
  const activeRenderTask = activeBakeTask ?? activeExportTask;
  const dropIndicatorPct = (() => {
    if (!draggingVideoBlockId && draggingAssetKind !== "video") return null;
    if (dropTargetIndex != null && visibleVideoBlocks[dropTargetIndex]) {
      return visibleVideoBlocks[dropTargetIndex].leftPct;
    }
    const lastVisiblePlacement = visibleVideoBlocks[visibleVideoBlocks.length - 1];
    if (lastVisiblePlacement) {
      return Math.min(100, lastVisiblePlacement.leftPct + lastVisiblePlacement.widthPct);
    }
    return 4;
  })();

  return (
    <main className="h-[100dvh] overflow-hidden px-2 sm:px-3 lg:px-4" aria-busy={isRenderBusy}>
      <input
        ref={mediaInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        className="hidden"
        multiple
        onChange={(event) => void handleImportFiles(event.target.files)}
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt"
        className="hidden"
        onChange={(event) => void handleAttachSubtitleSrt(event.target.files)}
      />
      <Dialog open={isSubtitleHistoryDialogOpen} onOpenChange={setIsSubtitleHistoryDialogOpen}>
        <DialogContent className="border-white/10 bg-[linear-gradient(180deg,rgba(8,11,16,0.985),rgba(4,7,12,0.985))] text-white sm:max-w-[44rem]">
          <DialogHeader>
            <DialogTitle>Select subtitles from history</DialogTitle>
            <DialogDescription className="text-white/58">
              Choose a subtitle version and load it into the global `S1` track.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {historyItemsWithSubtitles.length === 0 ? (
              <div className="rounded-[0.95rem] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/45">
                No history items with subtitles are available yet.
              </div>
            ) : (
              historyItemsWithSubtitles.map((item) => {
                const transcript = getLatestTranscript(item);
                if (!transcript) return null;
                return (
                  <div
                    key={item.id}
                    className="rounded-[0.95rem] border border-white/8 bg-white/[0.03] p-3"
                  >
                    <div className="text-sm font-medium text-white">{item.filename}</div>
                    <div className="mt-1 text-xs text-white/45">{transcript.label}</div>
                    <div className="mt-3 space-y-2">
                      {transcript.subtitles.map((subtitle) => (
                        <button
                          key={subtitle.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-[0.85rem] border border-white/8 bg-black/20 px-3 py-2 text-left transition-colors hover:border-white/16 hover:bg-white/[0.04]"
                          onClick={() => handleSelectHistorySubtitle(item, transcript.id, subtitle.id)}
                        >
                          <span className="truncate pr-3 text-sm text-white/82">{subtitle.label}</span>
                          <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-white/40">
                            {subtitle.language}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-white/15 bg-transparent text-white hover:bg-white/5"
              >
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto flex h-full w-full flex-col gap-[6px]">
        <TimelineWorkspaceHeader
          projectName={project.name}
          projectAspectRatio={project.aspectRatio}
          lastError={project.lastError}
          saveState={saveState}
          panelVisibility={panelVisibility}
          isRenderBusy={isRenderBusy}
          onProjectNameChange={handleProjectNameChange}
          onAspectRatioChange={handleAspectRatioChange}
          onTogglePanel={togglePanel}
          onCopyLastError={handleCopyLastError}
          onDeleteLastError={handleDeleteLastError}
          onExport={handleOpenExportDialog}
        />
        {activeRenderTask ? (
          <div className="px-1.5 pt-1">
            <BackgroundTaskBanner
              task={activeRenderTask}
              onCancel={activeRenderTask.canCancel ? (isBakingClip ? handleCancelBake : handleCancelExport) : undefined}
            />
          </div>
        ) : null}

        <div className={cn("grid min-h-0 flex-1 grid-rows-[minmax(0,0.95fr)_minmax(320px,0.82fr)] gap-[6px]", isInteractionLocked && "pointer-events-none select-none")}>
          <section ref={topPanelsRef} className="flex min-h-0 gap-[6px]">
            {panelVisibility.left ? (
              <div
                className={cn(
                  "min-w-0 min-h-0",
                  panelVisibility.center || panelVisibility.right ? "shrink-0" : "flex-1"
                )}
                style={panelVisibility.center || panelVisibility.right ? { flexBasis: `${panelWidths.leftPct}%` } : undefined}
              >
                <Card className={EDITOR_PANEL_CLASS}>
                  <CardContent className={cn(EDITOR_PANEL_CONTENT_CLASS, "relative")}>
                    <div className={EDITOR_PANEL_HEADER_CLASS}>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className={EDITOR_LABEL_CLASS}>{isHistoryOpen ? "History" : "Media"}</div>
                        <div className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[9px] uppercase tracking-[0.24em] text-white/36">
                          {isHistoryOpen ? history.length : assets.length}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isHistoryOpen && (
                          <Button
                            variant="outline"
                            className={cn(EDITOR_TOOLBAR_BUTTON_CLASS, "h-7 rounded-md px-2.5")}
                            onClick={() => mediaInputRef.current?.click()}
                          >
                            <FolderOpen className="mr-2 h-4 w-4" />
                            Import
                          </Button>
                        )}
                        <Button
                          ref={historyButtonRef}
                          variant="ghost"
                          className={cn(
                            EDITOR_TOOLBAR_BUTTON_CLASS,
                            "h-7 rounded-md border-none px-2.5",
                            isHistoryOpen
                              ? "bg-cyan-400/12 text-cyan-100 hover:bg-cyan-400/16"
                              : "bg-white/[0.035] text-white/62 hover:bg-white/[0.08] hover:text-white"
                          )}
                          onClick={() => setIsHistoryOpen((current) => !current)}
                        >
                          <Search className="mr-2 h-4 w-4" />
                          {isHistoryOpen ? "Media" : "History"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-md text-white/38 hover:bg-white/[0.06] hover:text-white"
                          onClick={() => togglePanel("left")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div ref={historyPanelRef} className={EDITOR_PANEL_BODY_CLASS}>
                        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                          {isHistoryOpen ? (
                            <>
                              <div className="mb-2">
                                <Input
                                  value={librarySearch}
                                  onChange={(event) => setLibrarySearch(event.target.value)}
                                  placeholder="Search transcript history"
                                  className="h-8 rounded-md border-white/8 bg-white/[0.04]"
                                />
                              </div>
                              <div className="space-y-2">
                                {filteredHistory.length === 0 ? (
                                  <div className="rounded-[0.9rem] border border-dashed border-white/10 p-4 text-sm text-white/40">
                                    No history items match this search.
                                  </div>
                                ) : (
                                  filteredHistory.map((item) => {
                                    const transcript = getLatestTranscript(item);
                                    return (
                                      <div
                                        key={item.id}
                                        className="rounded-[0.9rem] border border-white/8 bg-white/[0.025] p-3 transition-colors hover:border-white/14 hover:bg-white/[0.04]"
                                      >
                                        <div className="truncate text-sm font-medium text-white">{item.filename}</div>
                                        <div className="mt-1 text-xs text-white/42">
                                          {transcript ? `${transcript.subtitles.length} subtitle versions` : "No subtitles"}
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 rounded-lg border-white/8 bg-black/20 text-white/78 hover:bg-white/[0.08] hover:text-white"
                                            onClick={() => void handleAddHistoryItem(item)}
                                          >
                                            Add to Bin
                                          </Button>
                                          {transcript?.subtitles.length ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-8 rounded-lg border-white/8 bg-black/20 text-white/78 hover:bg-white/[0.08] hover:text-white"
                                              onClick={() => setIsSubtitleHistoryDialogOpen(true)}
                                            >
                                              Use Subs
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </>
                          ) : assets.length === 0 ? (
                            <div className="grid h-full place-items-center rounded-[0.9rem] border border-dashed border-white/10 bg-black/20 p-4 text-center text-sm text-white/45">
                              Import video, audio, or image assets, or pull media from history to populate this project.
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                              {assets.map((asset) => {
                                const resolved = resolvedAssetsMap.get(asset.id);
                                return (
                                  <div key={asset.id} className="space-y-1.5">
                                    <ProjectAssetThumbnail
                                      resolvedAsset={resolved}
                                      isActive={previewMode.kind === "asset" && previewMode.assetId === asset.id}
                                      onSelect={() => setPreviewMode({ kind: "asset", assetId: asset.id })}
                                      onDelete={() => void handleDeleteAsset(asset)}
                                      onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", asset.id);
                                        dragAssetIdRef.current = asset.id;
                                        dragAssetKindRef.current = asset.kind;
                                        setDraggingAssetId(asset.id);
                                        setDraggingAssetKind(asset.kind);
                                        setDraggingVideoBlockId(null);
                                        dragVideoBlockRef.current = null;
                                        setDropTargetIndex(asset.kind === "video" ? videoBlockPlacements.length : null);
                                      }}
                                      onDragEnd={clearTimelineDragState}
                                      isDragging={draggingAssetId === asset.id}
                                    />
                                    {resolved?.missing ? (
                                      <div className="rounded-lg border border-red-400/18 bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-100">
                                        Missing source file
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {showLeftResizeHandle ? (
              <button
                type="button"
                aria-label="Resize left panel"
                onPointerDown={beginPanelResize("left")}
                className="grid w-1 shrink-0 place-items-center bg-white/[0.02] text-white/12 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100/70"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            ) : null}

            {panelVisibility.center ? (
              <div className="min-w-0 min-h-0 flex-1">
                <Card className={EDITOR_PANEL_CLASS}>
                  <CardContent className={EDITOR_PANEL_CONTENT_CLASS}>
                    <div className={cn(EDITOR_PANEL_HEADER_CLASS, "gap-3")}>
                      <div className="min-w-0 flex flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                        <div className="truncate text-sm text-white/78">{previewTitle}</div>
                        <div className={cn(EDITOR_TIMECODE_CLASS, "truncate")}>{previewMeta}</div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="flex items-center gap-1 rounded-[0.9rem] border border-white/8 bg-black/25 p-1">
                          <button
                            type="button"
                            className={cn(
                              "rounded-[0.7rem] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] transition-colors",
                              previewMode.kind === "timeline"
                                ? "bg-white/[0.08] text-white"
                                : "text-white/36 hover:bg-white/[0.05] hover:text-white/72"
                            )}
                            onClick={() => setPreviewMode({ kind: "timeline" })}
                          >
                            Timeline
                          </button>
                          <div
                            className={cn(
                              "rounded-[0.7rem] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em]",
                              previewMode.kind === "asset" ? "bg-cyan-400/12 text-cyan-100" : "text-white/36"
                            )}
                          >
                            Asset
                          </div>
                        </div>
                        <div className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[9px] uppercase tracking-[0.24em] text-white/36">
                          {previewBadge}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-md text-white/38 hover:bg-white/[0.06] hover:text-white"
                          onClick={() => togglePanel("center")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className={EDITOR_PANEL_BODY_CLASS}>
                      <div className="flex min-h-0 flex-1 flex-col rounded-[0.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(9,12,17,0.98),rgba(5,8,12,0.98))] p-1.5">
                        <div className="flex min-h-0 flex-1 items-center justify-center">
                          <div
                            ref={timelinePreviewFrameRef}
                            className="relative max-h-full w-full overflow-hidden rounded-[1rem] border border-white/8 bg-black shadow-[0_14px_24px_rgba(0,0,0,0.26)]"
                            style={{
                              width: "min(100%, 760px)",
                              aspectRatio: String(aspectRatioValue),
                            }}
                          >
                            {previewMode.kind === "timeline" ? (
                              effectiveTimelineVideoUrl || previewImageUrl ? (
                                <>
                                  {effectiveTimelineVideoUrl ? (
                                    <video
                                      ref={videoRef}
                                      key={`timeline:${effectiveTimelineVideoUrl}`}
                                      src={effectiveTimelineVideoUrl}
                                      preload="auto"
                                      playsInline
                                      className="absolute inset-0 h-full w-full object-cover"
                                      style={{
                                        transform: `translate(${activePlacement?.clip.canvas.panX ?? 0}px, ${activePlacement?.clip.canvas.panY ?? 0}px) scale(${activePlacement?.clip.canvas.zoom ?? 1})`,
                                        transformOrigin: "center center",
                                      }}
                                    />
                                  ) : null}
                                  {previewImageUrl ? (
                                    timelineImagePreviewLayout &&
                                    previewImageAsset?.asset.width &&
                                    previewImageAsset.asset.height ? (
                                      <div className="absolute inset-0 overflow-hidden bg-black">
                                        <div
                                          className="absolute left-0 top-0"
                                          style={{
                                            width: timelineImagePreviewLayout.canvasWidth,
                                            height: timelineImagePreviewLayout.canvasHeight,
                                            transform: `translate(${-timelineImagePreviewLayout.cropX}px, ${-timelineImagePreviewLayout.cropY}px)`,
                                          }}
                                        >
                                          <Image
                                            src={previewImageUrl}
                                            alt={activeImagePlacement?.item.label ?? "Timeline image"}
                                            width={previewImageAsset.asset.width}
                                            height={previewImageAsset.asset.height}
                                            unoptimized
                                            className="absolute max-w-none select-none"
                                            style={{
                                              left: timelineImagePreviewLayout.padX,
                                              top: timelineImagePreviewLayout.padY,
                                              width: timelineImagePreviewLayout.scaledWidth,
                                              height: timelineImagePreviewLayout.scaledHeight,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="absolute inset-0 bg-black">
                                        <Image
                                          src={previewImageUrl}
                                          alt={activeImagePlacement?.item.label ?? "Timeline image"}
                                          fill
                                          unoptimized
                                          sizes="760px"
                                          className="object-contain"
                                        />
                                      </div>
                                    )
                                  ) : null}
                                  {activeReactiveOverlayPreviewItems.map(({ placement, rect, frame }) => (
                                    <div
                                      key={placement.item.id}
                                      className="pointer-events-none absolute"
                                      style={{
                                        left: rect.x,
                                        top: rect.y,
                                        width: rect.width,
                                        height: rect.height,
                                        opacity: placement.item.opacity,
                                      }}
                                    >
                                      <ReactiveOverlayPreviewFrame frame={frame} />
                                    </div>
                                  ))}
                                  {project.subtitles.enabled && currentCaptionPreviewUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={currentCaptionPreviewUrl}
                                      alt=""
                                      className="pointer-events-none absolute inset-0 h-full w-full select-none"
                                      draggable={false}
                                    />
                                  ) : project.subtitles.enabled && currentCaption && currentCaptionLayout && currentCaptionStyle ? (
                                    <div
                                      className="pointer-events-none absolute text-center"
                                      style={{
                                        left: `${Math.round(currentCaptionLayout.anchorX * currentCaptionPreviewScale)}px`,
                                        top: `${Math.round(currentCaptionLayout.anchorY * currentCaptionPreviewScale)}px`,
                                        transform: "translate(-50%, -50%)",
                                        maxWidth: `${Math.round(subtitlePreviewRenderSize?.width ? subtitlePreviewRenderSize.width * 0.82 * currentCaptionPreviewScale : 0)}px`,
                                        width: "max-content",
                                      }}
                                    >
                                      <div
                                        className="inline-block max-w-full text-center"
                                        style={{
                                          transform: `scaleX(${Math.max(1, Math.min(1.5, currentCaptionStyle.letterWidth))})`,
                                          transformOrigin: "center center",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "block",
                                            whiteSpace: "pre-line",
                                            textAlign: "center",
                                            color: currentCaptionStyle.textColor,
                                            fontSize: `${(currentCaptionLayout.fontSize * currentCaptionPreviewScale).toFixed(2)}px`,
                                            lineHeight: `${(currentCaptionLayout.lineHeight * currentCaptionPreviewScale).toFixed(2)}px`,
                                            fontWeight: 700,
                                            fontFamily: "var(--font-inter), 'Inter', sans-serif",
                                            textShadow: cssTextShadowFromStyle(currentCaptionStyle, currentCaptionPreviewScale),
                                            WebkitTextStroke: `${Math.max(1, currentCaptionStyle.borderWidth * currentCaptionPreviewScale).toFixed(2)}px ${cssRgbaFromHex(currentCaptionStyle.borderColor, 0.95)}`,
                                            paintOrder: "stroke fill",
                                            backgroundColor: currentCaptionStyle.backgroundEnabled
                                              ? cssRgbaFromHex(
                                                  currentCaptionStyle.backgroundColor,
                                                  currentCaptionStyle.backgroundOpacity
                                                )
                                              : "transparent",
                                            borderRadius: currentCaptionStyle.backgroundEnabled
                                              ? `${(currentCaptionStyle.backgroundRadius * currentCaptionPreviewScale).toFixed(2)}px`
                                              : undefined,
                                            padding: currentCaptionStyle.backgroundEnabled
                                              ? `${(currentCaptionStyle.backgroundPaddingY * currentCaptionPreviewScale).toFixed(2)}px ${(currentCaptionStyle.backgroundPaddingX * currentCaptionPreviewScale).toFixed(2)}px`
                                              : undefined,
                                          }}
                                        >
                                          {currentCaptionLayout.lines.join("\n")}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                  {isReversePreviewLoading ? (
                                    <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
                                      <div className="rounded-[1rem] border border-cyan-300/20 bg-slate-950/90 px-4 py-3 text-center shadow-[0_16px_44px_rgba(0,0,0,0.45)]">
                                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-cyan-200" />
                                        <div className="text-sm font-medium text-white">Preparing reversed preview</div>
                                        <div className="mt-1 text-xs uppercase tracking-[0.22em] text-white/45">
                                          Cached local proxy
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="absolute inset-0 grid place-items-center text-center text-white/45">
                                  <div>
                                    {isReversePreviewLoading ? (
                                      <>
                                        <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-cyan-200/70" />
                                        Rebuilding the reversed clip preview…
                                      </>
                                    ) : (
                                      <>
                                        <Film className="mx-auto mb-4 h-12 w-12 text-white/20" />
                                        No visual source resolved for the current playhead.
                                      </>
                                    )}
                                  </div>
                                </div>
                              )
                            ) : previewedAsset?.kind === "video" ? (
                              previewVideoUrl ? (
                                <video
                                  key={`asset:${previewVideoUrl}`}
                                  src={previewVideoUrl}
                                  preload="auto"
                                  controls
                                  playsInline
                                  className="absolute inset-0 h-full w-full object-contain"
                                />
                              ) : (
                                <div className="absolute inset-0 grid place-items-center text-center text-white/45">
                                  <div>
                                    <Film className="mx-auto mb-4 h-12 w-12 text-white/20" />
                                    This asset is missing from browser storage.
                                  </div>
                                </div>
                              )
                            ) : previewedAsset?.kind === "audio" ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_30%),linear-gradient(180deg,rgba(15,18,27,0.95),rgba(4,7,12,0.98))] p-8 text-center">
                                <div className="rounded-full border border-white/10 bg-white/5 p-5 text-amber-100">
                                  <Music4 className="h-8 w-8" />
                                </div>
                                <div>
                                  <div className="text-lg font-semibold text-white">{previewedAsset.filename}</div>
                                  <div className="mt-2 text-sm text-white/55">
                                    {secondsToClock(previewedAsset.durationSeconds)} · audio asset preview
                                  </div>
                                </div>
                                {previewAudioUrl ? (
                                  <audio controls src={previewAudioUrl} className="w-full max-w-md" />
                                ) : (
                                  <div className="text-sm text-white/45">This audio file is missing from browser storage.</div>
                                )}
                              </div>
                            ) : previewedAsset?.kind === "image" ? (
                              previewImageUrl ? (
                                <Image
                                  src={previewImageUrl}
                                  alt={previewedAsset.filename}
                                  fill
                                  unoptimized
                                  sizes="760px"
                                  className="object-contain bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.12),transparent_32%),linear-gradient(180deg,rgba(8,18,17,0.98),rgba(4,8,10,0.98))]"
                                />
                              ) : (
                                <div className="absolute inset-0 grid place-items-center text-center text-white/45">
                                  <div>
                                    <ImageIcon className="mx-auto mb-4 h-12 w-12 text-white/20" />
                                    This image is missing from browser storage.
                                  </div>
                                </div>
                              )
                            ) : (
                              <div className="absolute inset-0 grid place-items-center text-center text-white/45">
                                <div>
                                  <ImageIcon className="mx-auto mb-4 h-12 w-12 text-white/20" />
                                  Select a project asset to preview it here.
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-1.5 shrink-0">
                          {previewMode.kind === "timeline" ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[0.9rem] border border-white/8 bg-black/25 px-3 py-2">
                                <div className={EDITOR_TIMECODE_CLASS}>
                                  {secondsToClock(playheadSeconds)} / {secondsToClock(projectDuration)}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    className={EDITOR_TOOLBAR_BUTTON_CLASS}
                                    onClick={() => setIsPlaying((current) => !current)}
                                  >
                                    {isPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                                    {isPlaying ? "Pause" : "Play"}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="h-8 rounded-[0.85rem] px-3 text-xs text-white/52 hover:bg-white/[0.06] hover:text-white"
                                    onClick={() => setTimelinePlayhead(0)}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(projectDuration, 0.1)}
                                step={0.01}
                                value={playheadSeconds}
                                onChange={(event) => setTimelinePlayhead(Number(event.target.value))}
                                className="mt-2 w-full accent-cyan-400"
                              />
                            </>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[0.9rem] border border-cyan-400/14 bg-cyan-400/[0.045] px-3 py-2.5">
                              <div className="text-sm text-white/58">
                                Project assets preview independently. Click any timeline item to return to the live sequence.
                              </div>
                              <Button
                                variant="outline"
                                className={EDITOR_TOOLBAR_BUTTON_CLASS}
                                onClick={() => setPreviewMode({ kind: "timeline" })}
                              >
                                Back to Timeline
                              </Button>
                            </div>
                          )}
                          {previewMode.kind === "timeline" && previewAudioUrl ? (
                            <audio ref={audioRef} src={previewAudioUrl} preload="auto" hidden />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {showRightResizeHandle ? (
              <button
                type="button"
                aria-label="Resize right panel"
                onPointerDown={beginPanelResize("right")}
                className="grid w-1 shrink-0 place-items-center bg-white/[0.02] text-white/12 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100/70"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            ) : null}

            {panelVisibility.right ? (
              <div
                className={cn("min-w-0 min-h-0", panelVisibility.center ? "shrink-0" : "flex-1")}
                style={panelVisibility.center ? { flexBasis: `${panelWidths.rightPct}%` } : undefined}
              >
                <Card className={EDITOR_PANEL_CLASS}>
                  <CardContent className={EDITOR_PANEL_CONTENT_CLASS}>
                    <div className={EDITOR_PANEL_HEADER_CLASS}>
                      <div className={EDITOR_LABEL_CLASS}>Inspector</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md text-white/38 hover:bg-white/[0.06] hover:text-white"
                        onClick={() => togglePanel("right")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-1.5 pt-1.5 sm:px-2 sm:pb-2">
                      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        {inspectorClip && inspectorClipAsset ? (
                          <div className="space-y-2.5">
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className={EDITOR_LABEL_CLASS}>{selectedVideoGroup ? "Joined Block" : "Selected Clip"}</div>
                                  <div className="mt-2 text-lg font-semibold text-white">
                                    {selectedVideoGroup ? selectedVideoGroup.label : inspectorClip.label}
                                  </div>
                                  <div className="mt-1 text-sm text-white/50">
                                    {selectedVideoGroup
                                      ? `${selectedGroupClipPlacements.length} clips · ${secondsToClock(
                                          selectedGroupClipPlacements.reduce(
                                            (total, placement) => total + placement.durationSeconds,
                                            0
                                          )
                                        )}`
                                      : inspectorClipAsset.filename}
                                  </div>
                                  {selectedVideoGroup ? (
                                    <div className="mt-2 text-sm text-white/45">
                                      Focused child clip: {inspectorClip.label}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="flex items-start gap-2">
                                  <div
                                    className={cn(
                                      "rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.24em]",
                                      selectedVideoGroup
                                        ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
                                        : inspectorClip.actions.reverse
                                        ? "border border-cyan-300/24 bg-cyan-300/12 text-cyan-100"
                                        : "border border-white/8 bg-white/[0.04] text-white/45"
                                    )}
                                  >
                                    {selectedVideoGroup
                                      ? "Joined"
                                      : inspectorClip.actions.reverse
                                        ? "Reverse On"
                                        : "Normal"}
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        className="mt-0.5 rounded-md text-white/46 hover:bg-white/[0.06] hover:text-white"
                                        aria-label="Clip actions"
                                      >
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                      <DropdownMenuItem
                                        disabled={!selectedTrackActionState.canCloneToFill}
                                        onSelect={() => {
                                          cloneSelectedTimelineItemToFill();
                                        }}
                                      >
                                        <Copy className="h-4 w-4" />
                                        Clone to Fill Track
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        disabled={!selectedTrackActionState.canTrimToMatch}
                                        onSelect={() => {
                                          trimSelectedTimelineItemToMatchTrack();
                                        }}
                                      >
                                        <Scissors className="h-4 w-4" />
                                        Trim End to Match Other Track
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            </div>

                            <Tabs
                              value={inspectorVideoTab}
                              onValueChange={(value) => setInspectorVideoTab(value as InspectorVideoTab)}
                              className="flex min-h-0 flex-col"
                            >
                              <TabsList className="grid w-full shrink-0 grid-cols-3 rounded-[0.75rem] border border-white/8 bg-black/25 p-1">
                                <TabsTrigger value="edit" className="rounded-[0.72rem] text-[11px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                                  Edit
                                </TabsTrigger>
                                <TabsTrigger value="transform" className="rounded-[0.72rem] text-[11px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                                  Transform
                                </TabsTrigger>
                                <TabsTrigger value="join" className="rounded-[0.72rem] text-[11px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                                  Join
                                </TabsTrigger>
                              </TabsList>

                              <TabsContent value="edit" className="mt-2 space-y-2.5">
                                <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className={EDITOR_LABEL_CLASS}>Trim</div>
                                    <SectionResetButton onClick={resetInspectorClipTrim} />
                                  </div>
                                  <label className="text-xs uppercase tracking-[0.24em] text-white/45">
                                    Trim Start · {secondsToClock(inspectorClip.trimStartSeconds)}
                                  </label>
                                  <input
                                    type="range"
                                    min={0}
                                    max={Math.max(inspectorClipAsset.durationSeconds - 0.5, 0.5)}
                                    step={0.01}
                                    value={inspectorClip.trimStartSeconds}
                                    onChange={(event) =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        trimStartSeconds: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                  <label className="text-xs uppercase tracking-[0.24em] text-white/45">
                                    Trim End · {secondsToClock(inspectorClip.trimEndSeconds)}
                                  </label>
                                  <input
                                    type="range"
                                    min={Math.min(inspectorClip.trimStartSeconds + 0.5, inspectorClipAsset.durationSeconds)}
                                    max={inspectorClipAsset.durationSeconds}
                                    step={0.01}
                                    value={inspectorClip.trimEndSeconds}
                                    onChange={(event) =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        trimEndSeconds: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </div>

                                <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className={EDITOR_LABEL_CLASS}>Frame</div>
                                    <SectionResetButton onClick={resetInspectorClipFrame} />
                                  </div>
                                  <label className="text-xs text-white/55">Zoom · {inspectorClip.canvas.zoom.toFixed(2)}x</label>
                                  <input
                                    type="range"
                                    min={0.6}
                                    max={2.4}
                                    step={0.01}
                                    value={inspectorClip.canvas.zoom}
                                    onChange={(event) =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        canvas: {
                                          ...clip.canvas,
                                          zoom: Number(event.target.value),
                                        },
                                      }))
                                    }
                                    className="w-full"
                                  />
                                  <label className="text-xs text-white/55">Pan X · {Math.round(inspectorClip.canvas.panX)}px</label>
                                  <input
                                    type="range"
                                    min={-240}
                                    max={240}
                                    step={1}
                                    value={inspectorClip.canvas.panX}
                                    onChange={(event) =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        canvas: {
                                          ...clip.canvas,
                                          panX: Number(event.target.value),
                                        },
                                      }))
                                    }
                                    className="w-full"
                                  />
                                  <label className="text-xs text-white/55">Pan Y · {Math.round(inspectorClip.canvas.panY)}px</label>
                                  <input
                                    type="range"
                                    min={-240}
                                    max={240}
                                    step={1}
                                    value={inspectorClip.canvas.panY}
                                    onChange={(event) =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        canvas: {
                                          ...clip.canvas,
                                          panY: Number(event.target.value),
                                        },
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </div>

                                <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <div className={EDITOR_LABEL_CLASS}>Clip Audio</div>
                                      <SectionResetButton onClick={resetInspectorClipAudio} />
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 rounded-lg px-2 text-white/60 hover:bg-white/[0.06] hover:text-white"
                                      onClick={() =>
                                        updateInspectorClip((clip) => ({
                                          ...clip,
                                          muted: !clip.muted,
                                        }))
                                      }
                                    >
                                      {inspectorClip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                    </Button>
                                  </div>
                                  <label className="text-xs text-white/55">Volume · {Math.round(inspectorClip.volume * 100)}%</label>
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={inspectorClip.volume}
                                    onChange={(event) =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        volume: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </div>
                              </TabsContent>

                              <TabsContent value="transform" className="mt-2 space-y-2.5">
                                <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className={EDITOR_LABEL_CLASS}>Reverse Clip</div>
                                    </div>
                                    <SectionResetButton onClick={resetInspectorClipTransform} />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                      EDITOR_TOOLBAR_BUTTON_CLASS,
                                      "h-10 w-full justify-center rounded-[0.95rem] border-white/10 text-sm",
                                      inspectorClip.actions.reverse
                                        ? "border-cyan-300/24 bg-cyan-300/12 text-cyan-100 hover:bg-cyan-300/18"
                                        : ""
                                    )}
                                    onClick={() =>
                                      updateInspectorClip((clip) => ({
                                        ...clip,
                                        actions: {
                                          ...clip.actions,
                                          reverse: !clip.actions.reverse,
                                        },
                                      }))
                                    }
                                  >
                                    {inspectorClip.actions.reverse ? <Check className="mr-2 h-4 w-4" /> : null}
                                    {inspectorClip.actions.reverse ? "Reversed" : "Enable Reverse"}
                                  </Button>
                                  {inspectorClip.actions.reverse ? (
                                    <div className="rounded-[0.9rem] border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/55">
                                      This clip now plays backward as a regular transformed clip.
                                    </div>
                                  ) : null}
                                </div>
                              </TabsContent>

                              <TabsContent value="join" className="mt-2 space-y-2.5">
                                {selectedVideoGroup ? (
                                  <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                                    <div className="flex items-center justify-between gap-3">
                                      <div className={EDITOR_LABEL_CLASS}>Joined Block</div>
                                      <div className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-white/45">
                                        {selectedGroupClipPlacements.length} clips
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      {selectedGroupClipPlacements.map((placement, index) => {
                                        const isFocused = inspectorClip.id === placement.clip.id;
                                        return (
                                          <button
                                            key={placement.clip.id}
                                            type="button"
                                            onClick={() => setFocusedJoinedClipId(placement.clip.id)}
                                            className={cn(
                                              "flex w-full items-center justify-between rounded-[0.85rem] border px-3 py-2 text-left text-sm transition-colors",
                                              isFocused
                                                ? "border-cyan-300/24 bg-cyan-300/10 text-cyan-50"
                                                : "border-white/8 bg-white/[0.03] text-white/72 hover:border-white/16 hover:bg-white/[0.05]"
                                            )}
                                          >
                                            <span className="truncate pr-3">
                                              Clip {index + 1} · {placement.clip.label}
                                            </span>
                                            <span className="font-mono text-[11px] text-white/42">
                                              {secondsToClock(placement.durationSeconds)}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="h-10 rounded-[0.95rem] border-white/10 text-sm text-white hover:bg-white/[0.08]"
                                        onClick={unjoinSelectedTimelineGroup}
                                      >
                                        Unjoin
                                      </Button>
                                      <Button
                                        type="button"
                                        disabled={isBakingClip}
                                        className="h-10 rounded-[0.95rem] border border-amber-300/18 bg-amber-300/90 text-sm font-semibold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() => void bakeSelectedTimelineGroup()}
                                      >
                                        {isBakingClip ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Bake Clip
                                      </Button>
                                    </div>

                                  </div>
                                ) : (
                                  <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <div className={EDITOR_LABEL_CLASS}>Join Selected Clips</div>
                                        <div className="mt-1 text-sm text-white/55">
                                          Select exactly two adjacent, ungrouped clips in the timeline to make them behave like one block.
                                        </div>
                                      </div>
                                      <div className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-white/45">
                                        {selectedVideoPlacements.length} selected
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      {selectedVideoPlacements.length > 0 ? (
                                        selectedVideoPlacements.map((placement) => (
                                          <div
                                            key={placement.clip.id}
                                            className="flex items-center justify-between rounded-[0.85rem] border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/72"
                                          >
                                            <span className="truncate pr-3">{placement.clip.label}</span>
                                            <span className="font-mono text-[11px] text-white/36">
                                              {secondsToClock(placement.durationSeconds)}
                                            </span>
                                          </div>
                                        ))
                                      ) : (
                                        <div className="rounded-[0.95rem] border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/45">
                                          Select one clip, open `Join`, then click the second adjacent clip in the timeline.
                                        </div>
                                      )}
                                    </div>
                                    <div className="rounded-[0.9rem] border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/55">
                                      {selectedVideoPlacements.length !== 2
                                        ? "Join activates when exactly two video clips are selected."
                                        : canJoinSelectedVideoClips
                                          ? "The selected clips are adjacent and ready to join."
                                          : "Join only works for two adjacent clips that are not already part of a joined block."}
                                    </div>
                                    <Button
                                      type="button"
                                      disabled={!canJoinSelectedVideoClips}
                                      className="h-10 w-full rounded-[0.95rem] border border-cyan-300/18 bg-cyan-300/90 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                                      onClick={joinSelectedTimelineClips}
                                    >
                                      Join Selected Clips
                                    </Button>
                                  </div>
                                )}
                              </TabsContent>
                            </Tabs>
                          </div>
                        ) : selectedSubtitleTrack ? (
                          <div className="space-y-2.5">
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className={EDITOR_LABEL_CLASS}>Subtitle Track</div>
                                  <div className="mt-2 text-lg font-semibold text-white">
                                    {selectedSubtitleTrack.label ?? "Global subtitles"}
                                  </div>
                                  <div className="mt-1 text-sm text-white/50">
                                    {selectedSubtitleTrack.language?.toUpperCase() ?? "Und"} · {selectedSubtitleTrack.chunks.length} cues
                                  </div>
                                </div>
                                <div className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-fuchsia-100">
                                  S1
                                </div>
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className={EDITOR_LABEL_CLASS}>Source</div>
                                <Switch
                                  checked={selectedSubtitleTrack.enabled}
                                  onCheckedChange={(checked) =>
                                    updateSubtitleTrack((subtitles) => ({
                                      ...subtitles,
                                      enabled: checked,
                                    }))
                                  }
                                />
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-10 rounded-[0.95rem] border-white/10 text-white hover:bg-white/[0.08]"
                                  onClick={() => setIsSubtitleHistoryDialogOpen(true)}
                                >
                                  Select From History
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-10 rounded-[0.95rem] border-white/10 text-white hover:bg-white/[0.08]"
                                  onClick={() => srtInputRef.current?.click()}
                                >
                                  Upload SRT
                                </Button>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-8 rounded-lg px-3 text-white/68 hover:bg-white/[0.06] hover:text-white"
                                  onClick={() => focusTimelineSelection({ kind: "subtitle", id: EDITOR_SUBTITLE_TRACK_ID })}
                                >
                                  Focus S1
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-8 rounded-lg px-3 text-red-200/78 hover:bg-red-500/10 hover:text-red-100"
                                  onClick={clearProjectSubtitleTrack}
                                >
                                  Remove Track
                                </Button>
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className={EDITOR_LABEL_CLASS}>Timing</div>
                                <SectionResetButton onClick={resetSubtitleTrackTiming} />
                              </div>
                              <div className="space-y-2">
                                <div className="text-xs text-white/55">Display</div>
                                <Select
                                  value={selectedSubtitleTrack.subtitleTimingMode}
                                  onValueChange={(value) =>
                                    updateSubtitleTrack((subtitles) => ({
                                      ...subtitles,
                                      subtitleTimingMode: value as CreatorSubtitleTimingMode,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="border-white/10 bg-slate-950 text-white">
                                    {Object.entries(EDITOR_SUBTITLE_TIMING_MODE_LABELS).map(([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {effectiveSubtitleTimingMode !== selectedSubtitleTrack.subtitleTimingMode ? (
                                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
                                    This subtitle source does not include compatible word timings, so preview and export are using normal subtitle chunks.
                                  </div>
                                ) : null}
                              </div>
                              <label className="text-xs text-white/55">
                                Offset · {selectedSubtitleTrack.offsetSeconds.toFixed(2)}s
                              </label>
                              <input
                                type="range"
                                min={-6}
                                max={6}
                                step={0.01}
                                value={selectedSubtitleTrack.offsetSeconds}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    offsetSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">
                                Trim Start · {secondsToClock(selectedSubtitleTrack.trimStartSeconds)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(selectedSubtitleSourceDuration - 0.5, 0.5)}
                                step={0.01}
                                value={Math.min(selectedSubtitleTrack.trimStartSeconds, Math.max(selectedSubtitleSourceDuration - 0.5, 0.5))}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    trimStartSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">
                                Trim End · {secondsToClock(selectedSubtitleTrack.trimEndSeconds)}
                              </label>
                              <input
                                type="range"
                                min={Math.min(selectedSubtitleTrack.trimStartSeconds + 0.5, Math.max(selectedSubtitleSourceDuration, 0.5))}
                                max={Math.max(selectedSubtitleSourceDuration, 0.5)}
                                step={0.01}
                                value={Math.max(selectedSubtitleTrack.trimEndSeconds, Math.min(selectedSubtitleTrack.trimStartSeconds + 0.5, Math.max(selectedSubtitleSourceDuration, 0.5)))}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    trimEndSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className={EDITOR_LABEL_CLASS}>Placement</div>
                                <SectionResetButton onClick={resetSubtitleTrackStyle} />
                              </div>
                              <div className="mb-1 text-xs uppercase tracking-[0.24em] text-white/45">Preset</div>
                              <Select
                                value={selectedSubtitleTrack.preset}
                                onValueChange={(value) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    preset: value as EditorProjectRecord["subtitles"]["preset"],
                                    style: resolveCreatorSubtitleStyle(
                                      value as EditorProjectRecord["subtitles"]["preset"],
                                      {
                                        ...getDefaultEditorSubtitleStyle(
                                          value as EditorProjectRecord["subtitles"]["preset"]
                                        ),
                                        ...subtitles.style,
                                      }
                                    ),
                                  }))
                                }
                              >
                                <SelectTrigger className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white">
                                  <SelectValue placeholder="Preset" />
                                </SelectTrigger>
                                <SelectContent className="border-white/10 bg-slate-950 text-white">
                                  {Object.entries(CREATOR_SUBTITLE_STYLE_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <label className="text-xs text-white/55">Scale · {selectedSubtitleTrack.scale.toFixed(2)}x</label>
                              <input
                                type="range"
                                min={0.7}
                                max={2.5}
                                step={0.01}
                                value={selectedSubtitleTrack.scale}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    scale: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Position X · {Math.round(selectedSubtitleTrack.positionXPercent)}%</label>
                              <input
                                type="range"
                                min={10}
                                max={90}
                                step={1}
                                value={selectedSubtitleTrack.positionXPercent}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    positionXPercent: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Position Y · {Math.round(selectedSubtitleTrack.positionYPercent)}%</label>
                              <input
                                type="range"
                                min={45}
                                max={92}
                                step={1}
                                value={selectedSubtitleTrack.positionYPercent}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    positionYPercent: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Appearance</div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="space-y-1 text-xs text-white/55">
                                  <span>Text Color</span>
                                  <input
                                    type="color"
                                    value={selectedSubtitleTrack.style?.textColor ?? "#FFFFFF"}
                                    onChange={(event) =>
                                      updateSubtitleTrack((subtitles) => ({
                                        ...subtitles,
                                        style: {
                                          ...subtitles.style,
                                          textColor: event.target.value,
                                        },
                                      }))
                                    }
                                    className="h-10 w-full rounded-lg border border-white/10 bg-transparent"
                                  />
                                </label>
                                <label className="space-y-1 text-xs text-white/55">
                                  <span>Outline Color</span>
                                  <input
                                    type="color"
                                    value={selectedSubtitleTrack.style?.borderColor ?? "#2A2A2A"}
                                    onChange={(event) =>
                                      updateSubtitleTrack((subtitles) => ({
                                        ...subtitles,
                                        style: {
                                          ...subtitles.style,
                                          borderColor: event.target.value,
                                        },
                                      }))
                                    }
                                    className="h-10 w-full rounded-lg border border-white/10 bg-transparent"
                                  />
                                </label>
                                <label className="space-y-1 text-xs text-white/55">
                                  <span>Shadow Color</span>
                                  <input
                                    type="color"
                                    value={selectedSubtitleTrack.style?.shadowColor ?? "#000000"}
                                    onChange={(event) =>
                                      updateSubtitleTrack((subtitles) => ({
                                        ...subtitles,
                                        style: {
                                          ...subtitles.style,
                                          shadowColor: event.target.value,
                                        },
                                      }))
                                    }
                                    className="h-10 w-full rounded-lg border border-white/10 bg-transparent"
                                  />
                                </label>
                                <label className="space-y-1 text-xs text-white/55">
                                  <span>Background Color</span>
                                  <input
                                    type="color"
                                    value={selectedSubtitleTrack.style?.backgroundColor ?? "#111111"}
                                    onChange={(event) =>
                                      updateSubtitleTrack((subtitles) => ({
                                        ...subtitles,
                                        style: {
                                          ...subtitles.style,
                                          backgroundColor: event.target.value,
                                        },
                                      }))
                                    }
                                    className="h-10 w-full rounded-lg border border-white/10 bg-transparent"
                                  />
                                </label>
                              </div>
                              <label className="text-xs text-white/55">
                                Outline Width · {(selectedSubtitleTrack.style?.borderWidth ?? 12).toFixed(1)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={32}
                                step={0.1}
                                value={selectedSubtitleTrack.style?.borderWidth ?? 12}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    style: {
                                      ...subtitles.style,
                                      borderWidth: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">
                                Shadow Opacity · {Math.round((selectedSubtitleTrack.style?.shadowOpacity ?? 0.32) * 100)}%
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={selectedSubtitleTrack.style?.shadowOpacity ?? 0.32}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    style: {
                                      ...subtitles.style,
                                      shadowOpacity: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">
                                Shadow Distance · {(selectedSubtitleTrack.style?.shadowDistance ?? 2.2).toFixed(1)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={12}
                                step={0.1}
                                value={selectedSubtitleTrack.style?.shadowDistance ?? 2.2}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    style: {
                                      ...subtitles.style,
                                      shadowDistance: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-white/55">Background</div>
                                <Switch
                                  checked={selectedSubtitleTrack.style?.backgroundEnabled ?? false}
                                  onCheckedChange={(checked) =>
                                    updateSubtitleTrack((subtitles) => ({
                                      ...subtitles,
                                      style: {
                                        ...subtitles.style,
                                        backgroundEnabled: checked,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <label className="text-xs text-white/55">
                                Background Opacity · {Math.round((selectedSubtitleTrack.style?.backgroundOpacity ?? 0.72) * 100)}%
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={selectedSubtitleTrack.style?.backgroundOpacity ?? 0.72}
                                onChange={(event) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    style: {
                                      ...subtitles.style,
                                      backgroundOpacity: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <div className="mb-1 text-xs uppercase tracking-[0.24em] text-white/45">Text Case</div>
                              <Select
                                value={selectedSubtitleTrack.style?.textCase ?? "original"}
                                onValueChange={(value) =>
                                  updateSubtitleTrack((subtitles) => ({
                                    ...subtitles,
                                    style: {
                                      ...subtitles.style,
                                      textCase: value as "original" | "uppercase",
                                    },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white">
                                  <SelectValue placeholder="Text case" />
                                </SelectTrigger>
                                <SelectContent className="border-white/10 bg-slate-950 text-white">
                                  <SelectItem value="original">Original</SelectItem>
                                  <SelectItem value="uppercase">Uppercase</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ) : selectedOverlayItem ? (
                          <div className="space-y-2.5">
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className={EDITOR_LABEL_CLASS}>Motion Overlay</div>
                                  <div className="mt-2 text-lg font-semibold text-white">
                                    {getMotionOverlayPresetLabel(selectedOverlayItem.presetId)}
                                  </div>
                                  <div className="mt-1 text-sm text-white/50">
                                    Starts at {secondsToClock(selectedOverlayItem.startOffsetSeconds)} · lasts {secondsToClock(selectedOverlayItem.durationSeconds)}
                                  </div>
                                </div>
                                <div className="rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-violet-100">
                                  O1
                                </div>
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className={EDITOR_LABEL_CLASS}>Preset</div>
                                <SectionResetButton onClick={resetSelectedOverlayItem} />
                              </div>
                              <Select
                                value={selectedOverlayItem.presetId}
                                onValueChange={(value) => {
                                  if (
                                    value !== "waveform_line" &&
                                    value !== "equalizer_bars" &&
                                    value !== "pulse_ring" &&
                                    value !== "emoji_bounce" &&
                                    value !== "emoji_orbit" &&
                                    value !== "sparkle_drift"
                                  ) return;
                                  updateSelectedOverlayItem((item) => ({
                                    ...createDefaultTimelineOverlayItem({
                                      presetId: value as MotionOverlayPresetId,
                                      startOffsetSeconds: item.startOffsetSeconds,
                                      durationSeconds: item.durationSeconds,
                                    }),
                                    id: item.id,
                                    startOffsetSeconds: item.startOffsetSeconds,
                                    durationSeconds: item.durationSeconds,
                                  }));
                                }}
                              >
                                <SelectTrigger className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-white/10 bg-slate-950 text-white">
                                  {MOTION_OVERLAY_PRESETS.map((preset) => (
                                    <SelectItem key={preset.id} value={preset.id}>
                                      {preset.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="rounded-[0.9rem] border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/55">
                                {MOTION_OVERLAY_PRESETS.find((preset) => preset.id === selectedOverlayItem.presetId)?.description}
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Timing</div>
                              <label className="text-xs text-white/55">
                                Start · {secondsToClock(selectedOverlayItem.startOffsetSeconds)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(projectDuration, selectedOverlayItem.startOffsetSeconds + 8)}
                                step={0.01}
                                value={selectedOverlayItem.startOffsetSeconds}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    startOffsetSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">
                                Duration · {secondsToClock(selectedOverlayItem.durationSeconds)}
                              </label>
                              <input
                                type="range"
                                min={0.25}
                                max={Math.max(projectDuration, selectedOverlayItem.durationSeconds + 8)}
                                step={0.01}
                                value={selectedOverlayItem.durationSeconds}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    durationSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Placement</div>
                              <label className="text-xs text-white/55">Position X · {Math.round(selectedOverlayItem.positionXPercent)}%</label>
                              <input
                                type="range"
                                min={5}
                                max={95}
                                step={1}
                                value={selectedOverlayItem.positionXPercent}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    positionXPercent: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Position Y · {Math.round(selectedOverlayItem.positionYPercent)}%</label>
                              <input
                                type="range"
                                min={5}
                                max={95}
                                step={1}
                                value={selectedOverlayItem.positionYPercent}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    positionYPercent: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Width · {Math.round(selectedOverlayItem.widthPercent)}%</label>
                              <input
                                type="range"
                                min={8}
                                max={100}
                                step={1}
                                value={selectedOverlayItem.widthPercent}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    widthPercent: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Height · {Math.round(selectedOverlayItem.heightPercent)}%</label>
                              <input
                                type="range"
                                min={6}
                                max={100}
                                step={1}
                                value={selectedOverlayItem.heightPercent}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    heightPercent: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Scale · {selectedOverlayItem.scale.toFixed(2)}x</label>
                              <input
                                type="range"
                                min={0.4}
                                max={3}
                                step={0.01}
                                value={selectedOverlayItem.scale}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    scale: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Motion</div>
                              <label className="text-xs text-white/55">Opacity · {Math.round(selectedOverlayItem.opacity * 100)}%</label>
                              <input
                                type="range"
                                min={0.05}
                                max={1}
                                step={0.01}
                                value={selectedOverlayItem.opacity}
                                onChange={(event) =>
                                  updateSelectedOverlayItem((item) => ({
                                    ...item,
                                    opacity: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="space-y-1 text-xs text-white/55">
                                <span>Tint</span>
                                <input
                                  type="color"
                                  value={selectedOverlayItem.tintHex}
                                  onChange={(event) =>
                                    updateSelectedOverlayItem((item) => ({
                                      ...item,
                                      tintHex: event.target.value,
                                    }))
                                  }
                                  className="h-10 w-full rounded-lg border border-white/10 bg-transparent"
                                />
                              </label>
                              {selectedOverlayItem.behavior === "audio_reactive" ? (
                                <>
                                  <label className="text-xs text-white/55">Sensitivity · {selectedOverlayItem.sensitivity.toFixed(2)}x</label>
                                  <input
                                    type="range"
                                    min={0.2}
                                    max={3}
                                    step={0.01}
                                    value={selectedOverlayItem.sensitivity}
                                    onChange={(event) =>
                                      updateSelectedOverlayItem((item) => ({
                                        ...item,
                                        sensitivity: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                  <label className="text-xs text-white/55">Smoothing · {selectedOverlayItem.smoothing.toFixed(2)}</label>
                                  <input
                                    type="range"
                                    min={0}
                                    max={0.98}
                                    step={0.01}
                                    value={selectedOverlayItem.smoothing}
                                    onChange={(event) =>
                                      updateSelectedOverlayItem((item) => ({
                                        ...item,
                                        smoothing: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </>
                              ) : (
                                <>
                                  {(selectedOverlayItem.presetId === "emoji_bounce" || selectedOverlayItem.presetId === "emoji_orbit") ? (
                                    <label className="space-y-1 text-xs text-white/55">
                                      <span>Emoji</span>
                                      <Input
                                        value={selectedOverlayItem.emoji ?? ""}
                                        onChange={(event) =>
                                          updateSelectedOverlayItem((item) => ({
                                            ...item,
                                            emoji: event.target.value,
                                          }))
                                        }
                                        className="h-10 rounded-lg border-white/10 bg-white/[0.04] text-white"
                                      />
                                    </label>
                                  ) : null}
                                  <label className="text-xs text-white/55">Loop duration · {selectedOverlayItem.loopDurationSeconds.toFixed(2)}s</label>
                                  <input
                                    type="range"
                                    min={0.4}
                                    max={8}
                                    step={0.05}
                                    value={selectedOverlayItem.loopDurationSeconds}
                                    onChange={(event) =>
                                      updateSelectedOverlayItem((item) => ({
                                        ...item,
                                        loopDurationSeconds: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                  <label className="text-xs text-white/55">Motion amount · {selectedOverlayItem.motionAmount.toFixed(2)}</label>
                                  <input
                                    type="range"
                                    min={0.1}
                                    max={1.5}
                                    step={0.01}
                                    value={selectedOverlayItem.motionAmount}
                                    onChange={(event) =>
                                      updateSelectedOverlayItem((item) => ({
                                        ...item,
                                        motionAmount: Number(event.target.value),
                                      }))
                                    }
                                    className="w-full"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        ) : selectedImageItem && selectedImageAsset ? (
                          <div className="space-y-2.5">
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className={EDITOR_LABEL_CLASS}>Image Track</div>
                                  <div className="mt-2 text-lg font-semibold text-white">{selectedImageItem.label}</div>
                                  <div className="mt-1 text-sm text-white/50">
                                    {selectedImageAsset.filename} · full-length overlay
                                  </div>
                                </div>
                                <div className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-100">
                                  I1
                                </div>
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className={EDITOR_LABEL_CLASS}>Frame</div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={!selectedImageAsset?.width || !selectedImageAsset?.height}
                                    className="h-7 rounded-md px-2 text-[10px] uppercase tracking-[0.2em] text-white/46 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                    onClick={fitSelectedImageToFrame}
                                  >
                                    <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
                                    Fit To Frame
                                  </Button>
                                  <SectionResetButton onClick={resetSelectedImageFrame} />
                                </div>
                              </div>
                              <label className="text-xs text-white/55">Zoom · {selectedImageItem.canvas.zoom.toFixed(2)}x</label>
                              <input
                                type="range"
                                min={IMAGE_TRACK_MIN_ZOOM}
                                max={imageZoomSliderMax}
                                step={0.01}
                                value={selectedImageItem.canvas.zoom}
                                onChange={(event) =>
                                  updateSelectedImageItem((item) => ({
                                    ...item,
                                    canvas: {
                                      ...item.canvas,
                                      zoom: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              {selectedImageCoverZoom > 1 ? (
                                <div className="text-[11px] text-white/42">
                                  Fit To Frame centers the image and sets the minimum zoom needed to cover every edge.
                                </div>
                              ) : null}
                              <label className="text-xs text-white/55">Pan X · {Math.round(selectedImageItem.canvas.panX)}px</label>
                              <input
                                type="range"
                                min={-240}
                                max={240}
                                step={1}
                                value={selectedImageItem.canvas.panX}
                                onChange={(event) =>
                                  updateSelectedImageItem((item) => ({
                                    ...item,
                                    canvas: {
                                      ...item.canvas,
                                      panX: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Pan Y · {Math.round(selectedImageItem.canvas.panY)}px</label>
                              <input
                                type="range"
                                min={-240}
                                max={240}
                                step={1}
                                value={selectedImageItem.canvas.panY}
                                onChange={(event) =>
                                  updateSelectedImageItem((item) => ({
                                    ...item,
                                    canvas: {
                                      ...item.canvas,
                                      panY: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Coverage</div>
                              <div className="rounded-[0.9rem] border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/55">
                                This image automatically spans the full project duration, so it stays in sync as the rest of the timeline grows or shrinks.
                              </div>
                            </div>
                          </div>
                        ) : selectedAudioItem && selectedAudioAsset ? (
                          <div className="space-y-2.5">
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className={EDITOR_LABEL_CLASS}>Selected Audio Item</div>
                                  <div className="mt-2 text-lg font-semibold text-white">{selectedAudioAsset.filename}</div>
                                  <div className="mt-1 text-sm text-white/50">
                                    {secondsToClock(selectedAudioAsset.durationSeconds)} source · starts at {secondsToClock(selectedAudioItem.startOffsetSeconds)}
                                  </div>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="ghost"
                                      className="mt-0.5 rounded-md text-white/46 hover:bg-white/[0.06] hover:text-white"
                                      aria-label="Audio actions"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent>
                                    <DropdownMenuItem
                                      disabled={!selectedTrackActionState.canCloneToFill}
                                      onSelect={() => {
                                        cloneSelectedTimelineItemToFill();
                                      }}
                                    >
                                      <Copy className="h-4 w-4" />
                                      Clone to Fill Track
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={!selectedTrackActionState.canTrimToMatch}
                                      onSelect={() => {
                                        trimSelectedTimelineItemToMatchTrack();
                                      }}
                                    >
                                      <Scissors className="h-4 w-4" />
                                      Trim End to Match Other Track
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className={EDITOR_LABEL_CLASS}>Trim</div>
                                <SectionResetButton onClick={resetSelectedAudioTrim} />
                              </div>
                              <label className="text-xs uppercase tracking-[0.24em] text-white/45">
                                Trim Start · {secondsToClock(selectedAudioItem.trimStartSeconds)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(selectedAudioAsset.durationSeconds - 0.5, 0.5)}
                                step={0.01}
                                value={selectedAudioItem.trimStartSeconds}
                                onChange={(event) =>
                                  updateSelectedAudioItem((item) => ({
                                    ...item,
                                    trimStartSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs uppercase tracking-[0.24em] text-white/45">
                                Trim End · {secondsToClock(selectedAudioItem.trimEndSeconds)}
                              </label>
                              <input
                                type="range"
                                min={Math.min(selectedAudioItem.trimStartSeconds + 0.5, selectedAudioAsset.durationSeconds)}
                                max={selectedAudioAsset.durationSeconds}
                                step={0.01}
                                value={selectedAudioItem.trimEndSeconds}
                                onChange={(event) =>
                                  updateSelectedAudioItem((item) => ({
                                    ...item,
                                    trimEndSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <div className={EDITOR_LABEL_CLASS}>Track Audio</div>
                                  <SectionResetButton onClick={resetSelectedAudioTrack} />
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 rounded-lg px-2 text-white/60 hover:bg-white/[0.06] hover:text-white"
                                  onClick={() =>
                                    updateSelectedAudioItem((item) => ({
                                      ...item,
                                      muted: !item.muted,
                                    }))
                                  }
                                >
                                  {selectedAudioItem.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </Button>
                              </div>
                              <label className="text-xs text-white/55">
                                Offset · {secondsToClock(selectedAudioItem.startOffsetSeconds)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(projectDuration, selectedAudioItem.startOffsetSeconds + 12)}
                                step={0.01}
                                value={selectedAudioItem.startOffsetSeconds}
                                onChange={(event) =>
                                  updateSelectedAudioItem((item) => ({
                                    ...item,
                                    startOffsetSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">
                                Volume · {Math.round(selectedAudioItem.volume * 100)}%
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={selectedAudioItem.volume}
                                onChange={(event) =>
                                  updateSelectedAudioItem((item) => ({
                                    ...item,
                                    volume: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-[0.95rem] border border-dashed border-white/10 bg-black/20 p-5 text-sm text-white/45">
                            Select a timeline item to edit it here. Video clips expose trim/audio tools, subtitles control the global burn-in track, audio keeps its track controls, and image items let you frame the full-length overlay.
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </section>

          <Card className="h-full gap-0 overflow-hidden rounded-none border-none bg-[linear-gradient(180deg,rgba(10,13,18,0.99),rgba(5,7,10,0.99))] py-0 text-white shadow-none">
            <CardContent className="flex h-full min-h-0 flex-col gap-0 p-0">
              <div className="flex flex-col gap-1.5 border-b border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.006))] px-2.5 py-1.5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={EDITOR_TIMECODE_CLASS}>{visibleWindowLabel}</div>
                  {selectedTimelineLabel ? (
                    <div
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]",
                        selectedItem?.kind === "audio"
                          ? "border border-amber-300/16 bg-amber-300/8 text-amber-100/80"
                          : selectedItem?.kind === "overlay"
                            ? "border border-violet-300/18 bg-violet-300/10 text-violet-100/80"
                          : selectedItem?.kind === "image"
                            ? "border border-emerald-300/18 bg-emerald-300/10 text-emerald-100/80"
                          : selectedItem?.kind === "subtitle"
                            ? "border border-fuchsia-300/18 bg-fuchsia-300/10 text-fuchsia-100/80"
                          : "border border-cyan-400/16 bg-cyan-400/8 text-cyan-100/80"
                      )}
                    >
                      {selectedTimelineLabel}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center gap-2 rounded-[0.8rem] border border-white/8 bg-black/22 px-2.5 py-1">
                    <span className={EDITOR_LABEL_CLASS}>Zoom</span>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.1}
                      value={project.timeline.zoomLevel}
                      onChange={(event) =>
                        updateProject((current) => ({
                          ...current,
                          timeline: {
                            ...current.timeline,
                            zoomLevel: Number(event.target.value),
                          },
                        }))
                      }
                      className="w-24 accent-cyan-400"
                    />
                    <span className={EDITOR_TIMECODE_CLASS}>{project.timeline.zoomLevel.toFixed(1)}x</span>
                    <Button
                      variant="ghost"
                      className="h-6 rounded-md px-2 text-[10px] text-white/52 hover:bg-white/[0.06] hover:text-white"
                      onClick={() =>
                        updateProject((current) => ({
                          ...current,
                          timeline: {
                            ...current.timeline,
                            zoomLevel: 1,
                          },
                        }))
                      }
                    >
                      Fit
                    </Button>
                  </div>
                  <div className="flex items-center gap-1 rounded-[0.8rem] border border-white/8 bg-black/22 p-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-7 rounded-[0.65rem] px-2.5 text-[11px] text-white/72 hover:bg-white/[0.08] hover:text-white"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Overlay
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {MOTION_OVERLAY_PRESETS.map((preset) => (
                          <DropdownMenuItem
                            key={preset.id}
                            onSelect={() => {
                              addReactiveOverlayToTimeline(preset.id);
                            }}
                          >
                            <Plus className="h-4 w-4" />
                            {preset.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      className="h-7 rounded-[0.65rem] px-2.5 text-[11px] text-white/72 hover:bg-white/[0.08] hover:text-white"
                      disabled={!selectedClip}
                      onClick={splitSelectedTimelineClip}
                    >
                      <Split className="mr-2 h-4 w-4" />
                      Split
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-7 rounded-[0.65rem] px-2.5 text-[11px] text-white/48 hover:bg-red-500/10 hover:text-red-100"
                      disabled={!selectedItem}
                      onClick={removeSelectedTimelineItem}
                    >
                      <Scissors className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[84px_minmax(0,1fr)] overflow-hidden bg-[linear-gradient(180deg,rgba(8,11,16,0.98),rgba(4,7,12,0.98))]">
                <div className="grid min-h-0 grid-rows-[38px_88px_minmax(0,1fr)_78px_84px_96px] border-r border-white/6 bg-[linear-gradient(180deg,rgba(11,14,19,0.98),rgba(7,10,14,0.98))]">
                  <div className={cn(EDITOR_LABEL_CLASS, "flex items-center px-3")}>Time</div>
                  <div className="flex flex-col justify-center gap-2 border-b border-white/6 px-3">
                    <div className="font-mono text-sm font-semibold text-emerald-100">I1</div>
                    <div className="text-[11px] text-white/38">
                      {project.timeline.imageItems.length ? "Full image track" : "Image lane"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!selectedImageItem}
                        className="h-6 w-6 rounded-md text-white/34 hover:bg-white/[0.06] hover:text-white disabled:opacity-20"
                        onClick={resetSelectedImageFrame}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!selectedImageItem}
                        className="h-6 w-6 rounded-md text-white/30 hover:bg-red-500/10 hover:text-red-100 disabled:opacity-20"
                        onClick={removeSelectedTimelineItem}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center gap-2 border-b border-white/6 px-3">
                    <div className="font-mono text-sm font-semibold text-cyan-100">V1</div>
                    <div className="text-[11px] text-white/38">Video lane</div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!selectedClip}
                        className="h-6 w-6 rounded-md text-white/34 hover:bg-white/[0.06] hover:text-white disabled:opacity-20"
                        onClick={() =>
                          updateInspectorClip((clip) => ({
                            ...clip,
                            muted: !clip.muted,
                          }))
                        }
                      >
                        {selectedClip?.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center gap-2 border-b border-white/6 px-3">
                    <div className="font-mono text-sm font-semibold text-violet-100">O1</div>
                    <div className="text-[11px] text-white/38">{project.timeline.overlayItems.length} motion</div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!project.timeline.overlayItems.length}
                        className="h-6 w-6 rounded-md text-white/34 hover:bg-white/[0.06] hover:text-white disabled:opacity-20"
                        onClick={() => {
                          const firstOverlay = project.timeline.overlayItems[0];
                          if (!firstOverlay) return;
                          focusTimelineSelection({ kind: "overlay", id: firstOverlay.id }, firstOverlay.startOffsetSeconds);
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!selectedOverlayItem}
                        className="h-6 w-6 rounded-md text-white/30 hover:bg-red-500/10 hover:text-red-100 disabled:opacity-20"
                        onClick={removeSelectedTimelineItem}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center gap-2 border-b border-white/6 px-3">
                    <div className="font-mono text-sm font-semibold text-fuchsia-100">S1</div>
                    <div className="text-[11px] text-white/38">
                      {subtitleTrackAvailable ? project.subtitles.label ?? `${subtitleTrackTimeline.length} cues` : "Subtitle lane"}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!subtitleTrackAvailable}
                        className="h-6 w-6 rounded-md text-white/34 hover:bg-white/[0.06] hover:text-white disabled:opacity-20"
                        onClick={() => focusTimelineSelection({ kind: "subtitle", id: EDITOR_SUBTITLE_TRACK_ID })}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!subtitleTrackAvailable}
                        className="h-6 w-6 rounded-md text-white/30 hover:bg-red-500/10 hover:text-red-100 disabled:opacity-20"
                        onClick={clearProjectSubtitleTrack}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center gap-2 px-3">
                    <div className="font-mono text-sm font-semibold text-amber-100">A1</div>
                    <div className="text-[11px] text-white/38">{project.timeline.audioItems.length} items</div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!selectedAudioItem}
                        className="h-6 w-6 rounded-md text-white/34 hover:bg-white/[0.06] hover:text-white disabled:opacity-20"
                        onClick={() =>
                          updateSelectedAudioItem((item) => ({
                            ...item,
                            muted: !item.muted,
                          }))
                        }
                      >
                        {selectedAudioItem?.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!selectedAudioItem}
                        className="h-6 w-6 rounded-md text-white/30 hover:bg-red-500/10 hover:text-red-100 disabled:opacity-20"
                        onClick={removeSelectedTimelineItem}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div ref={timelineViewportRef} className="relative min-h-0 overflow-hidden">
                  <div
                    className="absolute inset-y-0 z-30 w-4 -translate-x-1/2 cursor-ew-resize touch-none"
                    style={{ left: `${playheadPct}%` }}
                    onPointerDown={beginPlayheadDrag}
                  >
                    <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-red-400/90 shadow-[0_0_22px_rgba(248,113,113,0.5)]" />
                    <div className="pointer-events-none absolute left-1/2 top-0 h-4 w-[10px] -translate-x-1/2 rounded-b-full border border-red-300/40 bg-red-400/90 shadow-[0_4px_12px_rgba(248,113,113,0.4)]" />
                  </div>

                  <div className="grid h-full min-h-0 grid-rows-[38px_88px_minmax(0,1fr)_78px_84px_96px]">
                    <div
                      className="relative overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.028),rgba(255,255,255,0.01))]"
                      onClick={seekVisibleTimeline}
                    >
                      {timelineMinorTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`minor-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/5"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}
                      {timelineTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={second}
                            className="absolute inset-y-0"
                            style={{ left: `${tickLeft}%` }}
                          >
                            <div className="absolute inset-y-0 w-px bg-white/14" />
                            <div className="absolute left-2 top-2 font-mono text-[10px] tracking-[0.16em] text-white/36">
                              {secondsToClock(second)}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div
                      className={cn(
                        "relative overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.008))]",
                        draggingAssetKind === "image" ? "bg-emerald-300/[0.05]" : ""
                      )}
                      onClick={seekVisibleTimeline}
                      onDragOver={(event) => {
                        if (dragAssetKindRef.current !== "image") return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (dragAssetKindRef.current !== "image") return;
                        event.preventDefault();
                        const draggedAssetId = dragAssetIdRef.current;
                        if (!draggedAssetId) return;
                        const draggedAsset = assetMap.get(draggedAssetId);
                        if (draggedAsset?.kind === "image") {
                          setImageAssetOnTimeline(draggedAsset);
                        }
                        clearTimelineDragState();
                      }}
                    >
                      {timelineMinorTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`image-minor-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.03]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}
                      {timelineTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`image-grid-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.05]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}

                      {visibleImagePlacements.length > 0 ? (
                        visibleImagePlacements.map((placement) => {
                          const itemAsset = assetMap.get(placement.item.assetId);
                          const isSelected = selectedItem?.kind === "image" && selectedItem.id === placement.item.id;
                          return (
                            <button
                              key={placement.item.id}
                              type="button"
                              className={cn(
                                "absolute top-1/2 h-[68%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                                isSelected
                                  ? "border-white/80 bg-[linear-gradient(180deg,rgba(17,94,89,0.88),rgba(7,54,51,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(255,255,255,0.22),0_0_20px_rgba(16,185,129,0.1)]"
                                  : "border-emerald-300/24 bg-[linear-gradient(180deg,rgba(14,94,75,0.78),rgba(7,54,45,0.9))] shadow-[inset_0_1px_0_rgba(110,231,183,0.12)] hover:border-emerald-200/40 hover:bg-[linear-gradient(180deg,rgba(18,110,86,0.8),rgba(10,62,50,0.92))]"
                              )}
                              style={{
                                left: `${placement.leftPct}%`,
                                width: `${placement.widthPct}%`,
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                focusTimelineSelection({ kind: "image", id: placement.item.id }, placement.startSeconds);
                              }}
                            >
                              <div className="pointer-events-none flex h-full flex-col justify-between">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="truncate text-sm font-medium text-emerald-50">
                                    {placement.item.label}
                                  </div>
                                  <span className="font-mono text-[11px] text-emerald-100/60">
                                    {secondsToClock(placement.durationSeconds)}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-emerald-50/60">
                                  <span className="truncate">{itemAsset?.filename ?? "Image overlay"}</span>
                                  <span className="font-mono">Full track</span>
                                </div>
                                <div className="mt-2 h-7 rounded-[0.65rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.24)_0,rgba(255,255,255,0.24)_5px,transparent_5px,transparent_12px)] opacity-85" />
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="absolute left-[4%] top-1/2 w-[32%] min-w-[220px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-emerald-300/16 bg-emerald-300/[0.035] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Image lane empty</div>
                          <div className="mt-2 text-sm text-white/56">Drag an image here to cover the full project length.</div>
                        </div>
                      )}
                    </div>

                    <div
                      className={cn(
                        "relative overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.01))]",
                        draggingAssetKind === "video" ? "bg-cyan-400/[0.035]" : ""
                      )}
                      onClick={seekVisibleTimeline}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragAssetKindRef.current === "video") {
                          setDropTargetIndex(visibleVideoBlocks.length);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedAssetId = dragAssetIdRef.current;
                        const draggedAssetKind = dragAssetKindRef.current;
                        if (draggedAssetId && draggedAssetKind === "video") {
                          const draggedAsset = assetMap.get(draggedAssetId);
                          if (draggedAsset?.kind === "video") {
                            insertVideoAssetAtTimelineIndex(draggedAsset, project.timeline.videoClips.length);
                          }
                          clearTimelineDragState();
                          return;
                        }
                        const draggedBlock = dragVideoBlockRef.current;
                        if (!draggedBlock) return;
                        updateProject((current) => {
                          const nextTimeline = reorderTimelineVideoBlock(
                            current.timeline.videoClips,
                            current.timeline.videoClipGroups,
                            draggedBlock,
                            getTimelineVideoBlockPlacements(
                              current.timeline.videoClips,
                              current.timeline.videoClipGroups
                            ).length - 1
                          );
                          return {
                            ...current,
                            timeline: {
                              ...current.timeline,
                              videoClips: nextTimeline.videoClips,
                              videoClipGroups: nextTimeline.videoClipGroups,
                            },
                          };
                        });
                        clearTimelineDragState();
                      }}
                    >
                      {timelineMinorTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`video-minor-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.035]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}
                      {timelineTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`video-grid-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.06]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}

                      {dropIndicatorPct != null ? (
                        <div
                          className="pointer-events-none absolute inset-y-2 z-20 w-[2px] bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.5)]"
                          style={{ left: `${dropIndicatorPct}%` }}
                        />
                      ) : null}

                      {clipPlacements.length === 0 ? (
                        <div className="absolute left-[4%] top-1/2 w-[28%] min-w-[200px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-white/14 bg-white/[0.02] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Video lane empty</div>
                          <div className="mt-2 text-sm text-white/56">Drag clips from the media bin to start cutting.</div>
                        </div>
                      ) : visibleVideoBlocks.length === 0 ? (
                        <div className="absolute left-[4%] top-1/2 w-[30%] min-w-[240px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-cyan-300/14 bg-cyan-300/[0.035] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Sequence outside view</div>
                          <div className="mt-2 text-sm text-white/56">Move the playhead or reduce zoom to bring clips back into frame.</div>
                        </div>
                      ) : null}

                      {visibleVideoBlocks.map((block, index) => {
                        const isPrimarySelected =
                          (selectedItem?.kind === "video" && block.kind === "clip" && selectedItem.id === block.clip.id) ||
                          (selectedItem?.kind === "video-group" && block.kind === "group" && selectedItem.id === block.group.id);
                        const isSelected =
                          isPrimarySelected || (block.kind === "clip" && selectedVideoClipSet.has(block.clip.id));
                        const isDragging = draggingVideoBlockId === block.id;
                        const isDropTarget = dropTargetIndex === index && draggingVideoBlockId !== block.id;
                        const blockSelection = getTimelineSelectionForVideoBlock(block);
                        const blockActionState = getTimelineTrackActionState(blockSelection);
                        return (
                          <ContextMenu key={block.id}>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                draggable
                                onContextMenu={() => {
                                  focusTimelineSelection(blockSelection);
                                }}
                                onDragStart={() => {
                                  dragVideoBlockRef.current = { id: block.id, kind: block.kind };
                                  dragAssetIdRef.current = null;
                                  dragAssetKindRef.current = null;
                                  setDraggingVideoBlockId(block.id);
                                  setDraggingAssetId(null);
                                  setDraggingAssetKind(null);
                                  setDropTargetIndex(index);
                                }}
                                onDragEnd={() => {
                                  clearTimelineDragState();
                                }}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (dragAssetKindRef.current === "video" || dragVideoBlockRef.current) {
                                    setDropTargetIndex(index);
                                  }
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const draggedAssetId = dragAssetIdRef.current;
                                  const draggedAssetKind = dragAssetKindRef.current;
                                  if (draggedAssetId && draggedAssetKind === "video") {
                                    const draggedAsset = assetMap.get(draggedAssetId);
                                    if (draggedAsset?.kind === "video") {
                                      insertVideoAssetAtTimelineIndex(
                                        draggedAsset,
                                        block.kind === "group" ? block.clipPlacements[0]?.index ?? project.timeline.videoClips.length : block.clipPlacement.index
                                      );
                                    }
                                    clearTimelineDragState();
                                    return;
                                  }
                                  const draggedBlock = dragVideoBlockRef.current;
                                  if (!draggedBlock) return;
                                  updateProject((current) => {
                                    const nextTimeline = reorderTimelineVideoBlock(
                                      current.timeline.videoClips,
                                      current.timeline.videoClipGroups,
                                      draggedBlock,
                                      block.index
                                    );
                                    return {
                                      ...current,
                                      timeline: {
                                        ...current.timeline,
                                        videoClips: nextTimeline.videoClips,
                                        videoClipGroups: nextTimeline.videoClipGroups,
                                      },
                                    };
                                  });
                                  clearTimelineDragState();
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const isJoinSelectionClick =
                                    block.kind === "clip" &&
                                    inspectorVideoTab === "join" &&
                                    selectedItem?.kind === "video" &&
                                    selectedItem.id !== block.clip.id;
                                  focusTimelineSelection(
                                    blockSelection,
                                    block.startSeconds,
                                    {
                                      extendVideoSelection:
                                        block.kind === "clip" &&
                                        (event.metaKey || event.ctrlKey || event.shiftKey || isJoinSelectionClick),
                                    }
                                  );
                                }}
                                className={cn(
                                  "absolute top-1/2 h-[82%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                                  isPrimarySelected
                                    ? "border-white/80 bg-[linear-gradient(180deg,rgba(52,58,68,0.92),rgba(18,22,29,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_1px_rgba(255,255,255,0.24),0_0_24px_rgba(255,255,255,0.1)]"
                                    : isSelected
                                      ? "border-white/55 bg-[linear-gradient(180deg,rgba(40,45,54,0.9),rgba(16,20,27,0.96))] shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_0_18px_rgba(255,255,255,0.06)]"
                                      : "border-white/10 bg-[linear-gradient(180deg,rgba(28,33,42,0.9),rgba(14,17,23,0.96))] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(34,40,50,0.92),rgba(17,20,28,0.96))]",
                                  isDragging ? "scale-[0.985] opacity-60" : "",
                                  isDropTarget ? "shadow-[0_0_0_1px_rgba(103,232,249,0.18)]" : "",
                                  "cursor-grab active:cursor-grabbing"
                                )}
                                style={{
                                  left: `${block.leftPct}%`,
                                  width: `${block.widthPct}%`,
                                }}
                              >
                                <div className="pointer-events-none absolute inset-y-2 left-1.5 w-[4px] rounded-full bg-white/18" />
                                <div className="pointer-events-none absolute inset-y-2 right-1.5 w-[4px] rounded-full bg-white/10" />
                                {block.kind === "group"
                                  ? block.clipPlacements.slice(0, -1).map((clipPlacement) => {
                                      const dividerPct =
                                        ((clipPlacement.endSeconds - block.startSeconds) / Math.max(block.durationSeconds, 0.001)) * 100;
                                      return (
                                        <div
                                          key={`${block.id}-${clipPlacement.clip.id}-divider`}
                                          className="pointer-events-none absolute inset-y-2 z-10 w-px bg-white/14"
                                          style={{ left: `calc(${dividerPct}% - 0.5px)` }}
                                        />
                                      );
                                    })
                                  : null}
                                <div className="pointer-events-none flex h-full flex-col justify-between pl-2">
                                  <div>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="truncate text-sm font-medium text-white">
                                        {block.kind === "group" ? block.group.label : block.clip.label}
                                      </div>
                                      {block.kind === "group" ? (
                                        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.22em] text-amber-100">
                                          Join
                                        </span>
                                      ) : block.clip.actions.reverse ? (
                                        <span className="rounded-full border border-cyan-300/22 bg-cyan-300/12 px-2 py-0.5 text-[9px] uppercase tracking-[0.22em] text-cyan-100">
                                          Rev
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/44">
                                      <span className="truncate">
                                        {block.kind === "group"
                                          ? `${block.clipPlacements.length} clips joined`
                                          : block.clip.muted
                                            ? "Muted clip audio"
                                            : "Clip audio on"}
                                      </span>
                                      <span className="font-mono">{secondsToClock(block.durationSeconds)}</span>
                                    </div>
                                  </div>
                                  <div className="mt-3 space-y-1.5">
                                    {block.kind === "group" ? (
                                      <>
                                        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${block.clipPlacements.length}, minmax(0, 1fr))` }}>
                                          {block.clipPlacements.map((clipPlacement) => (
                                            <div
                                              key={`${block.id}-${clipPlacement.clip.id}-label`}
                                              className="truncate rounded-[0.65rem] border border-white/8 bg-white/[0.035] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/50"
                                            >
                                              {clipPlacement.clip.label}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="relative h-5 overflow-hidden rounded-[0.6rem] bg-black/25">
                                          {block.clipPlacements.map((clipPlacement, clipIndex) => {
                                            const leftPct =
                                              ((clipPlacement.startSeconds - block.startSeconds) / Math.max(block.durationSeconds, 0.001)) * 100;
                                            const widthPct =
                                              (clipPlacement.durationSeconds / Math.max(block.durationSeconds, 0.001)) * 100;
                                            return (
                                              <div
                                                key={`${block.id}-${clipPlacement.clip.id}-segment`}
                                                className={cn(
                                                  "absolute inset-y-0 border-r border-white/10",
                                                  clipIndex % 2 === 0
                                                    ? "bg-[repeating-linear-gradient(90deg,rgba(251,191,36,0.32)_0,rgba(251,191,36,0.32)_8px,rgba(12,18,25,0.16)_8px,rgba(12,18,25,0.16)_14px)]"
                                                    : "bg-[repeating-linear-gradient(90deg,rgba(56,189,248,0.32)_0,rgba(56,189,248,0.32)_8px,rgba(12,18,25,0.16)_8px,rgba(12,18,25,0.16)_14px)]"
                                                )}
                                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                              />
                                            );
                                          })}
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="h-8 rounded-[0.7rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))]" />
                                        <div className="h-5 rounded-[0.6rem] bg-[repeating-linear-gradient(90deg,rgba(56,189,248,0.34)_0,rgba(56,189,248,0.34)_8px,rgba(12,18,25,0.16)_8px,rgba(12,18,25,0.16)_14px)]" />
                                      </>
                                    )}
                                  </div>
                                </div>
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                disabled={!blockActionState.canCloneToFill}
                                onSelect={() => {
                                  cloneTimelineSelectionToFill(blockSelection);
                                }}
                              >
                                <Copy className="h-4 w-4" />
                                Clone to Fill Track
                              </ContextMenuItem>
                              <ContextMenuItem
                                disabled={!blockActionState.canTrimToMatch}
                                onSelect={() => {
                                  trimTimelineSelectionToMatchTrack(blockSelection);
                                }}
                              >
                                <Scissors className="h-4 w-4" />
                                Trim End to Match Other Track
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>

                    <div
                      className="relative overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.008))]"
                      onClick={seekVisibleTimeline}
                    >
                      {timelineMinorTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`overlay-minor-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.03]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}
                      {timelineTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`overlay-grid-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.05]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}

                      {visibleOverlayPlacements.length > 0 ? (
                        visibleOverlayPlacements.map((placement) => {
                          const isSelected = selectedItem?.kind === "overlay" && selectedItem.id === placement.item.id;
                          return (
                            <button
                              key={placement.item.id}
                              type="button"
                              className={cn(
                                "absolute top-1/2 h-[64%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                                isSelected
                                  ? "border-white/80 bg-[linear-gradient(180deg,rgba(76,29,149,0.88),rgba(49,18,107,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(255,255,255,0.22),0_0_20px_rgba(196,181,253,0.08)]"
                                  : "border-violet-300/24 bg-[linear-gradient(180deg,rgba(91,33,182,0.78),rgba(59,16,110,0.92))] hover:border-violet-200/40 hover:bg-[linear-gradient(180deg,rgba(109,40,217,0.84),rgba(67,19,124,0.94))]"
                              )}
                              style={{
                                left: `${placement.leftPct}%`,
                                width: `${Math.max(placement.widthPct, 1.2)}%`,
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                focusTimelineSelection({ kind: "overlay", id: placement.item.id }, placement.startSeconds);
                              }}
                            >
                              <div className="pointer-events-none flex h-full items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-violet-50">
                                    {getMotionOverlayPresetLabel(placement.item.presetId)}
                                  </div>
                                  <div className="mt-1 truncate text-[11px] text-violet-100/65">
                                    {secondsToClock(placement.durationSeconds)} · {Math.round(placement.item.opacity * 100)}% opacity
                                  </div>
                                </div>
                                <div className="h-6 w-16 rounded-[0.6rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_4px,transparent_4px,transparent_9px)] opacity-80" />
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="absolute left-[4%] top-1/2 w-[30%] min-w-[240px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-violet-300/16 bg-violet-300/[0.035] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Reactive overlay lane</div>
                          <div className="mt-2 text-sm text-white/56">Use “Add Overlay” to place animated presets above the visuals.</div>
                        </div>
                      )}
                    </div>

                    <div
                      className="relative overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.008))]"
                      onClick={(event) => {
                        seekVisibleTimeline(event);
                        if (subtitleTrackAvailable) {
                          focusTimelineSelection({ kind: "subtitle", id: EDITOR_SUBTITLE_TRACK_ID });
                        }
                      }}
                    >
                      {timelineMinorTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`subtitle-minor-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.03]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}
                      {timelineTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`subtitle-grid-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.05]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}

                      {subtitleTrackAvailable && visibleSubtitleTrackBlock ? (
                        <button
                          type="button"
                          className={cn(
                            "absolute top-1/2 h-[68%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                            selectedItem?.kind === "subtitle"
                              ? "border-white/80 bg-[linear-gradient(180deg,rgba(116,54,146,0.92),rgba(64,26,84,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(255,255,255,0.24),0_0_20px_rgba(216,180,254,0.08)]"
                              : "border-fuchsia-300/24 bg-[linear-gradient(180deg,rgba(110,49,138,0.82),rgba(58,22,74,0.92))] hover:border-fuchsia-200/40 hover:bg-[linear-gradient(180deg,rgba(122,57,153,0.84),rgba(67,26,86,0.94))]"
                          )}
                          style={{
                            left: `${visibleSubtitleTrackBlock.leftPct}%`,
                            width: `${visibleSubtitleTrackBlock.widthPct}%`,
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            focusTimelineSelection({ kind: "subtitle", id: EDITOR_SUBTITLE_TRACK_ID });
                          }}
                        >
                          <div className="pointer-events-none flex h-full flex-col justify-between">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-sm font-medium text-fuchsia-50">
                                {project.subtitles.label ?? "Subtitle track"}
                              </div>
                              <span className="font-mono text-[11px] text-fuchsia-100/60">
                                {secondsToClock(subtitleTrackDuration)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-fuchsia-50/65">
                              <span className="truncate">
                                {project.subtitles.enabled ? `${subtitleTrackTimeline.length} cues` : "Disabled on export"}
                              </span>
                              <span className="font-mono">
                                {project.subtitles.language?.toUpperCase() ?? "SRT"}
                              </span>
                            </div>
                            <div className="relative mt-2 h-6 overflow-hidden rounded-[0.65rem] bg-black/25">
                              {visibleSubtitleChunks.map((entry, index) => (
                                <div
                                  key={`${entry.index}-${entry.chunk.timestamp?.[0] ?? index}`}
                                  className={cn(
                                    "absolute inset-y-0 rounded-[0.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(244,114,182,0.34),rgba(217,70,239,0.2))]",
                                    index % 2 === 0 ? "opacity-95" : "opacity-75"
                                  )}
                                  style={{
                                    left: `${entry.leftPct}%`,
                                    width: `${Math.max(entry.widthPct, 0.8)}%`,
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        </button>
                      ) : subtitleTrackAvailable ? (
                        <div className="absolute left-[4%] top-1/2 w-[30%] min-w-[240px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-fuchsia-300/16 bg-fuchsia-300/[0.035] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Subtitle outside view</div>
                          <div className="mt-2 text-sm text-white/56">Move the playhead or reduce zoom to bring subtitle cues into view.</div>
                        </div>
                      ) : (
                        <div className="absolute left-[4%] top-1/2 flex min-w-[260px] -translate-y-1/2 items-center gap-2 rounded-[0.95rem] border border-dashed border-white/12 bg-white/[0.018] px-4 py-3 text-left">
                          <div className="min-w-0 flex-1">
                            <div className={EDITOR_LABEL_CLASS}>Subtitle lane empty</div>
                            <div className="mt-2 text-sm text-white/56">Load a subtitle track from history or upload an SRT.</div>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-lg border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setIsSubtitleHistoryDialogOpen(true);
                              }}
                            >
                              History
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-lg border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                              onClick={(event) => {
                                event.stopPropagation();
                                srtInputRef.current?.click();
                              }}
                            >
                              Upload SRT
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div
                      className={cn(
                        "relative overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.014),rgba(255,255,255,0.008))]",
                        draggingAssetKind === "audio" ? "bg-amber-300/[0.04]" : ""
                      )}
                      onClick={seekVisibleTimeline}
                      onDragOver={(event) => {
                        if (dragAssetKindRef.current !== "audio") return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (dragAssetKindRef.current !== "audio") return;
                        event.preventDefault();
                        const draggedAssetId = dragAssetIdRef.current;
                        if (!draggedAssetId) return;
                        const draggedAsset = assetMap.get(draggedAssetId);
                        if (draggedAsset?.kind === "audio") {
                          appendAudioAssetToTimeline(draggedAsset);
                        }
                        clearTimelineDragState();
                      }}
                    >
                      {timelineMinorTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`audio-minor-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.035]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}
                      {timelineTicks.map((second) => {
                        const tickLeft = ((second - visibleStart) / visibleDuration) * 100;
                        return (
                          <div
                            key={`audio-grid-${second}`}
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/[0.06]"
                            style={{ left: `${tickLeft}%` }}
                          />
                        );
                      })}

                      {visibleAudioPlacements.length > 0 ? (
                        visibleAudioPlacements.map((placement) => {
                          const itemAsset = assetMap.get(placement.item.assetId);
                          const isSelected = selectedItem?.kind === "audio" && selectedItem.id === placement.item.id;
                          const audioSelection: TimelineSelection = { kind: "audio", id: placement.item.id };
                          const audioActionState = getTimelineTrackActionState(audioSelection);
                          return (
                            <ContextMenu key={placement.item.id}>
                              <ContextMenuTrigger asChild>
                                <button
                                  type="button"
                                  onContextMenu={() => {
                                    focusTimelineSelection(audioSelection);
                                  }}
                                  className={cn(
                                    "absolute top-1/2 h-[68%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                                    isSelected
                                      ? "border-white/80 bg-[linear-gradient(180deg,rgba(84,67,32,0.88),rgba(42,31,12,0.94))] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(255,255,255,0.22),0_0_20px_rgba(255,255,255,0.08)]"
                                      : "border-amber-300/28 bg-[linear-gradient(180deg,rgba(90,61,12,0.78),rgba(47,31,8,0.9))] shadow-[inset_0_1px_0_rgba(253,224,71,0.12)] hover:border-amber-200/40 hover:bg-[linear-gradient(180deg,rgba(104,69,15,0.8),rgba(58,37,10,0.92))]"
                                  )}
                                  style={{
                                    left: `${placement.leftPct}%`,
                                    width: `${placement.widthPct}%`,
                                  }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    focusTimelineSelection(audioSelection, placement.startSeconds);
                                  }}
                                >
                                  <div className="pointer-events-none flex h-full flex-col justify-between">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="truncate text-sm font-medium text-amber-50">
                                        {itemAsset?.filename ?? "Audio item"}
                                      </div>
                                      <span className="font-mono text-[11px] text-amber-100/55">
                                        {secondsToClock(placement.durationSeconds)}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-amber-50/60">
                                      <span className="truncate">{placement.item.muted ? "Muted track" : "Track audio on"}</span>
                                      <span className="font-mono">{secondsToClock(placement.startSeconds)}</span>
                                    </div>
                                    <div className="mt-2 h-7 rounded-[0.65rem] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.28)_0,rgba(255,255,255,0.28)_2px,transparent_2px,transparent_7px)] opacity-85" />
                                  </div>
                                </button>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem
                                  disabled={!audioActionState.canCloneToFill}
                                  onSelect={() => {
                                    cloneTimelineSelectionToFill(audioSelection);
                                  }}
                                >
                                  <Copy className="h-4 w-4" />
                                  Clone to Fill Track
                                </ContextMenuItem>
                                <ContextMenuItem
                                  disabled={!audioActionState.canTrimToMatch}
                                  onSelect={() => {
                                    trimTimelineSelectionToMatchTrack(audioSelection);
                                  }}
                                >
                                  <Scissors className="h-4 w-4" />
                                  Trim End to Match Other Track
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })
                      ) : project.timeline.audioItems.length ? (
                        <div className="absolute left-[4%] top-1/2 w-[30%] min-w-[240px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-amber-300/14 bg-amber-300/[0.035] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Audio outside view</div>
                          <div className="mt-2 text-sm text-white/56">Move the playhead or reduce zoom to bring the track items back into view.</div>
                        </div>
                      ) : (
                        <div className="absolute left-[4%] top-1/2 w-[28%] min-w-[220px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-white/12 bg-white/[0.018] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Audio lane empty</div>
                          <div className="mt-2 text-sm text-white/56">Drag audio from the media bin to build the A1 track.</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <ExportSettingsDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        resolution={exportResolution}
        destinationName={exportDestination?.name}
        canUseSavePicker={isSavePickerSupported}
        isPickingDestination={isPickingExportDestination}
        isSubmitting={isExporting}
        blockingReasons={exportBlockingReasons}
        onResolutionChange={handleExportResolutionChange}
        onPickDestination={handlePickExportDestination}
        onConfirm={handleExport}
      />
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
