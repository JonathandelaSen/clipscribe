"use client";

import {
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
import {
  ArrowLeft,
  Check,
  Download,
  Film,
  FolderOpen,
  GripVertical,
  Loader2,
  Music4,
  Pause,
  Play,
  Scissors,
  Search,
  Split,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  COMMON_SUBTITLE_STYLE_PRESETS,
  CREATOR_SUBTITLE_STYLE_LABELS,
  resolveCreatorSubtitleStyle,
} from "@/lib/creator/subtitle-style";
import { secondsToClock } from "@/lib/creator/types";
import { getLatestSubtitleForLanguage, getLatestTranscript, type HistoryItem } from "@/lib/history";
import { useEditorProject } from "@/hooks/useEditorLibrary";
import { useHistoryLibrary } from "@/hooks/useHistoryLibrary";
import { downloadBlob, readMediaMetadata } from "@/lib/editor/media";
import {
  buildProjectCaptionTimeline,
  resolveCaptionSourceChunks,
  type TimelineCaptionChunk,
} from "@/lib/editor/core/captions";
import {
  EDITOR_ASPECT_RATIO_LABELS,
  EDITOR_RESOLUTION_LABELS,
  getAspectRatioNumber,
} from "@/lib/editor/core/aspect-ratio";
import {
  appendTimelineAudioItem,
  clampAudioItemToAsset,
  clampVideoClipToAsset,
  createClonedTimelineAudioItem,
  createClonedTimelineClip,
  ensureProjectSelection,
  findAudioItemAtProjectTime,
  findClipAtProjectTime,
  getProjectDuration,
  getSelectionForLaneIndex,
  getTimelineAudioPlacements,
  getTimelineClipPlacements,
  insertTimelineAudioItemAfter,
  insertTimelineClipAfter,
  removeTimelineAudioItem,
  removeTimelineClip,
  reorderTimelineClip,
  replaceTimelineAudioItem,
  replaceTimelineClip,
  splitTimelineClip,
} from "@/lib/editor/core/timeline";
import { localEditorExportService } from "@/lib/editor/export-service";
import {
  applyResolvedSubtitleStyle,
  buildEditorExportRecord,
  createDefaultAudioTrack,
  createDefaultVideoClip,
  createEditorAssetRecord,
  markEditorProjectExporting,
  markEditorProjectFailed,
  markEditorProjectSaved,
  normalizeLegacyEditorProjectRecord,
} from "@/lib/editor/storage";
import type {
  EditorAssetRecord,
  EditorAspectRatio,
  EditorProjectRecord,
  EditorResolution,
  ResolvedEditorAsset,
  TimelineAudioItem,
  TimelineSelection,
  TimelineVideoClip,
} from "@/lib/editor/types";
import { parseSrt } from "@/lib/srt";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import {
  ExportProgressOverlay,
  type EditorExportPhase,
} from "@/components/editor/ExportProgressOverlay";

const ASPECT_OPTIONS: EditorAspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
const RESOLUTION_OPTIONS: EditorResolution[] = ["720p", "1080p", "4K"];
const EDITOR_PANEL_CLASS =
  "h-full overflow-hidden rounded-[0.9rem] border border-white/7 bg-[linear-gradient(180deg,rgba(13,17,24,0.98),rgba(7,10,15,0.98))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_12px_28px_rgba(0,0,0,0.18)]";
const EDITOR_PANEL_CONTENT_CLASS = "flex h-full min-h-0 flex-col gap-2 p-2";
const EDITOR_SECTION_CLASS =
  "rounded-[0.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.012))] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";
const EDITOR_LABEL_CLASS = "text-[10px] font-medium uppercase tracking-[0.28em] text-white/38";
const EDITOR_TOOLBAR_BUTTON_CLASS =
  "h-8 rounded-[0.85rem] border border-white/8 bg-white/[0.035] px-3 text-xs text-white/72 hover:bg-white/[0.08] hover:text-white";
const EDITOR_TIMECODE_CLASS = "font-mono text-[11px] tracking-[0.18em] text-white/46";

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
      kind: "video";
      item: TimelineVideoClip;
    }
  | {
      kind: "audio";
      item: TimelineAudioItem;
    };

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
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

function useObjectUrl(file: File | null | undefined) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}

function getEditorExportPhase(progressPct: number): EditorExportPhase {
  if (progressPct >= 100) return "complete";
  if (progressPct >= 95) return "finalizing";
  if (progressPct >= 15) return "rendering";
  return "preparing";
}

function ProjectAssetThumbnail({
  resolvedAsset,
  isActive,
  captionCount,
  onSelect,
  onAppend,
  onAssignAudio,
  onAttachSrt,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  resolvedAsset: ResolvedEditorAsset | undefined;
  isActive: boolean;
  captionCount: number;
  onSelect: () => void;
  onAppend: () => void;
  onAssignAudio: () => void;
  onAttachSrt: () => void;
  onDelete: () => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const asset = resolvedAsset?.asset;
  const videoUrl = useObjectUrl(asset?.kind === "video" ? resolvedAsset?.file : null);

  if (!asset) return null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group overflow-hidden rounded-[0.95rem] border text-left transition-all duration-150",
        isActive
          ? "border-cyan-300/40 bg-[linear-gradient(180deg,rgba(20,35,44,0.96),rgba(9,16,22,0.96))] shadow-[inset_0_1px_0_rgba(103,232,249,0.14)]"
          : "border-white/8 bg-[linear-gradient(180deg,rgba(19,23,31,0.96),rgba(10,13,19,0.96))] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(25,30,39,0.96),rgba(12,15,21,0.96))]",
        isDragging ? "scale-[0.985] opacity-60 ring-1 ring-cyan-300/24" : "cursor-grab active:cursor-grabbing"
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="relative aspect-video overflow-hidden border-b border-white/8 bg-black">
          {asset.kind === "video" && videoUrl ? (
            <video
              src={videoUrl}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_44%),linear-gradient(180deg,rgba(15,19,27,0.98),rgba(7,10,16,0.98))]">
              <div className="rounded-full border border-white/10 bg-white/5 p-2.5 text-white/70">
                {asset.kind === "video" ? <Film className="h-4 w-4" /> : <Music4 className="h-4 w-4" />}
              </div>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-[linear-gradient(180deg,transparent,rgba(3,6,10,0.82))]" />
          <div className="absolute left-2 top-2 rounded-full border border-black/25 bg-black/60 px-2 py-1 text-[9px] uppercase tracking-[0.22em] text-white/66">
            {asset.kind}
          </div>
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] text-white/72">
            <span className="max-w-[70%] truncate font-medium">{asset.filename}</span>
            <span className="font-mono text-white/45">{secondsToClock(asset.durationSeconds)}</span>
          </div>
        </div>
        <div className="space-y-1.5 p-2.5">
          <div className="flex flex-wrap gap-2 text-[9px] uppercase tracking-[0.2em] text-white/42">
            <span>{asset.sourceType}</span>
            <span>{captionCount > 0 ? `${captionCount} subs` : "no subs"}</span>
            {isActive ? <span className="text-cyan-200/80">previewing</span> : null}
          </div>
        </div>
      </button>
      <div className="flex flex-wrap gap-1.5 border-t border-white/6 px-2.5 py-2">
        {asset.kind === "video" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-md border-white/8 bg-white/[0.04] px-2 text-[10px] text-white/78 hover:bg-white/[0.09] hover:text-white"
            onClick={onAppend}
          >
            Track
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-md border-white/8 bg-white/[0.04] px-2 text-[10px] text-white/78 hover:bg-white/[0.09] hover:text-white"
            onClick={onAssignAudio}
          >
            Audio
          </Button>
        )}
        {asset.kind === "video" && asset.sourceType === "upload" ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-md px-2 text-[10px] text-cyan-100/88 hover:bg-cyan-400/10 hover:text-cyan-50"
            onClick={onAttachSrt}
          >
            SRT
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-md px-2 text-[10px] text-white/42 hover:bg-red-500/10 hover:text-red-100"
          onClick={onDelete}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

export function TimelineEditorWorkspace({ projectId }: { projectId: string }) {
  const topPanelsRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const historyPanelRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autosaveHashRef = useRef<string>("");
  const captionAttachAssetIdRef = useRef<string | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastAnimationFrameRef = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isTimelinePreviewRef = useRef(false);
  const projectDurationRef = useRef(0);
  const clipboardRef = useRef<TimelineClipboardItem | null>(null);
  const dragClipIdRef = useRef<string | null>(null);
  const dragAssetIdRef = useRef<string | null>(null);
  const dragAssetKindRef = useRef<EditorAssetRecord["kind"] | null>(null);

  const {
    project: loadedProject,
    assets: loadedAssets,
    exports,
    isLoading,
    error,
    saveProject,
    saveAssets,
    deleteAsset,
    saveExport,
    resolveHistoryMediaFile,
  } = useEditorProject(projectId);
  const { history } = useHistoryLibrary();

  const [project, setProject] = useState<EditorProjectRecord | null>(null);
  const [assets, setAssets] = useState<EditorAssetRecord[]>([]);
  const [resolvedAssets, setResolvedAssets] = useState<ResolvedEditorAsset[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const deferredLibrarySearch = useDeferredValue(librarySearch);
  const [exportResolution, setExportResolution] = useState<EditorResolution>("1080p");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>({ kind: "timeline" });
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [draggingAssetKind, setDraggingAssetKind] = useState<EditorAssetRecord["kind"] | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibilityState>({
    left: true,
    center: true,
    right: true,
  });
  const [panelWidths, setPanelWidths] = useState({
    leftPct: 24,
    rightPct: 24,
  });

  useEffect(() => {
    if (!loadedProject) return;
    const hydratedProject = ensureProjectSelection(
      applyResolvedSubtitleStyle({
        ...normalizeLegacyEditorProjectRecord(loadedProject),
        assetIds: loadedAssets.map((asset) => asset.id),
      })
    );
    const hydratedSnapshot = JSON.stringify({
      project: hydratedProject,
      assetIds: loadedAssets.map((asset) => asset.id),
    });

    if (autosaveHashRef.current === hydratedSnapshot) {
      return;
    }

    setProject(hydratedProject);
    setAssets(loadedAssets);
    autosaveHashRef.current = hydratedSnapshot;
    setSaveState("saved");
  }, [loadedAssets, loadedProject]);

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
          const mediaId = asset.sourceMediaId ?? asset.sourceProjectId;
          const mediaFile = mediaId ? await resolveHistoryMediaFile(mediaId) : undefined;
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
  }, [assets, resolveHistoryMediaFile]);

  useEffect(() => {
    if (!project) return;
    const snapshot = JSON.stringify({
      project,
      assetIds: assets.map((asset) => asset.id),
    });
    if (snapshot === autosaveHashRef.current) return;

    setSaveState("dirty");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      const savedRecord = markEditorProjectSaved(
        {
          ...project,
          assetIds: assets.map((asset) => asset.id),
        },
        Date.now()
      );
      autosaveHashRef.current = JSON.stringify({
        project: savedRecord,
        assetIds: assets.map((asset) => asset.id),
      });
      await saveProject(savedRecord);
      setProject(savedRecord);
      setSaveState("saved");
    }, 500);

    return () => window.clearTimeout(timer);
  }, [assets, project, saveProject]);

  const historyMap = useMemo(() => new Map(history.map((item) => [item.id, item])), [history]);
  const resolvedAssetsMap = useMemo(() => new Map(resolvedAssets.map((entry) => [entry.asset.id, entry])), [resolvedAssets]);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const clipPlacements = useMemo(
    () => (project ? getTimelineClipPlacements(project.timeline.videoClips) : []),
    [project]
  );
  const audioPlacements = useMemo(
    () => (project ? getTimelineAudioPlacements(project.timeline.audioItems) : []),
    [project]
  );
  const projectDuration = useMemo(() => (project ? getProjectDuration(project) : 0), [project]);
  const selectedItem = project?.timeline.selectedItem;
  const selectedClip = useMemo(
    () =>
      selectedItem?.kind === "video"
        ? project?.timeline.videoClips.find((clip) => clip.id === selectedItem.id)
        : undefined,
    [project, selectedItem]
  );
  const selectedAudioItem = useMemo(
    () =>
      selectedItem?.kind === "audio"
        ? project?.timeline.audioItems.find((item) => item.id === selectedItem.id)
        : undefined,
    [project, selectedItem]
  );
  const selectedClipAsset = useMemo(
    () => (selectedClip ? assetMap.get(selectedClip.assetId) : undefined),
    [assetMap, selectedClip]
  );
  const selectedAudioAsset = useMemo(
    () => (selectedAudioItem ? assetMap.get(selectedAudioItem.assetId) : undefined),
    [assetMap, selectedAudioItem]
  );
  const activePlacement = useMemo(() => {
    if (!project) return undefined;
    return findClipAtProjectTime(project.timeline.videoClips, project.timeline.playheadSeconds) ?? clipPlacements[0];
  }, [clipPlacements, project]);
  const activeAudioPlacement = useMemo(() => {
    if (!project) return undefined;
    return findAudioItemAtProjectTime(project.timeline.audioItems, project.timeline.playheadSeconds);
  }, [project]);
  const activeResolvedAsset = activePlacement ? resolvedAssetsMap.get(activePlacement.clip.assetId) : undefined;
  const activeResolvedAudioAsset = activeAudioPlacement ? resolvedAssetsMap.get(activeAudioPlacement.item.assetId) : undefined;
  const captionTimeline = useMemo(() => {
    if (!project) return [] as TimelineCaptionChunk[];
    return buildProjectCaptionTimeline({
      project,
      assets,
      historyMap,
    });
  }, [assets, historyMap, project]);
  const currentCaption = useMemo(() => {
    if (!project) return undefined;
    return captionTimeline.find((chunk) => {
      const start = chunk.timestamp?.[0] ?? 0;
      const end = chunk.timestamp?.[1] ?? start;
      return project.timeline.playheadSeconds >= start && project.timeline.playheadSeconds <= end;
    });
  }, [captionTimeline, project]);
  const filteredHistory = useMemo(() => {
    const query = deferredLibrarySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter((item) => item.filename.toLowerCase().includes(query));
  }, [deferredLibrarySearch, history]);
  const isTimelinePreview = previewMode.kind === "timeline";
  const previewedAsset =
    previewMode.kind === "asset" ? assets.find((asset) => asset.id === previewMode.assetId) : undefined;
  const previewedResolvedAsset = previewedAsset ? resolvedAssetsMap.get(previewedAsset.id) : undefined;
  const previewVideoAsset = isTimelinePreview ? activeResolvedAsset : previewedResolvedAsset?.asset.kind === "video" ? previewedResolvedAsset : undefined;
  const previewAudioAsset = isTimelinePreview
    ? activeResolvedAudioAsset
    : previewedResolvedAsset?.asset.kind === "audio"
    ? previewedResolvedAsset
    : undefined;
  const previewVideoUrl = useObjectUrl(previewVideoAsset?.file);
  const previewAudioUrl = useObjectUrl(previewAudioAsset?.file);
  const timelineZoomLevel = Math.max(1, project?.timeline.zoomLevel ?? 1);
  const maxVisibleDuration = Math.max(projectDuration, 1);
  const minVisibleDuration = Math.min(maxVisibleDuration, Math.max(3, maxVisibleDuration * 0.15));
  const visibleDuration = clampNumber(maxVisibleDuration / timelineZoomLevel, minVisibleDuration, maxVisibleDuration);
  const maxVisibleStart = Math.max(0, maxVisibleDuration - visibleDuration);
  const visibleStart = project ? clampNumber(project.timeline.playheadSeconds - visibleDuration / 2, 0, maxVisibleStart) : 0;
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
  const visibleClipPlacements = useMemo(() => {
    return clipPlacements.flatMap((placement) => {
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
  }, [clipPlacements, visibleDuration, visibleEnd, visibleStart]);
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

  useEffect(() => {
    playheadRef.current = project?.timeline.playheadSeconds ?? 0;
  }, [project?.timeline.playheadSeconds]);

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
    if (panelVisibility.left) return;
    setIsHistoryOpen(false);
  }, [panelVisibility.left]);

  useEffect(() => {
    if (!isHistoryOpen || isExporting) return;
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
  }, [isExporting, isHistoryOpen]);

  useEffect(() => {
    if (!isExporting) return;
    setIsHistoryOpen(false);
    setIsPlaying(false);
  }, [isExporting]);

  useEffect(() => {
    if (!isExporting) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isExporting]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isTimelinePreview || !activePlacement || !project) {
      video.pause();
      return;
    }
    const nextTime = activePlacement.clip.trimStartSeconds + (project.timeline.playheadSeconds - activePlacement.startSeconds);
    if (!Number.isFinite(nextTime)) return;
    if (Math.abs(video.currentTime - nextTime) > (isPlaying ? 0.35 : 0.05)) {
      try {
        video.currentTime = nextTime;
      } catch {}
    }
    if (isPlaying) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [activePlacement, isPlaying, isTimelinePreview, previewVideoUrl, project]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isTimelinePreview || !activeAudioPlacement || !project) {
      audio.pause();
      return;
    }
    const item = activeAudioPlacement.item;
    if (project.timeline.playheadSeconds < activeAudioPlacement.startSeconds || project.timeline.playheadSeconds > activeAudioPlacement.endSeconds || item.muted) {
      audio.pause();
      return;
    }
    const currentTime = item.trimStartSeconds + (project.timeline.playheadSeconds - activeAudioPlacement.startSeconds);
    if (Math.abs(audio.currentTime - currentTime) > (isPlaying ? 0.35 : 0.05)) {
      try {
        audio.currentTime = currentTime;
      } catch {}
    }
    audio.volume = item.volume;
    if (isPlaying) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [activeAudioPlacement, isPlaying, isTimelinePreview, previewAudioUrl, project]);

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

      const nextTime = Math.min(projectDurationRef.current, playheadRef.current + deltaSeconds);
      playheadRef.current = nextTime;

      startTransition(() => {
        setProject((prev) => {
          if (!prev || Math.abs(prev.timeline.playheadSeconds - nextTime) < 0.001) {
            return prev;
          }
          return {
            ...prev,
            timeline: {
              ...prev.timeline,
              playheadSeconds: nextTime,
            },
          };
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
  }, [isPlaying, isTimelinePreview]);

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

  const updateProject = (updater: (current: EditorProjectRecord) => EditorProjectRecord) => {
    setProject((current) => {
      if (!current) return current;
      return ensureProjectSelection(updater(current));
    });
  };

  const clearTimelineDragState = () => {
    dragClipIdRef.current = null;
    dragAssetIdRef.current = null;
    dragAssetKindRef.current = null;
    setDraggingClipId(null);
    setDraggingAssetId(null);
    setDraggingAssetKind(null);
    setDropTargetIndex(null);
  };

  const togglePanel = (panel: keyof PanelVisibilityState) => {
    setPanelVisibility((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };

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

  const seekVisibleTimeline = (event: ReactMouseEvent<HTMLDivElement>) => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const pct = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
    const nextTime = visibleStart + visibleDuration * pct;
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        playheadSeconds: nextTime,
      },
    }));
  };

  const updateSelectedClip = (updater: (clip: TimelineVideoClip) => TimelineVideoClip) => {
    if (!selectedClip || !selectedClipAsset) return;
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        videoClips: replaceTimelineClip(
          current.timeline.videoClips,
          clampVideoClipToAsset(updater(selectedClip), selectedClipAsset.durationSeconds)
        ),
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

  const focusTimelineSelection = (selection: TimelineSelection, playheadSeconds?: number) => {
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        selectedItem: selection,
        playheadSeconds: playheadSeconds ?? current.timeline.playheadSeconds,
      },
    }));
  };

  const appendVideoAssetToTimeline = (asset: EditorAssetRecord) => {
    const clip = createDefaultVideoClip({
      assetId: asset.id,
      label: asset.filename.replace(/\.[^/.]+$/, ""),
      durationSeconds: asset.durationSeconds,
    });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        selectedItem: { kind: "video", id: clip.id },
        playheadSeconds: getProjectDuration(current),
        videoClips: [...current.timeline.videoClips, clip],
      },
    }));
    setPreviewMode({ kind: "timeline" });
  };

  const insertVideoAssetAtTimelineIndex = (asset: EditorAssetRecord, index: number) => {
    const clip = createDefaultVideoClip({
      assetId: asset.id,
      label: asset.filename.replace(/\.[^/.]+$/, ""),
      durationSeconds: asset.durationSeconds,
    });
    updateProject((current) => {
      const nextClips = [...current.timeline.videoClips];
      const safeIndex = clampNumber(index, 0, nextClips.length);
      nextClips.splice(safeIndex, 0, clip);
      const placements = getTimelineClipPlacements(nextClips);
      const insertedPlacement = placements.find((placement) => placement.clip.id === clip.id);
      return {
        ...current,
        timeline: {
          ...current.timeline,
          selectedItem: { kind: "video", id: clip.id },
          playheadSeconds: insertedPlacement?.startSeconds ?? current.timeline.playheadSeconds,
          videoClips: nextClips,
        },
      };
    });
    setPreviewMode({ kind: "timeline" });
  };

  const appendAudioAssetToTimeline = (asset: EditorAssetRecord) => {
    const audioItem = clampAudioItemToAsset(
      createDefaultAudioTrack({
        assetId: asset.id,
        durationSeconds: asset.durationSeconds,
      }),
      asset.durationSeconds
    );
    updateProject((current) => {
      const nextAudioItems = appendTimelineAudioItem(current.timeline.audioItems, audioItem);
      const insertedItem = nextAudioItems.find((item) => item.id === audioItem.id);
      return {
        ...current,
        timeline: {
          ...current.timeline,
          audioItems: nextAudioItems,
          selectedItem: { kind: "audio", id: audioItem.id },
          playheadSeconds: insertedItem?.startOffsetSeconds ?? current.timeline.playheadSeconds,
        },
      };
    });
    setPreviewMode({ kind: "timeline" });
  };

  const copySelectedTimelineItem = () => {
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
    if (!clipboardItem) return false;

    setPreviewMode({ kind: "timeline" });
    if (clipboardItem.kind === "video") {
      const nextClip = createClonedTimelineClip(clipboardItem.item);
      updateProject((current) => {
        const afterClipId = current.timeline.selectedItem?.kind === "video" ? current.timeline.selectedItem.id : undefined;
        const nextClips = insertTimelineClipAfter(current.timeline.videoClips, nextClip, afterClipId);
        const placement = getTimelineClipPlacements(nextClips).find((item) => item.clip.id === nextClip.id);
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: nextClips,
            selectedItem: { kind: "video", id: nextClip.id },
            playheadSeconds: placement?.startSeconds ?? current.timeline.playheadSeconds,
          },
        };
      });
      return true;
    }

    const nextItem = createClonedTimelineAudioItem(clipboardItem.item);
    updateProject((current) => {
      const afterItemId = current.timeline.selectedItem?.kind === "audio" ? current.timeline.selectedItem.id : undefined;
      const nextAudioItems = insertTimelineAudioItemAfter(current.timeline.audioItems, nextItem, afterItemId);
      const insertedItem = nextAudioItems.find((item) => item.id === nextItem.id);
      return {
        ...current,
        timeline: {
          ...current.timeline,
          audioItems: nextAudioItems,
          selectedItem: { kind: "audio", id: nextItem.id },
          playheadSeconds: insertedItem?.startOffsetSeconds ?? current.timeline.playheadSeconds,
        },
      };
    });
    return true;
  };

  const duplicateSelectedTimelineItem = () => {
    if (selectedClip) {
      const nextClip = createClonedTimelineClip(selectedClip);
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        const nextClips = insertTimelineClipAfter(current.timeline.videoClips, nextClip, selectedClip.id);
        const placement = getTimelineClipPlacements(nextClips).find((item) => item.clip.id === nextClip.id);
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: nextClips,
            selectedItem: { kind: "video", id: nextClip.id },
            playheadSeconds: placement?.startSeconds ?? current.timeline.playheadSeconds,
          },
        };
      });
      return true;
    }

    if (selectedAudioItem) {
      const nextItem = createClonedTimelineAudioItem(selectedAudioItem);
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        const nextAudioItems = insertTimelineAudioItemAfter(current.timeline.audioItems, nextItem, selectedAudioItem.id);
        const insertedItem = nextAudioItems.find((item) => item.id === nextItem.id);
        return {
          ...current,
          timeline: {
            ...current.timeline,
            audioItems: nextAudioItems,
            selectedItem: { kind: "audio", id: nextItem.id },
            playheadSeconds: insertedItem?.startOffsetSeconds ?? current.timeline.playheadSeconds,
          },
        };
      });
      return true;
    }

    return false;
  };

  const removeSelectedTimelineItem = () => {
    if (!project?.timeline.selectedItem) return false;

    if (project.timeline.selectedItem.kind === "video") {
      const removedIndex = project.timeline.videoClips.findIndex((clip) => clip.id === project.timeline.selectedItem?.id);
      if (removedIndex < 0) return false;
      setPreviewMode({ kind: "timeline" });
      updateProject((current) => {
        const nextClips = removeTimelineClip(current.timeline.videoClips, current.timeline.selectedItem?.id ?? "");
        return {
          ...current,
          timeline: {
            ...current.timeline,
            videoClips: nextClips,
            selectedItem: getSelectionForLaneIndex("video", removedIndex, nextClips, current.timeline.audioItems),
          },
        };
      });
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
          selectedItem: getSelectionForLaneIndex("audio", removedIndex, current.timeline.videoClips, nextAudioItems),
        },
      };
    });
    return true;
  };

  const splitSelectedTimelineClip = () => {
    if (!selectedClip) return false;
    setPreviewMode({ kind: "timeline" });
    updateProject((current) => ({
      ...current,
      timeline: {
        ...current.timeline,
        videoClips: splitTimelineClip(
          current.timeline.videoClips,
          current.timeline.selectedItem?.kind === "video" ? current.timeline.selectedItem.id : "",
          current.timeline.playheadSeconds
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
        kind: metadata.kind,
        filename: file.name,
        mimeType: file.type || (metadata.kind === "video" ? "video/mp4" : "audio/mpeg"),
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

    nextAssets.forEach((asset) => {
      if (asset.kind === "video") {
        appendVideoAssetToTimeline(asset);
      } else {
        appendAudioAssetToTimeline(asset);
      }
    });

    toast.success(`${nextAssets.length} asset${nextAssets.length === 1 ? "" : "s"} imported`);
  };

  const handleAddHistoryItem = async (item: HistoryItem) => {
    if (!project) return;
    const mediaFile = await resolveHistoryMediaFile(item.id);
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
      mimeType: mediaFile.file.type || (metadata.kind === "video" ? "video/mp4" : "audio/mpeg"),
      sizeBytes: mediaFile.file.size,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      hasAudio: metadata.hasAudio,
      sourceType: "history",
      sourceMediaId: item.id,
      sourceProjectId: item.id,
      captionSource:
        metadata.kind === "video" && transcript && subtitle
          ? {
              kind: "history-subtitle",
              sourceProjectId: item.id,
              transcriptId: transcript.id,
              subtitleId: subtitle.id,
              language: subtitle.language,
              label: subtitle.label,
            }
          : { kind: "none" },
    });

    setAssets((current) => [...current, asset]);
    await saveAssets([asset]);
    if (asset.kind === "video") {
      appendVideoAssetToTimeline(asset);
    } else {
      appendAudioAssetToTimeline(asset);
    }
    toast.success(`Added ${item.filename} to this project`);
  };

  const handleAttachSrtClick = (assetId: string) => {
    captionAttachAssetIdRef.current = assetId;
    srtInputRef.current?.click();
  };

  const handleAttachSrt = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    const assetId = captionAttachAssetIdRef.current;
    if (!file || !assetId) return;
    const text = await file.text();
    const chunks = parseSrt(text);
    if (!chunks.length) {
      toast.error("The SRT file did not contain any valid subtitle rows.");
      return;
    }
    const target = assets.find((asset) => asset.id === assetId);
    if (!target) return;
    const updated: EditorAssetRecord = {
      ...target,
      updatedAt: Date.now(),
      captionSource: {
        kind: "embedded-srt",
        label: file.name,
        chunks,
      },
    };
    setAssets((current) => current.map((asset) => (asset.id === assetId ? updated : asset)));
    await saveAssets([updated]);
    toast.success("SRT attached to asset");
  };

  const handleDeleteAsset = async (asset: EditorAssetRecord) => {
    if (!project) return;
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    await deleteAsset(asset.id);
    updateProject((current) => ({
      ...current,
      assetIds: current.assetIds.filter((id) => id !== asset.id),
      timeline: {
        ...current.timeline,
        videoClips: current.timeline.videoClips.filter((clip) => clip.assetId !== asset.id),
        audioItems: current.timeline.audioItems.filter((item) => item.assetId !== asset.id),
      },
    }));
  };

  const handleExport = async () => {
    if (!project) return;
    if (project.timeline.videoClips.length === 0) {
      toast.error("Add at least one video clip to export the project.");
      return;
    }
    const missingTimelineAsset = project.timeline.videoClips.some(
      (clip) => resolvedAssetsMap.get(clip.assetId)?.missing
    );
    const missingAudioAsset = project.timeline.audioItems.some(
      (item) => resolvedAssetsMap.get(item.assetId)?.missing
    );
    if (missingTimelineAsset || missingAudioAsset) {
      toast.error("One or more timeline assets are missing. Replace them before exporting.");
      return;
    }

    const exportingProject = markEditorProjectExporting(project, Date.now());
    setProject(exportingProject);
    setIsExporting(true);
    setExportProgress(1);

    try {
      await saveProject(exportingProject);

      const result = await localEditorExportService.exportProject({
        project: exportingProject,
        resolvedAssets,
        historyMap,
        resolution: exportResolution,
        onProgress: setExportProgress,
      });

      downloadBlob(result.file);
      const exportRecord = buildEditorExportRecord({
        projectId: exportingProject.id,
        filename: result.file.name,
        mimeType: result.file.type,
        sizeBytes: result.file.size,
        durationSeconds: projectDuration,
        aspectRatio: exportingProject.aspectRatio,
        resolution: exportResolution,
        width: result.width,
        height: result.height,
        warnings: result.warnings,
        debugFfmpegCommand: result.ffmpegCommandPreview,
        debugNotes: result.notes,
      });
      await saveExport(exportRecord);

      const nextProject = markEditorProjectSaved(
        {
          ...exportingProject,
          latestExport: {
            id: exportRecord.id,
            createdAt: exportRecord.createdAt,
            filename: exportRecord.filename,
            aspectRatio: exportRecord.aspectRatio,
            resolution: exportRecord.resolution,
            status: exportRecord.status,
          },
          lastError: undefined,
        },
        Date.now()
      );
      await saveProject(nextProject);
      setProject(nextProject);
      toast.success(`Exported ${result.file.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      try {
        const failedRecord = buildEditorExportRecord({
          projectId: exportingProject.id,
          filename: `${exportingProject.name}.mp4`,
          mimeType: "video/mp4",
          sizeBytes: 0,
          durationSeconds: projectDuration,
          aspectRatio: exportingProject.aspectRatio,
          resolution: exportResolution,
          width: 0,
          height: 0,
          error: message,
          status: "failed",
        });
        await saveExport(failedRecord);
        const nextProject = markEditorProjectFailed(exportingProject, message, Date.now());
        await saveProject(nextProject);
        setProject(nextProject);
      } catch (persistError) {
        console.error("Failed to persist export failure state", persistError);
        setProject(markEditorProjectFailed(exportingProject, message, Date.now()));
      }
      toast.error(message);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleShortcutKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isExporting) return;
    if (isShortcutTargetEditable(event.target)) return;

    const usesCommand = event.metaKey || event.ctrlKey;
    const lowerKey = event.key.toLowerCase();

    if (!usesCommand && !event.altKey && event.code === "Space" && previewMode.kind === "timeline") {
      event.preventDefault();
      setIsPlaying((current) => !current);
      return;
    }

    if (usesCommand && !event.altKey && !event.shiftKey && lowerKey === "c") {
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
    ((project.timeline.playheadSeconds - visibleStart) / Math.max(visibleDuration, 0.001)) * 100,
    0,
    100
  );
  const previewTitle =
    previewMode.kind === "asset"
      ? previewedAsset?.filename ?? "Asset Preview"
      : activePlacement?.clip.label ?? "Timeline Preview";
  const previewMeta =
    previewMode.kind === "asset"
      ? previewedAsset
        ? `${previewedAsset.kind} · ${secondsToClock(previewedAsset.durationSeconds)} · ${previewedAsset.sourceType}`
        : "This asset is no longer available."
      : `${secondsToClock(project.timeline.playheadSeconds)} / ${secondsToClock(projectDuration)}`;
  const previewBadge =
    previewMode.kind === "asset"
      ? previewedAsset?.kind === "audio"
        ? "Asset audio"
        : "Asset clip"
      : `${project.aspectRatio} timeline`;
  const selectedTimelineLabel =
    selectedItem?.kind === "video"
      ? selectedClip?.label
      : selectedAudioAsset?.filename ?? (selectedAudioItem ? "Audio item" : undefined);
  const visibleWindowLabel = `${secondsToClock(visibleStart)} - ${secondsToClock(
    Math.min(projectDuration, visibleEnd)
  )}`;
  const exportPhase = getEditorExportPhase(exportProgress);
  const dropIndicatorPct = (() => {
    if (!draggingClipId && draggingAssetKind !== "video") return null;
    if (dropTargetIndex != null && visibleClipPlacements[dropTargetIndex]) {
      return visibleClipPlacements[dropTargetIndex].leftPct;
    }
    const lastVisiblePlacement = visibleClipPlacements[visibleClipPlacements.length - 1];
    if (lastVisiblePlacement) {
      return Math.min(100, lastVisiblePlacement.leftPct + lastVisiblePlacement.widthPct);
    }
    return 4;
  })();

  return (
    <main className="h-[100dvh] overflow-hidden" aria-busy={isExporting}>
      <input
        ref={mediaInputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        multiple
        onChange={(event) => void handleImportFiles(event.target.files)}
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt"
        className="hidden"
        onChange={(event) => void handleAttachSrt(event.target.files)}
      />

      <div className={cn("flex h-full flex-col gap-[6px]", isExporting && "pointer-events-none select-none")}>
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
                  value={project.name}
                  onChange={(event) =>
                    updateProject((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="h-10 max-w-xl rounded-none border-none bg-transparent px-0 text-[1.25rem] font-semibold tracking-[-0.02em] placeholder:text-white/24 focus-visible:ring-0"
                  placeholder="Project name"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={project.aspectRatio}
                onValueChange={(value) =>
                  updateProject((current) => ({
                    ...current,
                    aspectRatio: value as EditorAspectRatio,
                  }))
                }
              >
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
              <Select value={exportResolution} onValueChange={(value) => setExportResolution(value as EditorResolution)}>
                <SelectTrigger className="h-9 w-[146px] rounded-lg border-white/8 bg-white/[0.04] text-white">
                  <SelectValue placeholder="Resolution" />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-slate-950 text-white">
                  {RESOLUTION_OPTIONS.map((resolution) => (
                    <SelectItem key={resolution} value={resolution}>
                      {EDITOR_RESOLUTION_LABELS[resolution]}
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
                    onClick={() => togglePanel(panel)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <Button
                onClick={handleExport}
                disabled={isExporting}
                className="h-9 rounded-lg border border-amber-300/15 bg-amber-300/90 px-4 text-sm font-semibold text-slate-950 hover:bg-amber-200"
              >
                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Export
              </Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,0.95fr)_minmax(320px,0.82fr)] gap-[6px]">
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
                    <div className="flex items-center justify-between gap-2">
                      <div className={EDITOR_LABEL_CLASS}>Media</div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className={cn(EDITOR_TOOLBAR_BUTTON_CLASS, "h-7 rounded-md px-2.5")}
                          onClick={() => mediaInputRef.current?.click()}
                        >
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Import
                        </Button>
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
                          History
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

                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className={cn(EDITOR_SECTION_CLASS, "flex min-h-0 flex-1 flex-col p-2")}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className={EDITOR_LABEL_CLASS}>Assets</div>
                          <div className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[9px] uppercase tracking-[0.24em] text-white/36">
                            {assets.length}
                          </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                          {assets.length === 0 ? (
                            <div className="grid h-full place-items-center rounded-[0.9rem] border border-dashed border-white/10 bg-black/20 p-4 text-center text-sm text-white/45">
                              Import clips or pull media from history to populate this project.
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                              {assets.map((asset) => {
                                const resolved = resolvedAssetsMap.get(asset.id);
                                const captionCount =
                                  asset.captionSource.kind === "embedded-srt"
                                    ? asset.captionSource.chunks.length
                                    : resolveCaptionSourceChunks(asset.captionSource, historyMap).length;
                                return (
                                  <div key={asset.id} className="space-y-1.5">
                                    <ProjectAssetThumbnail
                                      resolvedAsset={resolved}
                                      isActive={previewMode.kind === "asset" && previewMode.assetId === asset.id}
                                      captionCount={captionCount}
                                      onSelect={() => setPreviewMode({ kind: "asset", assetId: asset.id })}
                                      onAppend={() => appendVideoAssetToTimeline(asset)}
                                      onAssignAudio={() => appendAudioAssetToTimeline(asset)}
                                      onAttachSrt={() => handleAttachSrtClick(asset.id)}
                                      onDelete={() => void handleDeleteAsset(asset)}
                                      onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", asset.id);
                                        dragAssetIdRef.current = asset.id;
                                        dragAssetKindRef.current = asset.kind;
                                        setDraggingAssetId(asset.id);
                                        setDraggingAssetKind(asset.kind);
                                        setDraggingClipId(null);
                                        dragClipIdRef.current = null;
                                        setDropTargetIndex(asset.kind === "video" ? clipPlacements.length : null);
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
                    </div>

                    {isHistoryOpen ? (
                      <div
                        ref={historyPanelRef}
                        className="absolute inset-x-2 bottom-2 top-11 z-20 flex min-h-0 flex-col overflow-hidden rounded-[0.95rem] border border-white/10 bg-[linear-gradient(180deg,rgba(9,12,18,0.98),rgba(5,8,12,0.98))] shadow-[0_24px_60px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className={EDITOR_LABEL_CLASS}>History</div>
                            <span className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[9px] uppercase tracking-[0.24em] text-white/36">
                              {history.length}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md text-white/40 hover:bg-white/[0.06] hover:text-white"
                            onClick={() => setIsHistoryOpen(false)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="border-b border-white/6 px-3 py-2.5">
                          <Input
                            value={librarySearch}
                            onChange={(event) => setLibrarySearch(event.target.value)}
                            placeholder="Search transcript history"
                            className="h-8 rounded-md border-white/8 bg-white/[0.04]"
                          />
                        </div>
                        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
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
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-3 h-8 rounded-lg border-white/8 bg-black/20 text-white/78 hover:bg-white/[0.08] hover:text-white"
                                    onClick={() => void handleAddHistoryItem(item)}
                                  >
                                    Add to Project
                                  </Button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : null}
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
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white/72">{previewTitle}</div>
                        <div className={cn(EDITOR_TIMECODE_CLASS, "mt-0.5")}>{previewMeta}</div>
                      </div>
                      <div className="flex items-center gap-2">
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

                    <div className="flex min-h-0 flex-1 flex-col rounded-[0.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(9,12,17,0.98),rgba(5,8,12,0.98))] p-1.5">
                      <div className="flex min-h-0 flex-1 items-center justify-center">
                        <div
                          className="relative max-h-full w-full overflow-hidden rounded-[1rem] border border-white/8 bg-black shadow-[0_14px_24px_rgba(0,0,0,0.26)]"
                          style={{
                            width: "min(100%, 760px)",
                            aspectRatio: String(aspectRatioValue),
                          }}
                        >
                          {previewMode.kind === "timeline" ? (
                            previewVideoUrl ? (
                              <>
                                <video
                                  ref={videoRef}
                                  key={`timeline:${previewVideoUrl}`}
                                  src={previewVideoUrl}
                                  muted={false}
                                  playsInline
                                  className="absolute inset-0 h-full w-full object-cover"
                                  style={{
                                    transform: `translate(${activePlacement?.clip.canvas.panX ?? 0}px, ${activePlacement?.clip.canvas.panY ?? 0}px) scale(${activePlacement?.clip.canvas.zoom ?? 1})`,
                                    transformOrigin: "center center",
                                  }}
                                />
                                {project.subtitles.enabled && currentCaption ? (
                                  <div
                                    className="pointer-events-none absolute max-w-[82%] -translate-x-1/2 -translate-y-1/2 text-center"
                                    style={{
                                      left: `${project.subtitles.positionXPercent}%`,
                                      top: `${project.subtitles.positionYPercent}%`,
                                      transform: "translate(-50%, -50%)",
                                    }}
                                  >
                                    <div
                                      className="inline-block rounded-[1rem] border border-white/10 bg-black/18 px-4 py-2 text-white backdrop-blur-[2px]"
                                      style={{
                                        fontSize: `${Math.max(18, 28 * project.subtitles.scale)}px`,
                                        lineHeight: `${Math.max(22, 34 * project.subtitles.scale)}px`,
                                        fontWeight: 700,
                                        textShadow: "0 3px 10px rgba(0,0,0,0.6)",
                                        WebkitTextStroke: "2px rgba(8,8,8,0.75)",
                                      }}
                                    >
                                      {String(currentCaption.text)}
                                    </div>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <div className="absolute inset-0 grid place-items-center text-center text-white/45">
                                <div>
                                  <Film className="mx-auto mb-4 h-12 w-12 text-white/20" />
                                  No video source resolved for the current playhead.
                                </div>
                              </div>
                            )
                          ) : previewedAsset?.kind === "video" ? (
                            previewVideoUrl ? (
                              <video
                                key={`asset:${previewVideoUrl}`}
                                src={previewVideoUrl}
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
                          ) : (
                            <div className="absolute inset-0 grid place-items-center text-center text-white/45">
                              <div>
                                <Film className="mx-auto mb-4 h-12 w-12 text-white/20" />
                                Select a project asset to preview it here.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 shrink-0">
                        {previewMode.kind === "timeline" ? (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[0.9rem] border border-white/8 bg-black/25 px-3 py-2">
                              <div className={EDITOR_TIMECODE_CLASS}>
                                {secondsToClock(project.timeline.playheadSeconds)} / {secondsToClock(projectDuration)}
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
                                  onClick={() =>
                                    updateProject((current) => ({
                                      ...current,
                                      timeline: {
                                        ...current.timeline,
                                        playheadSeconds: 0,
                                      },
                                    }))
                                  }
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
                              value={project.timeline.playheadSeconds}
                              onChange={(event) =>
                                updateProject((current) => ({
                                  ...current,
                                  timeline: {
                                    ...current.timeline,
                                    playheadSeconds: Number(event.target.value),
                                  },
                                }))
                              }
                              className="mt-3 w-full accent-cyan-400"
                            />
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[0.9rem] border border-cyan-400/14 bg-cyan-400/[0.045] px-3 py-2.5">
                            <div className="text-sm text-white/58">
                              Project assets preview independently. Click any clip in the timeline to return to the live sequence.
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
                        {previewMode.kind === "timeline" && previewAudioUrl ? <audio ref={audioRef} src={previewAudioUrl} hidden /> : null}
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
                    <div className="flex items-center justify-between gap-2">
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

                    <Tabs defaultValue="selection" className="flex min-h-0 flex-1 flex-col">
                      <TabsList className="grid w-full shrink-0 grid-cols-3 rounded-[0.75rem] border border-white/8 bg-black/25 p-1">
                        <TabsTrigger value="selection" className="rounded-[0.72rem] text-[11px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                          Selection
                        </TabsTrigger>
                        <TabsTrigger value="subtitles" className="rounded-[0.72rem] text-[11px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                          Subtitles
                        </TabsTrigger>
                        <TabsTrigger value="exports" className="rounded-[0.72rem] text-[11px] data-[state=active]:bg-white/[0.08] data-[state=active]:text-white">
                          Exports
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="selection" className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        {selectedClip && selectedClipAsset ? (
                          <>
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Selected Clip</div>
                              <div className="mt-2 text-lg font-semibold text-white">{selectedClip.label}</div>
                              <div className="mt-1 text-sm text-white/50">{selectedClipAsset.filename}</div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <label className={EDITOR_LABEL_CLASS}>
                                Trim Start · {secondsToClock(selectedClip.trimStartSeconds)}
                              </label>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(selectedClipAsset.durationSeconds - 0.5, 0.5)}
                                step={0.01}
                                value={selectedClip.trimStartSeconds}
                                onChange={(event) =>
                                  updateSelectedClip((clip) => ({
                                    ...clip,
                                    trimStartSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs uppercase tracking-[0.24em] text-white/45">
                                Trim End · {secondsToClock(selectedClip.trimEndSeconds)}
                              </label>
                              <input
                                type="range"
                                min={Math.min(selectedClip.trimStartSeconds + 0.5, selectedClipAsset.durationSeconds)}
                                max={selectedClipAsset.durationSeconds}
                                step={0.01}
                                value={selectedClip.trimEndSeconds}
                                onChange={(event) =>
                                  updateSelectedClip((clip) => ({
                                    ...clip,
                                    trimEndSeconds: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Frame</div>
                              <label className="text-xs text-white/55">Zoom · {selectedClip.canvas.zoom.toFixed(2)}x</label>
                              <input
                                type="range"
                                min={0.6}
                                max={2.4}
                                step={0.01}
                                value={selectedClip.canvas.zoom}
                                onChange={(event) =>
                                  updateSelectedClip((clip) => ({
                                    ...clip,
                                    canvas: {
                                      ...clip.canvas,
                                      zoom: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Pan X · {Math.round(selectedClip.canvas.panX)}px</label>
                              <input
                                type="range"
                                min={-240}
                                max={240}
                                step={1}
                                value={selectedClip.canvas.panX}
                                onChange={(event) =>
                                  updateSelectedClip((clip) => ({
                                    ...clip,
                                    canvas: {
                                      ...clip.canvas,
                                      panX: Number(event.target.value),
                                    },
                                  }))
                                }
                                className="w-full"
                              />
                              <label className="text-xs text-white/55">Pan Y · {Math.round(selectedClip.canvas.panY)}px</label>
                              <input
                                type="range"
                                min={-240}
                                max={240}
                                step={1}
                                value={selectedClip.canvas.panY}
                                onChange={(event) =>
                                  updateSelectedClip((clip) => ({
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
                                <div className={EDITOR_LABEL_CLASS}>Clip Audio</div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 rounded-lg px-2 text-white/60 hover:bg-white/[0.06] hover:text-white"
                                  onClick={() =>
                                    updateSelectedClip((clip) => ({
                                      ...clip,
                                      muted: !clip.muted,
                                    }))
                                  }
                                >
                                  {selectedClip.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </Button>
                              </div>
                              <label className="text-xs text-white/55">Volume · {Math.round(selectedClip.volume * 100)}%</label>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={selectedClip.volume}
                                onChange={(event) =>
                                  updateSelectedClip((clip) => ({
                                    ...clip,
                                    volume: Number(event.target.value),
                                  }))
                                }
                                className="w-full"
                              />
                            </div>
                          </>
                        ) : selectedAudioItem && selectedAudioAsset ? (
                          <>
                            <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                              <div className={EDITOR_LABEL_CLASS}>Selected Audio Item</div>
                              <div className="mt-2 text-lg font-semibold text-white">{selectedAudioAsset.filename}</div>
                              <div className="mt-1 text-sm text-white/50">
                                {secondsToClock(selectedAudioAsset.durationSeconds)} source · starts at {secondsToClock(selectedAudioItem.startOffsetSeconds)}
                              </div>
                            </div>

                            <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                              <label className={EDITOR_LABEL_CLASS}>
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
                                <div className={EDITOR_LABEL_CLASS}>Track Audio</div>
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
                          </>
                        ) : (
                          <div className="rounded-[0.95rem] border border-dashed border-white/10 bg-black/20 p-5 text-sm text-white/45">
                            Select a clip or audio item in the timeline to edit its trim, framing, and level settings.
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="subtitles" className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className={EDITOR_LABEL_CLASS}>Subtitle Track</div>
                              <div className="mt-1 text-sm text-white/55">
                                Derived from history subtitles or attached SRT files.
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className={EDITOR_TOOLBAR_BUTTON_CLASS}
                              onClick={() =>
                                updateProject((current) => ({
                                  ...current,
                                  subtitles: {
                                    ...current.subtitles,
                                    enabled: !current.subtitles.enabled,
                                  },
                                }))
                              }
                            >
                              {project.subtitles.enabled ? <Check className="mr-2 h-4 w-4" /> : null}
                              {project.subtitles.enabled ? "Enabled" : "Disabled"}
                            </Button>
                          </div>
                        </div>

                        <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                          <label className={EDITOR_LABEL_CLASS}>Preset</label>
                          <Select
                            value={project.subtitles.preset}
                            onValueChange={(value) =>
                              updateProject((current) => ({
                                ...current,
                                subtitles: {
                                  ...current.subtitles,
                                  preset: value as EditorProjectRecord["subtitles"]["preset"],
                                  style: resolveCreatorSubtitleStyle(
                                    value as EditorProjectRecord["subtitles"]["preset"],
                                    current.subtitles.style
                                  ),
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="h-9 rounded-lg border-white/8 bg-white/[0.04] text-white">
                              <SelectValue placeholder="Subtitle preset" />
                            </SelectTrigger>
                            <SelectContent className="border-white/10 bg-slate-950 text-white">
                              {Object.entries(CREATOR_SUBTITLE_STYLE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="grid gap-2 text-xs text-white/55">
                            {COMMON_SUBTITLE_STYLE_PRESETS.map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/18 hover:bg-white/[0.05]"
                                onClick={() =>
                                  updateProject((current) => ({
                                    ...current,
                                    subtitles: {
                                      ...current.subtitles,
                                      preset: preset.style.preset,
                                      style: preset.style,
                                    },
                                  }))
                                }
                              >
                                <div className="font-medium text-white">{preset.name}</div>
                                <div className="text-white/45">{preset.description}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className={cn(EDITOR_SECTION_CLASS, "space-y-3 p-3")}>
                          <label className="text-xs text-white/55">Scale · {project.subtitles.scale.toFixed(2)}x</label>
                          <input
                            type="range"
                            min={0.7}
                            max={1.8}
                            step={0.01}
                            value={project.subtitles.scale}
                            onChange={(event) =>
                              updateProject((current) => ({
                                ...current,
                                subtitles: {
                                  ...current.subtitles,
                                  scale: Number(event.target.value),
                                },
                              }))
                            }
                            className="w-full"
                          />
                          <label className="text-xs text-white/55">
                            X Position · {project.subtitles.positionXPercent.toFixed(0)}%
                          </label>
                          <input
                            type="range"
                            min={10}
                            max={90}
                            step={1}
                            value={project.subtitles.positionXPercent}
                            onChange={(event) =>
                              updateProject((current) => ({
                                ...current,
                                subtitles: {
                                  ...current.subtitles,
                                  positionXPercent: Number(event.target.value),
                                },
                              }))
                            }
                            className="w-full"
                          />
                          <label className="text-xs text-white/55">
                            Y Position · {project.subtitles.positionYPercent.toFixed(0)}%
                          </label>
                          <input
                            type="range"
                            min={55}
                            max={92}
                            step={1}
                            value={project.subtitles.positionYPercent}
                            onChange={(event) =>
                              updateProject((current) => ({
                                ...current,
                                subtitles: {
                                  ...current.subtitles,
                                  positionYPercent: Number(event.target.value),
                                },
                              }))
                            }
                            className="w-full"
                          />
                        </div>
                      </TabsContent>

                      <TabsContent value="exports" className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        <div className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                          <div className={EDITOR_LABEL_CLASS}>Export Status</div>
                          {isExporting ? (
                            <div className="mt-3 space-y-2">
                              <div className="flex items-center gap-2 text-sm text-white">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Rendering {exportResolution}
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full bg-[linear-gradient(90deg,rgba(34,211,238,0.8),rgba(251,191,36,0.75))]"
                                  style={{ width: `${exportProgress}%` }}
                                />
                              </div>
                              <div className="text-xs text-white/45">{exportProgress}%</div>
                            </div>
                          ) : (
                            <div className="mt-3 text-sm text-white/55">
                              {project.latestExport
                                ? `Last export ${project.latestExport.resolution} · ${project.latestExport.aspectRatio} · ${formatDateTime(project.latestExport.createdAt)}`
                                : "No export run yet for this project."}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          {exports.length === 0 ? (
                            <div className="rounded-[0.95rem] border border-dashed border-white/10 bg-black/20 p-5 text-sm text-white/45">
                              Export history is metadata only. Render an export to create the first audit record.
                            </div>
                          ) : (
                            exports.map((record) => (
                              <div key={record.id} className={cn(EDITOR_SECTION_CLASS, "p-3")}>
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-medium text-white">{record.filename}</div>
                                    <div className="mt-1 text-xs text-white/45">
                                      {record.resolution} · {record.aspectRatio} · {formatDateTime(record.createdAt)}
                                    </div>
                                  </div>
                                  <span
                                    className={cn(
                                      "rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em]",
                                      record.status === "completed"
                                        ? "border border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                                        : "border border-red-400/20 bg-red-500/10 text-red-100"
                                    )}
                                  >
                                    {record.status}
                                  </span>
                                </div>
                                {record.error ? <div className="mt-3 text-sm text-red-100">{record.error}</div> : null}
                                {record.warnings?.length ? (
                                  <div className="mt-3 text-xs text-amber-100/80">{record.warnings.join(" ")}</div>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </section>

          <Card className="h-full overflow-hidden rounded-none border-none bg-[linear-gradient(180deg,rgba(10,13,18,0.99),rgba(5,7,10,0.99))] text-white shadow-none">
            <CardContent className="flex h-full min-h-0 flex-col gap-0 p-0">
              <div className="flex flex-col gap-2 border-b border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.006))] px-2 py-1.5 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={EDITOR_TIMECODE_CLASS}>{visibleWindowLabel}</div>
                  {selectedTimelineLabel ? (
                    <div
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]",
                        selectedItem?.kind === "audio"
                          ? "border border-amber-300/16 bg-amber-300/8 text-amber-100/80"
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
                <div className="grid min-h-0 grid-rows-[38px_minmax(0,1fr)_96px] border-r border-white/6 bg-[linear-gradient(180deg,rgba(11,14,19,0.98),rgba(7,10,14,0.98))]">
                  <div className={cn(EDITOR_LABEL_CLASS, "flex items-center px-3")}>Time</div>
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
                          updateSelectedClip((clip) => ({
                            ...clip,
                            muted: !clip.muted,
                          }))
                        }
                      >
                        {selectedClip?.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
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
                    className="pointer-events-none absolute inset-y-0 z-30 w-px bg-red-400/90 shadow-[0_0_22px_rgba(248,113,113,0.5)]"
                    style={{ left: `${playheadPct}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-0 z-30 h-4 w-[10px] -translate-x-1/2 rounded-b-full border border-red-300/40 bg-red-400/90 shadow-[0_4px_12px_rgba(248,113,113,0.4)]"
                    style={{ left: `${playheadPct}%` }}
                  />

                  <div className="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)_96px]">
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
                        "relative overflow-hidden border-b border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.022),rgba(255,255,255,0.01))]",
                        draggingAssetKind === "video" ? "bg-cyan-400/[0.035]" : ""
                      )}
                      onClick={seekVisibleTimeline}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragAssetKindRef.current === "video") {
                          setDropTargetIndex(visibleClipPlacements.length);
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
                        const draggedClipId = dragClipIdRef.current;
                        if (!draggedClipId) return;
                        updateProject((current) => ({
                          ...current,
                          timeline: {
                            ...current.timeline,
                            videoClips: reorderTimelineClip(
                              current.timeline.videoClips,
                              draggedClipId,
                              current.timeline.videoClips.length - 1
                            ),
                          },
                        }));
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
                          <div className="mt-2 text-sm text-white/56">Add clips from the media bin to start cutting.</div>
                        </div>
                      ) : visibleClipPlacements.length === 0 ? (
                        <div className="absolute left-[4%] top-1/2 w-[30%] min-w-[240px] -translate-y-1/2 rounded-[0.95rem] border border-dashed border-cyan-300/14 bg-cyan-300/[0.035] px-4 py-3 text-left">
                          <div className={EDITOR_LABEL_CLASS}>Sequence outside view</div>
                          <div className="mt-2 text-sm text-white/56">Move the playhead or reduce zoom to bring clips back into frame.</div>
                        </div>
                      ) : null}

                      {visibleClipPlacements.map((placement, index) => {
                        const isSelected = selectedItem?.kind === "video" && selectedItem.id === placement.clip.id;
                        const isDragging = draggingClipId === placement.clip.id;
                        const isDropTarget = dropTargetIndex === index && draggingClipId !== placement.clip.id;
                        return (
                          <button
                            key={placement.clip.id}
                            type="button"
                            draggable
                            onDragStart={() => {
                              dragClipIdRef.current = placement.clip.id;
                              dragAssetIdRef.current = null;
                              dragAssetKindRef.current = null;
                              setDraggingClipId(placement.clip.id);
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
                              if (dragAssetKindRef.current === "video" || dragClipIdRef.current) {
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
                                  insertVideoAssetAtTimelineIndex(draggedAsset, placement.index);
                                }
                                clearTimelineDragState();
                                return;
                              }
                              const draggedClipId = dragClipIdRef.current;
                              if (!draggedClipId) return;
                              updateProject((current) => ({
                                ...current,
                                timeline: {
                                  ...current.timeline,
                                  videoClips: reorderTimelineClip(
                                    current.timeline.videoClips,
                                    draggedClipId,
                                    placement.index
                                  ),
                                },
                              }));
                              clearTimelineDragState();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              focusTimelineSelection({ kind: "video", id: placement.clip.id }, placement.startSeconds);
                            }}
                            className={cn(
                              "absolute top-1/2 h-[82%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                              isSelected
                                ? "border-cyan-300/40 bg-[linear-gradient(180deg,rgba(17,56,73,0.9),rgba(7,26,35,0.94))] shadow-[inset_0_1px_0_rgba(103,232,249,0.16),0_0_0_1px_rgba(103,232,249,0.08)]"
                                : "border-white/10 bg-[linear-gradient(180deg,rgba(28,33,42,0.9),rgba(14,17,23,0.96))] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(34,40,50,0.92),rgba(17,20,28,0.96))]",
                              isDragging ? "scale-[0.985] opacity-60" : "",
                              isDropTarget ? "shadow-[0_0_0_1px_rgba(103,232,249,0.18)]" : "",
                              "cursor-grab active:cursor-grabbing"
                            )}
                            style={{
                              left: `${placement.leftPct}%`,
                              width: `${placement.widthPct}%`,
                            }}
                          >
                            <div className="pointer-events-none absolute inset-y-2 left-1.5 w-[4px] rounded-full bg-white/18" />
                            <div className="pointer-events-none absolute inset-y-2 right-1.5 w-[4px] rounded-full bg-white/10" />
                            <div className="pointer-events-none flex h-full flex-col justify-between pl-2">
                              <div>
                                <div className="truncate text-sm font-medium text-white">{placement.clip.label}</div>
                                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/44">
                                  <span className="truncate">{placement.clip.muted ? "Muted clip audio" : "Clip audio on"}</span>
                                  <span className="font-mono">{secondsToClock(placement.durationSeconds)}</span>
                                </div>
                              </div>
                              <div className="mt-3 space-y-1.5">
                                <div className="h-8 rounded-[0.7rem] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))]" />
                                <div className="h-5 rounded-[0.6rem] bg-[repeating-linear-gradient(90deg,rgba(56,189,248,0.34)_0,rgba(56,189,248,0.34)_8px,rgba(12,18,25,0.16)_8px,rgba(12,18,25,0.16)_14px)]" />
                              </div>
                            </div>
                          </button>
                        );
                      })}
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
                          return (
                            <button
                              key={placement.item.id}
                              type="button"
                              className={cn(
                                "absolute top-1/2 h-[68%] -translate-y-1/2 overflow-hidden rounded-[0.9rem] border px-3 py-2 text-left transition-all duration-150",
                                isSelected
                                  ? "border-amber-200/45 bg-[linear-gradient(180deg,rgba(113,73,13,0.88),rgba(67,42,10,0.92))] shadow-[inset_0_1px_0_rgba(253,224,71,0.16),0_0_0_1px_rgba(253,224,71,0.08)]"
                                  : "border-amber-300/28 bg-[linear-gradient(180deg,rgba(90,61,12,0.78),rgba(47,31,8,0.9))] shadow-[inset_0_1px_0_rgba(253,224,71,0.12)] hover:border-amber-200/40 hover:bg-[linear-gradient(180deg,rgba(104,69,15,0.8),rgba(58,37,10,0.92))]"
                              )}
                              style={{
                                left: `${placement.leftPct}%`,
                                width: `${placement.widthPct}%`,
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                focusTimelineSelection({ kind: "audio", id: placement.item.id }, placement.startSeconds);
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
                          <div className="mt-2 text-sm text-white/56">Add audio from the media bin to build the A1 track.</div>
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
      <ExportProgressOverlay
        open={isExporting}
        projectName={project.name}
        resolution={exportResolution}
        progressPct={exportProgress}
        phase={exportPhase}
      />
      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
