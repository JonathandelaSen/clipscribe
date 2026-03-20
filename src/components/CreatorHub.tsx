"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  Clapperboard,
  Copy,
  Download,
  FileVideo,
  Film,
  Flame,
  FolderOpen,
  HardDriveDownload,
  KeyRound,
  Layers,
  Lightbulb,
  Loader2,
  Pause,
  Play,
  Rocket,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { db } from "@/lib/db";
import {
  createActiveBrowserRenderSession,
  isBrowserRenderCancelableStage,
  isBrowserRenderCanceledError,
  type ActiveBrowserRenderSession,
  type BrowserRenderStage,
} from "@/lib/browser-render";
import {
  getLatestSubtitleForLanguage,
  getLatestTranscript,
  getSubtitleById,
  getTranscriptById,
  makeId,
  sortSubtitleVersions,
  sortTranscriptVersions,
  type HistoryItem,
  type SubtitleChunk,
  type SubtitleVersion,
} from "@/lib/history";
import {
  secondsToClock,
  type CreatorGenerationSourceInput,
  type CreatorShortEditorState,
  type CreatorShortPlan,
  type CreatorShortsGenerateRequest,
  type CreatorSubtitleStyleSettings,
  type CreatorVideoInfoGenerateRequest,
  type CreatorViralClip,
  type CreatorVideoInfoBlock,
} from "@/lib/creator/types";
import {
  applyTrimNudgesToClip,
  createManualFallbackClip,
  createManualFallbackPlan,
  deriveTrimNudgesFromSavedClip,
} from "@/lib/creator/core/clip-editing";
import { clipSubtitleChunks, findSubtitleChunkAtTime } from "@/lib/creator/core/clip-windowing";
import { buildShortExportDiagnostics } from "@/lib/creator/core/export-diagnostics";
import { prepareShortExport } from "@/lib/creator/core/export-prep";
import {
  buildAiSuggestionInputSummary,
  buildAiSuggestionProjectRecords,
  buildAiSuggestionSourceSignature,
  buildCompletedShortExportRecord,
  buildLocalBrowserRenderResponse,
  buildShortProjectRecord,
  markShortProjectExported,
  markShortProjectFailed,
  restoreShortProjectAfterCanceledExport,
  shouldReuseShortProjectId,
} from "@/lib/creator/core/short-lifecycle";
import type { CreatorShortExportRecord, CreatorShortProjectRecord } from "@/lib/creator/storage";
import { createEditorAssetRecord } from "@/lib/editor/storage";
import { resetFFmpeg } from "@/lib/ffmpeg";
import { exportShortVideoLocally } from "@/lib/creator/local-render";
import {
  COMMON_SUBTITLE_STYLE_PRESETS,
  CREATOR_SUBTITLE_STYLE_LABELS,
  cssRgbaFromHex,
  cssTextShadowFromStyle,
  getSubtitleMaxCharsPerLine,
  getDefaultCreatorSubtitleStyle,
  resolveCreatorSubtitleStyle,
  wrapSubtitleLines,
} from "@/lib/creator/subtitle-style";
import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useHistoryLibrary } from "@/hooks/useHistoryLibrary";
import { useCreatorShortRenderer } from "@/hooks/useCreatorShortRenderer";
import { useCreatorShortsGenerator } from "@/hooks/useCreatorShortsGenerator";
import { useCreatorShortsLibrary } from "@/hooks/useCreatorShortsLibrary";
import { useCreatorVideoInfoGenerator } from "@/hooks/useCreatorVideoInfoGenerator";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copied`, {
    className: "bg-green-500/20 border-green-500/50 text-green-100",
  });
}

function summarizeClipText(clip: CreatorViralClip, chunks: SubtitleChunk[], maxChars = 220): string {
  const text = clipSubtitleChunks(clip, chunks)
    .map((chunk) => String(chunk.text ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return clip.hook;
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function subtitleVersionLabel(subtitle: SubtitleVersion): string {
  return `S${subtitle.versionNumber} • ${subtitle.language.toUpperCase()} • ${subtitle.kind} • ${subtitle.shiftSeconds >= 0 ? "+" : ""}${subtitle.shiftSeconds}s`;
}

function platformLabel(platform: CreatorShortPlan["platform"]): string {
  if (platform === "youtube_shorts") return "YouTube Shorts";
  if (platform === "instagram_reels") return "Instagram Reels";
  return "TikTok";
}

function buildYouTubeTimestamps(chapters: { timeSeconds: number; label: string }[]): string {
  return chapters
    .slice()
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((chapter) => `${secondsToClock(chapter.timeSeconds)} ${chapter.label}`)
    .join("\n");
}

function getTranscriptDurationSeconds(item: HistoryItem | undefined, transcriptId: string): number | undefined {
  if (!item) return undefined;
  const transcript = getTranscriptById(item, transcriptId);
  const chunks = transcript?.chunks ?? [];
  const last = [...chunks].reverse().find((chunk) => chunk.timestamp?.[1] != null || chunk.timestamp?.[0] != null);
  const value = last?.timestamp?.[1] ?? last?.timestamp?.[0];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value >= 10 || power === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAnalyzeErrorDetails(message: string | null): { title: string; body: string } | null {
  if (!message) return null;
  if (message.startsWith("OpenAI API Error: ")) {
    return {
      title: "Error en la API de OpenAI",
      body: message.replace("OpenAI API Error: ", ""),
    };
  }
  if (/authentication failed|api key/i.test(message)) {
    return {
      title: "OpenAI authentication failed",
      body: "La key configurada no ha sido aceptada por OpenAI. Revísala o pega una nueva.",
    };
  }
  if (/quota|rate limit/i.test(message)) {
    return {
      title: "OpenAI rechazó la petición",
      body: "La cuenta asociada a la key ha llegado a cuota o límite de velocidad. Reintenta más tarde o usa otra key.",
    };
  }
  return {
    title: "No se pudo generar",
    body: message,
  };
}

function formatSuggestionField(value?: string): string {
  return value?.trim() || "Any";
}

function formatAiSuggestionInputSummary(summary?: {
  niche?: string;
  audience?: string;
  tone?: string;
  transcriptVersionLabel?: string;
  subtitleVersionLabel?: string;
}): string {
  if (!summary) return "No input summary";

  return [
    `Niche: ${formatSuggestionField(summary.niche)}`,
    `Audience: ${formatSuggestionField(summary.audience)}`,
    `Tone: ${formatSuggestionField(summary.tone)}`,
    summary.transcriptVersionLabel ? `Transcript: ${summary.transcriptVersionLabel}` : "",
    summary.subtitleVersionLabel ? `Subtitles: ${summary.subtitleVersionLabel}` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

function SubtitlePreviewText({
  text,
  subtitleStyle,
  fontSizePx,
  lineHeightPx,
  borderWidthPx,
  shadowScale = 1,
  className,
}: {
  text: string;
  subtitleStyle: CreatorSubtitleStyleSettings;
  fontSizePx: number;
  lineHeightPx: number;
  borderWidthPx: number;
  shadowScale?: number;
  className?: string;
}) {
  const letterScale = Math.max(1, Math.min(1.5, subtitleStyle.letterWidth));
  const hasBackground = subtitleStyle.backgroundEnabled && subtitleStyle.backgroundOpacity > 0;

  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        maxWidth: "100%",
        transform: `scaleX(${letterScale})`,
        transformOrigin: "center center",
      }}
    >
      <span
        style={{
          display: "block",
          whiteSpace: "pre-line",
          textAlign: "center",
          fontSize: `${fontSizePx}px`,
          lineHeight: `${lineHeightPx}px`,
          fontWeight: 700,
          fontFamily: "var(--font-inter), 'Inter', sans-serif",
          color: subtitleStyle.textColor,
          WebkitTextStroke: `${borderWidthPx.toFixed(2)}px ${cssRgbaFromHex(subtitleStyle.borderColor, 0.95)}`,
          textShadow: cssTextShadowFromStyle(subtitleStyle, shadowScale),
          paintOrder: "stroke fill",
          background: hasBackground ? cssRgbaFromHex(subtitleStyle.backgroundColor, subtitleStyle.backgroundOpacity) : "transparent",
          borderRadius: hasBackground ? `${subtitleStyle.backgroundRadius * shadowScale}px` : undefined,
          padding: hasBackground
            ? `${subtitleStyle.backgroundPaddingY * shadowScale}px ${subtitleStyle.backgroundPaddingX * shadowScale}px`
            : undefined,
        }}
      >
        {text}
      </span>
    </span>
  );
}

async function readVideoMetadata(
  file: File,
  existingVideoEl?: HTMLVideoElement | null
): Promise<{ width: number; height: number; durationSeconds?: number }> {
  const existingWidth = existingVideoEl?.videoWidth ?? 0;
  const existingHeight = existingVideoEl?.videoHeight ?? 0;
  const existingDuration =
    existingVideoEl && Number.isFinite(existingVideoEl.duration) && existingVideoEl.duration > 0
      ? existingVideoEl.duration
      : undefined;

  if (existingWidth > 0 && existingHeight > 0 && typeof existingDuration === "number") {
    const duration = existingDuration;
    return { width: existingWidth, height: existingHeight, durationSeconds: duration };
  }

  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error("Failed to read source video metadata"));
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
    const width = video.videoWidth || existingWidth;
    const height = video.videoHeight || existingHeight;
    if (!width || !height) {
      throw new Error("Source video metadata missing dimensions");
    }
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : existingDuration;
    return { width, height, durationSeconds: duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const VIDEO_INFO_BLOCK_OPTIONS: Array<{
  value: CreatorVideoInfoBlock;
  label: string;
  description: string;
  accent: string;
}> = [
  {
    value: "titleIdeas",
    label: "Title Ideas",
    description: "Multiple headline options for the long-form upload.",
    accent: "text-cyan-200 border-cyan-300/20 bg-cyan-400/5",
  },
  {
    value: "description",
    label: "Description",
    description: "Primary description copy for the video page.",
    accent: "text-emerald-200 border-emerald-300/20 bg-emerald-400/5",
  },
  {
    value: "pinnedComment",
    label: "Pinned Comment",
    description: "Comment CTA copy for engagement and next action.",
    accent: "text-orange-200 border-orange-300/20 bg-orange-400/5",
  },
  {
    value: "hashtagsSeo",
    label: "Hashtags + SEO",
    description: "Hashtags and keyword helpers.",
    accent: "text-pink-200 border-pink-300/20 bg-pink-400/5",
  },
  {
    value: "thumbnailHooks",
    label: "Thumbnail Hooks",
    description: "Short lines for thumbnail text explorations.",
    accent: "text-fuchsia-200 border-fuchsia-300/20 bg-fuchsia-400/5",
  },
  {
    value: "chapters",
    label: "Chapters",
    description: "Timestamp list + chapter text block.",
    accent: "text-amber-200 border-amber-300/20 bg-amber-400/5",
  },
  {
    value: "contentPack",
    label: "Content Pack",
    description: "Summary, hooks, repurpose ideas, CTA ideas.",
    accent: "text-blue-200 border-blue-300/20 bg-blue-400/5",
  },
  {
    value: "insights",
    label: "Insights",
    description: "Metrics and topic-level signals.",
    accent: "text-violet-200 border-violet-300/20 bg-violet-400/5",
  },
];

function toggleBlock(list: CreatorVideoInfoBlock[], block: CreatorVideoInfoBlock): CreatorVideoInfoBlock[] {
  return list.includes(block) ? list.filter((value) => value !== block) : [...list, block];
}

type CreatorToolMode = "video_info" | "clip_lab";
type HubView = "start" | "ai_lab" | "editor";

type CreatorHubProps = {
  initialTool?: CreatorToolMode;
  lockedTool?: CreatorToolMode;
  projectId?: string;
  initialSourceAssetId?: string;
  initialView?: HubView;
  sourceAssetFallback?: {
    id: string;
    filename: string;
    durationSeconds?: number;
    projectId?: string;
  };
};

export function CreatorHub({
  initialTool = "video_info",
  lockedTool,
  projectId,
  initialSourceAssetId,
  initialView = "start",
  sourceAssetFallback,
}: CreatorHubProps = {}) {
  const { history, isLoading: isLoadingHistory, error: historyError, refresh } = useHistoryLibrary(projectId);
  const {
    shortsAnalysis,
    isGeneratingShorts,
    shortsError,
    generateShorts,
  } = useCreatorShortsGenerator();
  const {
    videoInfoAnalysis,
    isGeneratingVideoInfo,
    videoInfoError,
    generateVideoInfo,
  } = useCreatorVideoInfoGenerator();
  const {
    setLastRender,
  } = useCreatorShortRenderer();
  const {
    openAIApiKey,
    hasOpenAIApiKey,
    maskedOpenAIApiKey,
    saveOpenAIApiKey,
    clearOpenAIApiKey,
  } = useCreatorAiSettings();

  const [hubView, setHubView] = useState<HubView>(initialView);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialSourceAssetId ?? "");
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string>("");
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("");
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [openAIApiKeyDraft, setOpenAIApiKeyDraft] = useState("");
  const [isRegenerateAiSuggestionsDialogOpen, setIsRegenerateAiSuggestionsDialogOpen] = useState(false);

  const [niche, setNiche] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [activeTool, setActiveTool] = useState<CreatorToolMode>(lockedTool ?? initialTool);
  const [videoInfoBlocks, setVideoInfoBlocks] = useState<CreatorVideoInfoBlock[]>([
    "titleIdeas",
    "description",
    "chapters",
    "contentPack",
    "insights",
  ]);

  const [selectedClipId, setSelectedClipId] = useState<string>("");
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

  const [trimStartNudge, setTrimStartNudge] = useState(0);
  const [trimEndNudge, setTrimEndNudge] = useState(0);
  const [zoom, setZoom] = useState(1.15);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [subtitleXPositionPct, setSubtitleXPositionPct] = useState(50);
  const [subtitleYOffsetPct, setSubtitleYOffsetPct] = useState(78);
  const [subtitleStyleOverrides, setSubtitleStyleOverrides] = useState<Partial<CreatorSubtitleStyleSettings>>({});
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [activeSavedShortProjectId, setActiveSavedShortProjectId] = useState<string>("");
  const [detachedShortSelection, setDetachedShortSelection] = useState<{ clip: CreatorViralClip; plan: CreatorShortPlan } | null>(null);
  const [isExportingShort, setIsExportingShort] = useState(false);
  const [shortExportStage, setShortExportStage] = useState<BrowserRenderStage>("preparing");
  const [exportProgressPct, setExportProgressPct] = useState(0);
  const [localRenderError, setLocalRenderError] = useState<string | null>(null);
  const [localRenderDiagnostics, setLocalRenderDiagnostics] = useState<string | null>(null);
  const [shortProjectNameDraft, setShortProjectNameDraft] = useState("");

  const isToolLocked = !!lockedTool;
  const isVideoInfoPage = lockedTool === "video_info";
  const isShortsPage = lockedTool === "clip_lab";

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFilename, setMediaFilename] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isVideoMedia, setIsVideoMedia] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewFrameWidth, setPreviewFrameWidth] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewFrameElRef = useRef<HTMLDivElement | null>(null);
  const shortExportSessionCounterRef = useRef(0);
  const shortExportSessionRef = useRef<ActiveBrowserRenderSession | null>(null);
  const shortExportRestoreSnapshotRef = useRef<Pick<CreatorShortProjectRecord, "status" | "lastExportId" | "lastError"> | null>(null);
  // useCallback ref: stores element in previewFrameElRef AND sets up ResizeObserver for previewFrameWidth.
  const previewFrameRef = useCallback((el: HTMLDivElement | null) => {
    previewFrameElRef.current = el;
    if (!el) return;
    setPreviewFrameWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setPreviewFrameWidth(w);
    });
    ro.observe(el);
    // ResizeObserver is GC'd when the element is removed from the DOM.
  }, []);

  useEffect(() => {
    if (lockedTool && activeTool !== lockedTool) {
      setActiveTool(lockedTool);
    }
  }, [activeTool, lockedTool]);

  useEffect(() => {
    if (!initialSourceAssetId) return;
    setSelectedProjectId(initialSourceAssetId);
  }, [initialSourceAssetId]);

  const selectedProject = useMemo(() => {
    if (history.length) {
      return history.find((item) => item.id === selectedProjectId) ?? history[0];
    }
    if (!sourceAssetFallback) return undefined;
    if (selectedProjectId && selectedProjectId !== sourceAssetFallback.id) return undefined;
    return {
      id: sourceAssetFallback.id,
      mediaId: sourceAssetFallback.id,
      filename: sourceAssetFallback.filename,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timestamp: Date.now(),
      activeTranscriptVersionId: undefined,
      transcripts: [],
      projectId: sourceAssetFallback.projectId ?? projectId,
    } as HistoryItem & { projectId?: string };
  }, [history, projectId, selectedProjectId, sourceAssetFallback]);
  const selectedProjectRootId = (selectedProject as (HistoryItem & { projectId?: string }) | undefined)?.projectId ?? selectedProject?.id;
  const selectedSourceAssetId = selectedProject?.id;

  const {
    projects: shortProjects,
    manualProjects: savedShortProjects,
    aiSuggestionsByGeneration,
    exportsByProjectId,
    isLoading: isLoadingShortsLibrary,
    error: shortsLibraryError,
    upsertProject,
    upsertExport,
    deleteProject,
    deleteSuggestionGeneration,
    hasAiSuggestionsForSignature,
  } = useCreatorShortsLibrary(selectedProjectRootId);

  const beginShortExportSession = useCallback(() => {
    return createActiveBrowserRenderSession(++shortExportSessionCounterRef.current);
  }, []);

  const syncShortExportStage = useCallback((sessionId: number, stage: BrowserRenderStage) => {
    const session = shortExportSessionRef.current;
    if (!session || session.id !== sessionId) return;
    session.stage = stage;
    setShortExportStage(stage);
  }, []);

  const transcriptOptions = useMemo(() => {
    if (!selectedProject) return [];
    return sortTranscriptVersions(selectedProject.transcripts).slice().reverse();
  }, [selectedProject]);

  const effectiveTranscriptId = useMemo(() => {
    if (!selectedProject) return "";
    const explicit = selectedTranscriptId && selectedProject.transcripts.some((tx) => tx.id === selectedTranscriptId) ? selectedTranscriptId : "";
    return explicit || selectedProject.activeTranscriptVersionId || getLatestTranscript(selectedProject)?.id || "";
  }, [selectedProject, selectedTranscriptId]);

  const selectedTranscript = useMemo(() => {
    if (!selectedProject) return undefined;
    return getTranscriptById(selectedProject, effectiveTranscriptId);
  }, [effectiveTranscriptId, selectedProject]);

  const subtitleOptions = useMemo(() => {
    return sortSubtitleVersions(selectedTranscript?.subtitles ?? []).slice().reverse();
  }, [selectedTranscript]);

  const effectiveSubtitleId = useMemo(() => {
    if (!selectedTranscript) return "";
    if (selectedSubtitleId && selectedTranscript.subtitles.some((sub) => sub.id === selectedSubtitleId)) return selectedSubtitleId;

    const transcriptLang = selectedTranscript.detectedLanguage || selectedTranscript.requestedLanguage || "en";
    return (
      getLatestSubtitleForLanguage(selectedTranscript, transcriptLang)?.id ||
      selectedTranscript.subtitles.find((sub) => sub.kind === "original")?.id ||
      subtitleOptions[0]?.id ||
      ""
    );
  }, [selectedSubtitleId, selectedTranscript, subtitleOptions]);

  const selectedSubtitle = useMemo(() => {
    if (!selectedTranscript) return undefined;
    return getSubtitleById(selectedTranscript, effectiveSubtitleId) ?? subtitleOptions[0];
  }, [effectiveSubtitleId, selectedTranscript, subtitleOptions]);

  const sourceDurationSeconds = useMemo(() => {
    if (selectedProject && selectedTranscript) {
      return getTranscriptDurationSeconds(selectedProject, selectedTranscript.id);
    }
    return sourceAssetFallback?.durationSeconds;
  }, [selectedProject, selectedTranscript, sourceAssetFallback?.durationSeconds]);

  const manualFallbackClip = useMemo(() => {
    if (!selectedProject) return undefined;
    return createManualFallbackClip({
      sourceDurationSeconds,
      subtitleLanguage:
        selectedSubtitle?.language ||
        selectedTranscript?.detectedLanguage ||
        selectedTranscript?.requestedLanguage ||
        "en",
    });
  }, [selectedProject, selectedSubtitle?.language, selectedTranscript?.detectedLanguage, selectedTranscript?.requestedLanguage, sourceDurationSeconds]);

  const manualFallbackPlan = useMemo(() => {
    if (!manualFallbackClip) return undefined;
    return createManualFallbackPlan(manualFallbackClip.id);
  }, [manualFallbackClip]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadMedia() {
      if (!selectedProject) {
        setMediaUrl(null);
        setMediaFilename(null);
        setMediaFile(null);
        setIsVideoMedia(false);
        return;
      }

      try {
        const record = selectedSourceAssetId ? await db.projectAssets.get(selectedSourceAssetId) : undefined;
        if (cancelled) return;
        if (!record?.fileBlob) {
          setMediaUrl(null);
          setMediaFilename(null);
          setMediaFile(null);
          setIsVideoMedia(false);
          return;
        }
        objectUrl = URL.createObjectURL(record.fileBlob);
        setMediaUrl(objectUrl);
        setMediaFilename(record.fileBlob.name);
        setMediaFile(record.fileBlob);
        setIsVideoMedia(record.fileBlob.type.includes("video") || /\.(mp4|webm|mov|mkv)$/i.test(record.fileBlob.name));
      } catch (error) {
        console.error("Failed to load media preview", error);
        if (!cancelled) {
          setMediaUrl(null);
          setMediaFilename(null);
          setMediaFile(null);
          setIsVideoMedia(false);
        }
      }
    }

    void loadMedia();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedProject, selectedSourceAssetId]);

  useEffect(() => {
    setActiveSavedShortProjectId("");
    setDetachedShortSelection(null);
    setLocalRenderError(null);
    setLocalRenderDiagnostics(null);
    setExportProgressPct(0);
    setIsPlaying(false);
    setShortProjectNameDraft("");
    setSubtitleStyleOverrides({});
    setShowSubtitles(true);
  }, [selectedProject?.id]);

  // Video event callbacks — attached as JSX props on the <video>, no effect needed
  const handleVideoTimeUpdate = useCallback(() => {
    const video = previewVideoRef.current;
    if (video) setCurrentTime(video.currentTime);
  }, []);
  const handleVideoPlay = useCallback(() => setIsPlaying(true), []);
  const handleVideoPause = useCallback(() => {
    const video = previewVideoRef.current;
    if (video) setCurrentTime(video.currentTime);
    setIsPlaying(false);
  }, []);
  const handleVideoEnded = useCallback(() => setIsPlaying(false), []);

  const activeSavedShortProject = useMemo(() => {
    if (!shortProjects.length) return undefined;
    return shortProjects.find((item) => item.id === activeSavedShortProjectId) ?? undefined;
  }, [activeSavedShortProjectId, shortProjects]);

  const selectedClip = useMemo(() => {
    const analysisClips = shortsAnalysis?.viralClips ?? [];
    if (selectedClipId) {
      if (activeSavedShortProject?.clipId === selectedClipId) return activeSavedShortProject.clip;
      if (detachedShortSelection?.clip.id === selectedClipId) return detachedShortSelection.clip;
      const fromAnalysis = analysisClips.find((clip) => clip.id === selectedClipId);
      if (fromAnalysis) return fromAnalysis;
      if (manualFallbackClip?.id === selectedClipId) return manualFallbackClip;
    }
    return activeSavedShortProject?.clip ?? detachedShortSelection?.clip ?? analysisClips[0] ?? manualFallbackClip;
  }, [activeSavedShortProject, detachedShortSelection, manualFallbackClip, selectedClipId, shortsAnalysis]);

  const plansForSelectedClip = useMemo(() => {
    if (activeSavedShortProject?.plan && activeSavedShortProject.plan.clipId === selectedClip?.id) {
      return [activeSavedShortProject.plan];
    }
    if (detachedShortSelection?.plan && detachedShortSelection.plan.clipId === selectedClip?.id) {
      return [detachedShortSelection.plan];
    }
    if (shortsAnalysis?.shortsPlans?.length && selectedClip) {
      const fromAnalysis = shortsAnalysis.shortsPlans.filter((plan) => plan.clipId === selectedClip.id);
      if (fromAnalysis.length) return fromAnalysis;
    }
    if (manualFallbackPlan && selectedClip?.id === manualFallbackPlan.clipId) {
      return [manualFallbackPlan];
    }
    return [];
  }, [activeSavedShortProject?.plan, detachedShortSelection, manualFallbackPlan, selectedClip, shortsAnalysis]);

  const selectedPlan = useMemo(() => {
    if (plansForSelectedClip.length) {
      return plansForSelectedClip.find((plan) => plan.id === selectedPlanId) ?? plansForSelectedClip[0];
    }
    return activeSavedShortProject?.plan ?? detachedShortSelection?.plan ?? manualFallbackPlan;
  }, [activeSavedShortProject?.plan, detachedShortSelection, manualFallbackPlan, plansForSelectedClip, selectedPlanId]);

  const clipTextPreview = useMemo(() => {
    if (!selectedClip || !selectedSubtitle) return "";
    return summarizeClipText(selectedClip, selectedSubtitle.chunks);
  }, [selectedClip, selectedSubtitle]);

  const editedClip = useMemo(() => {
    if (!selectedClip) return undefined;
    return applyTrimNudgesToClip(selectedClip, {
      sourceDurationSeconds,
      trimStartNudge,
      trimEndNudge,
    });
  }, [selectedClip, sourceDurationSeconds, trimEndNudge, trimStartNudge]);

  useEffect(() => {
    if (!activeSavedShortProject || !selectedClip) return;
    if (selectedClip.id !== activeSavedShortProject.clipId) return;

    const { trimStartNudge: nextStartNudge, trimEndNudge: nextEndNudge } = deriveTrimNudgesFromSavedClip(
      selectedClip,
      activeSavedShortProject.clip
    );

    setTrimStartNudge((prev) => (Math.abs(prev - nextStartNudge) < 0.01 ? prev : nextStartNudge));
    setTrimEndNudge((prev) => (Math.abs(prev - nextEndNudge) < 0.01 ? prev : nextEndNudge));
  }, [activeSavedShortProject, selectedClip]);

  // Seek video to clip start when clip changes
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !editedClip) return;
    video.currentTime = editedClip.startSeconds;
    setCurrentTime(editedClip.startSeconds);
  }, [editedClip, mediaUrl]);

  // Enforce clip boundaries during playback
  useEffect(() => {
    if (!editedClip || !isPlaying) return;
    const video = previewVideoRef.current;
    if (!video) return;
    if (currentTime >= editedClip.endSeconds) {
      video.currentTime = editedClip.startSeconds;
    }
  }, [currentTime, editedClip, isPlaying]);

  const togglePlayPause = useCallback(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    if (video.paused) {
      if (editedClip && video.currentTime >= editedClip.endSeconds) {
        video.currentTime = editedClip.startSeconds;
      }
      void video.play();
    } else {
      video.pause();
    }
  }, [editedClip]);

  const toggleMute = useCallback(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  }, []);

  const selectedClipSubtitleChunks = useMemo(() => {
    if (!editedClip || !selectedSubtitle) return [];
    return clipSubtitleChunks(editedClip, selectedSubtitle.chunks);
  }, [editedClip, selectedSubtitle]);

  const activePreviewSubtitleChunk = useMemo(
    () => findSubtitleChunkAtTime(selectedClipSubtitleChunks, currentTime),
    [currentTime, selectedClipSubtitleChunks]
  );

  const resolvedSubtitleStyle = useMemo(() => {
    const fallback = selectedPlan?.editorPreset.subtitleStyle ?? "clean_caption";
    return resolveCreatorSubtitleStyle(fallback, subtitleStyleOverrides);
  }, [selectedPlan?.editorPreset.subtitleStyle, subtitleStyleOverrides]);

  const currentEditorState = useMemo<CreatorShortEditorState>(
    () => ({
      zoom,
      panX,
      panY,
      subtitleScale,
      subtitleXPositionPct,
      subtitleYOffsetPct,
      showSubtitles,
      subtitleStyle: subtitleStyleOverrides,
      showSafeZones,
    }),
    [panX, panY, showSafeZones, showSubtitles, subtitleScale, subtitleStyleOverrides, subtitleXPositionPct, subtitleYOffsetPct, zoom]
  );

  useEffect(() => {
    if (!activeSavedShortProject) return;
    setShortProjectNameDraft(activeSavedShortProject.origin === "ai_suggestion" ? "" : activeSavedShortProject.name || "");
  }, [activeSavedShortProject]);

  const autoGeneratedShortProjectName = useMemo(() => {
    if (!editedClip || !selectedPlan) return "";
    return `${platformLabel(selectedPlan.platform)} • ${secondsToClock(editedClip.startSeconds)}-${secondsToClock(editedClip.endSeconds)}`;
  }, [editedClip, selectedPlan]);

  const setEditedClipStartSeconds = useCallback(
    (nextStartSeconds: number) => {
      if (!selectedClip || !Number.isFinite(nextStartSeconds)) return;
      setTrimStartNudge(Number((nextStartSeconds - selectedClip.startSeconds).toFixed(2)));
    },
    [selectedClip]
  );

  const setEditedClipEndSeconds = useCallback(
    (nextEndSeconds: number) => {
      if (!selectedClip || !Number.isFinite(nextEndSeconds)) return;
      setTrimEndNudge(Number((nextEndSeconds - selectedClip.endSeconds).toFixed(2)));
    },
    [selectedClip]
  );

  const setEditedClipDurationSeconds = useCallback(
    (nextDurationSeconds: number) => {
      if (!editedClip || !Number.isFinite(nextDurationSeconds)) return;
      setEditedClipEndSeconds(editedClip.startSeconds + nextDurationSeconds);
    },
    [editedClip, setEditedClipEndSeconds]
  );

  const adjustEditedClipDurationSeconds = useCallback(
    (deltaSeconds: number) => {
      if (!editedClip || !Number.isFinite(deltaSeconds)) return;
      setEditedClipDurationSeconds(editedClip.durationSeconds + deltaSeconds);
    },
    [editedClip, setEditedClipDurationSeconds]
  );

  const savedExportsForActiveShort = useMemo(
    () => (activeSavedShortProject ? exportsByProjectId.get(activeSavedShortProject.id) ?? [] : []),
    [activeSavedShortProject, exportsByProjectId]
  );

  const selectedVideoInfoBlocks = useMemo(() => new Set(videoInfoBlocks), [videoInfoBlocks]);
  const showTitleIdeas = selectedVideoInfoBlocks.has("titleIdeas");
  const showDescription = selectedVideoInfoBlocks.has("description");
  const showPinnedComment = selectedVideoInfoBlocks.has("pinnedComment");
  const showHashtagsSeo = selectedVideoInfoBlocks.has("hashtagsSeo");
  const showThumbnailHooks = selectedVideoInfoBlocks.has("thumbnailHooks");
  const showChapters = selectedVideoInfoBlocks.has("chapters");
  const showContentPack = selectedVideoInfoBlocks.has("contentPack");
  const showInsights = selectedVideoInfoBlocks.has("insights");

  const canAnalyze = !!selectedProject && !!selectedTranscript && !!selectedSubtitle && !!selectedTranscript.transcript;
  const canAnalyzeWithAI = canAnalyze && hasOpenAIApiKey;
  const canRender = !!selectedProject && !!selectedTranscript && !!selectedSubtitle && !!editedClip && !!selectedPlan;
  const canExportVideo = canRender && !!mediaFile && isVideoMedia;
  const canCancelShortExport = isExportingShort && isBrowserRenderCancelableStage(shortExportStage);
  const activeAnalysisMeta = activeTool === "video_info" ? videoInfoAnalysis : shortsAnalysis;
  const isAnalyzing = activeTool === "video_info" ? isGeneratingVideoInfo : isGeneratingShorts;
  const analyzeError = activeTool === "video_info" ? videoInfoError : shortsError;
  const analyzeErrorDetails = getAnalyzeErrorDetails(analyzeError);
  const activeEditableShortProjectId = shouldReuseShortProjectId(activeSavedShortProject);

  const creatorSourcePayload = useMemo<CreatorGenerationSourceInput | null>(() => {
    if (!selectedProject || !selectedTranscript || !selectedSubtitle || !selectedTranscript.transcript) return null;

    return {
      transcriptText: selectedTranscript.transcript,
      transcriptChunks: selectedTranscript.chunks ?? [],
      subtitleChunks: selectedSubtitle.chunks,
      transcriptVersionLabel: selectedTranscript.label,
      subtitleVersionLabel: selectedSubtitle.label,
    };
  }, [selectedProject, selectedSubtitle, selectedTranscript]);

  const shortsRequestPayload = useMemo<CreatorShortsGenerateRequest | null>(() => {
    if (!creatorSourcePayload) return null;
    return {
      ...creatorSourcePayload,
      niche,
      audience,
      tone,
    };
  }, [audience, creatorSourcePayload, niche, tone]);

  const videoInfoRequestPayload = useMemo<CreatorVideoInfoGenerateRequest | null>(() => {
    if (!creatorSourcePayload) return null;
    return {
      ...creatorSourcePayload,
      videoInfoBlocks,
    };
  }, [creatorSourcePayload, videoInfoBlocks]);

  const aiSuggestionSourceSignature = useMemo(() => {
    if (!selectedProject || !selectedTranscript || !selectedSubtitle) return "";

    return buildAiSuggestionSourceSignature({
      projectId: selectedProjectRootId || selectedProject.id,
      sourceAssetId: selectedSourceAssetId || selectedProject.id,
      transcriptId: selectedTranscript.id,
      subtitleId: selectedSubtitle.id,
      niche,
      audience,
      tone,
    });
  }, [audience, niche, selectedProject, selectedProjectRootId, selectedSourceAssetId, selectedSubtitle, selectedTranscript, tone]);

  const matchingAiSuggestionGenerations = useMemo(() => {
    if (!aiSuggestionSourceSignature) return [];
    return aiSuggestionsByGeneration.filter((group) => group.sourceSignature === aiSuggestionSourceSignature);
  }, [aiSuggestionSourceSignature, aiSuggestionsByGeneration]);

  const defaultAiSuggestionEditorState = useMemo<CreatorShortEditorState>(
    () => ({
      zoom: 1.15,
      panX: 0,
      panY: 0,
      subtitleScale: 1,
      subtitleXPositionPct: 50,
      subtitleYOffsetPct: 78,
      showSubtitles: true,
      subtitleStyle: {},
      showSafeZones: true,
    }),
    []
  );

  const openAiSettingsDialog = useCallback(() => {
    setOpenAIApiKeyDraft(openAIApiKey);
    setIsAiSettingsOpen(true);
  }, [openAIApiKey]);

  const handleSaveOpenAIApiKey = useCallback(() => {
    const trimmed = openAIApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste an OpenAI API key first.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }

    saveOpenAIApiKey(trimmed);
    setIsAiSettingsOpen(false);
    toast.success("OpenAI key saved in this browser.", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  }, [openAIApiKeyDraft, saveOpenAIApiKey]);

  const handleClearOpenAIApiKey = useCallback(() => {
    clearOpenAIApiKey();
    setOpenAIApiKeyDraft("");
    toast.success("OpenAI key removed from this browser.", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  }, [clearOpenAIApiKey]);

  const handleGenerateVideoInfo = async () => {
    if (!videoInfoRequestPayload) return;
    if (!hasOpenAIApiKey) {
      openAiSettingsDialog();
      toast.error("Add your OpenAI API key to generate video info.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    if (videoInfoBlocks.length === 0) {
      toast.error("Select at least one video info block to generate.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    try {
      const result = await generateVideoInfo(videoInfoRequestPayload, { openAIApiKey });
      toast.success(`Video info generated (${result.providerMode})`, {
        className: "bg-green-500/20 border-green-500/50 text-green-100",
      });
    } catch (error) {
      console.error(error);
    }
  };

  const persistAiSuggestionGeneration = useCallback(
    async (result: Awaited<ReturnType<typeof generateShorts>>) => {
      if (!shortsRequestPayload || !selectedProject || !selectedTranscript || !selectedSubtitle) return 0;

      const now = Date.now();
      const records = buildAiSuggestionProjectRecords({
        analysis: result,
        now,
        generationId: makeId("aisuggeng"),
        projectId: selectedProjectRootId || selectedProject.id,
        sourceAssetId: selectedSourceAssetId || selectedProject.id,
        sourceFilename: mediaFilename || selectedProject.filename,
        transcriptId: selectedTranscript.id,
        subtitleId: selectedSubtitle.id,
        sourceSignature: aiSuggestionSourceSignature,
        inputSummary: buildAiSuggestionInputSummary({
          request: shortsRequestPayload,
          transcriptId: selectedTranscript.id,
          subtitleId: selectedSubtitle.id,
          model: result.model,
        }),
        editor: defaultAiSuggestionEditorState,
        savedRecords: shortProjects,
        newId: () => makeId("shortproj"),
        secondsToClock,
      });

      if (!records.length) return 0;
      await Promise.all(records.map((record) => upsertProject(record)));
      return records.length;
    },
    [
      aiSuggestionSourceSignature,
      defaultAiSuggestionEditorState,
      mediaFilename,
      selectedProject,
      selectedProjectRootId,
      selectedSourceAssetId,
      selectedSubtitle,
      selectedTranscript,
      shortsRequestPayload,
      shortProjects,
      upsertProject,
    ]
  );

  const runClipLabGeneration = useCallback(async () => {
    if (!shortsRequestPayload) return;
    if (!hasOpenAIApiKey) {
      openAiSettingsDialog();
      toast.error("Add your OpenAI API key to generate shorts.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    try {
      const result = await generateShorts(shortsRequestPayload, { openAIApiKey });
      const savedCount = await persistAiSuggestionGeneration(result);
      toast.success(`Clip lab generated (${result.providerMode})`, {
        className: "bg-green-500/20 border-green-500/50 text-green-100",
        description: savedCount > 0 ? `${savedCount} AI suggestion${savedCount === 1 ? "" : "s"} saved locally.` : undefined,
      });
    } catch (error) {
      console.error(error);
    }
  }, [generateShorts, hasOpenAIApiKey, openAIApiKey, openAiSettingsDialog, persistAiSuggestionGeneration, shortsRequestPayload]);

  const handleGenerateClipLab = async () => {
    if (matchingAiSuggestionGenerations.length > 0 || hasAiSuggestionsForSignature(aiSuggestionSourceSignature)) {
      setIsRegenerateAiSuggestionsDialogOpen(true);
      return;
    }

    await runClipLabGeneration();
  };

  const buildCurrentShortProjectRecord = useCallback(
    (
      status: CreatorShortProjectRecord["status"],
      options?: { id?: string; lastExportId?: string; lastError?: string; clipOverride?: CreatorViralClip }
    ): CreatorShortProjectRecord | null => {
      const effectiveClip = options?.clipOverride ?? editedClip;
      if (!selectedProject || !selectedTranscript || !selectedSubtitle || !effectiveClip || !selectedPlan) return null;
      return buildShortProjectRecord({
        status,
        now: Date.now(),
        newId: makeId("shortproj"),
        projectId: selectedProjectRootId || selectedProject.id,
        sourceAssetId: selectedSourceAssetId || selectedProject.id,
        sourceFilename: mediaFilename || selectedProject.filename,
        transcriptId: selectedTranscript.id,
        subtitleId: selectedSubtitle.id,
        clip: effectiveClip,
        plan: selectedPlan,
        editor: currentEditorState,
        savedRecords: shortProjects,
        explicitId: options?.id,
        explicitName: shortProjectNameDraft,
        lastExportId: options?.lastExportId,
        lastError: options?.lastError,
        secondsToClock,
      });
    },
    [
      currentEditorState,
      editedClip,
      mediaFilename,
      shortProjects,
      selectedPlan,
      selectedProject,
      selectedProjectRootId,
      selectedSourceAssetId,
      shortProjectNameDraft,
      selectedSubtitle,
      selectedTranscript,
    ]
  );

  const persistCanceledShortExportRestore = useCallback(() => {
    const nextProject = buildCurrentShortProjectRecord("draft", {
      id: activeEditableShortProjectId,
      lastExportId: shortExportRestoreSnapshotRef.current?.lastExportId,
      lastError: shortExportRestoreSnapshotRef.current?.lastError,
    });
    if (!nextProject) return;

    const restoredProject = restoreShortProjectAfterCanceledExport(nextProject, {
      now: Date.now(),
      previousProject: shortExportRestoreSnapshotRef.current,
    });

    setActiveSavedShortProjectId(restoredProject.id);
    setDetachedShortSelection({ clip: restoredProject.clip, plan: restoredProject.plan });
    setShortProjectNameDraft(restoredProject.name);
    void upsertProject(restoredProject).catch((error) => {
      console.error("Failed to persist canceled short export state", error);
    });
  }, [activeEditableShortProjectId, buildCurrentShortProjectRecord, upsertProject]);

  const handleCancelShortExport = useCallback(() => {
    const session = shortExportSessionRef.current;
    if (!session || !isBrowserRenderCancelableStage(session.stage)) return;

    session.controller.abort();
    resetFFmpeg();
    shortExportSessionRef.current = null;
    setIsExportingShort(false);
    setShortExportStage("preparing");
    setExportProgressPct(0);
    persistCanceledShortExportRestore();
    toast("Export canceled");
  }, [persistCanceledShortExportRestore]);

  const handleSaveShortProject = useCallback(async () => {
    const record = buildCurrentShortProjectRecord("draft", {
      id: activeEditableShortProjectId,
    });
    if (!record) {
      toast.error("Select a source with transcript + subtitles to save a short config.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }

    try {
      await upsertProject(record);
      setActiveSavedShortProjectId(record.id);
      setDetachedShortSelection({ clip: record.clip, plan: record.plan });
      setShortProjectNameDraft(record.name);
      toast.success("Short editor configuration saved", {
        className: "bg-green-500/20 border-green-500/50 text-green-100",
      });
    } catch (error) {
      console.error(error);
      toast.error("Failed to save short configuration", {
        className: "bg-red-500/20 border-red-500/50 text-red-100",
      });
    }
  }, [activeEditableShortProjectId, buildCurrentShortProjectRecord, upsertProject]);

  const applySavedShortProject = useCallback((project: CreatorShortProjectRecord) => {
    setActiveTool("clip_lab");
    setActiveSavedShortProjectId(project.id);
    setDetachedShortSelection({ clip: project.clip, plan: project.plan });
    setSelectedProjectId(project.sourceAssetId);
    setSelectedTranscriptId(project.transcriptId);
    setSelectedSubtitleId(project.subtitleId);
    setSelectedClipId(project.clipId);
    setSelectedPlanId(project.planId);
    setShortProjectNameDraft(project.origin === "ai_suggestion" ? "" : project.name || "");

    setTrimStartNudge(0);
    setTrimEndNudge(0);
    setZoom(project.editor.zoom);
    setPanX(project.editor.panX);
    setPanY(project.editor.panY);
    setSubtitleScale(project.editor.subtitleScale);
    setSubtitleXPositionPct(project.editor.subtitleXPositionPct ?? 50);
    setSubtitleYOffsetPct(project.editor.subtitleYOffsetPct);
    setSubtitleStyleOverrides(resolveCreatorSubtitleStyle(project.plan.editorPreset.subtitleStyle, project.editor.subtitleStyle));
    setShowSubtitles(project.editor.showSubtitles ?? true);
    setShowSafeZones(project.editor.showSafeZones ?? true);
  }, []);

  const handleDeleteShortProject = useCallback(
    async (project: CreatorShortProjectRecord) => {
      const exportCount = exportsByProjectId.get(project.id)?.length ?? 0;
      const confirmMessage =
        exportCount > 0
          ? `Delete "${project.name}" and its ${exportCount} saved export${exportCount === 1 ? "" : "s"}?`
          : project.origin === "ai_suggestion"
            ? `Delete AI suggestion "${project.name}"?`
            : `Delete "${project.name}"?`;

      if (!window.confirm(confirmMessage)) return;

      try {
        await deleteProject(project.id);

        if (activeSavedShortProjectId === project.id) {
          setActiveSavedShortProjectId("");
          setDetachedShortSelection({ clip: project.clip, plan: project.plan });
          setSelectedClipId(project.clipId);
          setSelectedPlanId(project.planId);
        }

        toast.success(project.origin === "ai_suggestion" ? "AI suggestion deleted" : "Saved short deleted", {
          className: "bg-green-500/20 border-green-500/50 text-green-100",
        });
      } catch (error) {
        console.error(error);
        toast.error(project.origin === "ai_suggestion" ? "Failed to delete AI suggestion" : "Failed to delete saved short", {
          className: "bg-red-500/20 border-red-500/50 text-red-100",
        });
      }
    },
    [activeSavedShortProjectId, deleteProject, exportsByProjectId]
  );

  const handleDeleteAiSuggestionGeneration = useCallback(
    async (generationId: string, generationLabel: string) => {
      if (!window.confirm(`Delete AI suggestion batch "${generationLabel}"?`)) return;

      try {
        await deleteSuggestionGeneration(generationId);
        if (activeSavedShortProject?.suggestionGenerationId === generationId) {
          setActiveSavedShortProjectId("");
          setDetachedShortSelection({ clip: activeSavedShortProject.clip, plan: activeSavedShortProject.plan });
          setSelectedClipId(activeSavedShortProject.clipId);
          setSelectedPlanId(activeSavedShortProject.planId);
        }
        toast.success("AI suggestion batch deleted", {
          className: "bg-green-500/20 border-green-500/50 text-green-100",
        });
      } catch (error) {
        console.error(error);
        toast.error("Failed to delete AI suggestion batch", {
          className: "bg-red-500/20 border-red-500/50 text-red-100",
        });
      }
    },
    [activeSavedShortProject, deleteSuggestionGeneration]
  );

  const handleDownloadSavedExport = useCallback((record: CreatorShortExportRecord) => {
    if (!record.fileBlob) {
      toast.error("This export record does not have a saved file blob.", {
        className: "bg-red-500/20 border-red-500/50 text-red-100",
      });
      return;
    }
    const url = URL.createObjectURL(record.fileBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = record.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleRenderShort = async () => {
    if (!selectedProject || !editedClip || !selectedPlan || !selectedTranscript || !selectedSubtitle) return;
    if (!mediaFile) {
      toast.error("Source media is unavailable. Reload the source file from history.", {
        className: "bg-red-500/20 border-red-500/50 text-red-100",
      });
      return;
    }
    if (!isVideoMedia) {
      toast.error("Local export currently requires a video source.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }

    const session = beginShortExportSession();
    shortExportSessionRef.current = session;
    shortExportRestoreSnapshotRef.current = activeSavedShortProject
      ? {
          status: activeSavedShortProject.status,
          lastExportId: activeSavedShortProject.lastExportId,
          lastError: activeSavedShortProject.lastError,
        }
      : null;
    setIsExportingShort(true);
    setShortExportStage(session.stage);
    setExportProgressPct(0);
    setLocalRenderError(null);
    setLocalRenderDiagnostics(null);
    const bumpExportProgress = (nextPct: number) => {
      setExportProgressPct((prev) => {
        const next = Math.round(clampNumber(nextPct, 0, 100));
        return next > prev ? next : prev;
      });
    };

    let sourceVideoMeta: { width: number; height: number; durationSeconds?: number } | null = null;
    let exportClip = editedClip;
    let exportSubtitleChunks = selectedClipSubtitleChunks;
    const buildDiagnosticsSnapshot = (errorMessage?: string) =>
      buildShortExportDiagnostics({
        sourceFilename: mediaFilename || selectedProject.filename,
        platform: selectedPlan.platform,
        requestedClip: editedClip,
        exportClip,
        sourceMeta: sourceVideoMeta,
        selectedSubtitleChunkCount: selectedClipSubtitleChunks.length,
        exportSubtitleChunkCount: exportSubtitleChunks.length,
        stylePreset: resolvedSubtitleStyle.preset,
        errorMessage,
      });

    try {
      sourceVideoMeta = await readVideoMetadata(mediaFile, previewVideoRef.current);
      if (shortExportSessionRef.current?.id !== session.id) return;
      console.info("[ShortExport] metadata loaded", sourceVideoMeta);
      const prepared = prepareShortExport({
        requestedClip: editedClip,
        allSubtitleChunks: selectedSubtitle.chunks,
        sourceDurationSeconds: sourceVideoMeta.durationSeconds,
        minClipDurationSeconds: 0.25,
      });
      exportClip = prepared.exportClip;
      exportSubtitleChunks = prepared.exportSubtitleChunks;

      if (prepared.clipAdjustedToSource) {
        toast(
          `Clip adjusted to media range: ${secondsToClock(exportClip.startSeconds)} → ${secondsToClock(exportClip.endSeconds)}.`,
          {
            className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
          }
        );
      }

      if (!prepared.durationValid) {
        throw new Error(prepared.validationError || "Selected clip is too short to export.");
      }
      console.info("[ShortExport] diagnostics pre-render\n" + buildDiagnosticsSnapshot());
    } catch (metadataError) {
      if (isBrowserRenderCanceledError(metadataError) || session.controller.signal.aborted) {
        if (shortExportSessionRef.current?.id === session.id) {
          shortExportSessionRef.current = null;
          shortExportRestoreSnapshotRef.current = null;
          setIsExportingShort(false);
          setShortExportStage("preparing");
        }
        return;
      }
      console.error(metadataError);
      const message = metadataError instanceof Error ? metadataError.message : "Failed to read source video metadata";
      setLocalRenderError(message);
      setLocalRenderDiagnostics(buildDiagnosticsSnapshot(message));
      toast.error(message, {
        className: "bg-red-500/20 border-red-500/50 text-red-100",
      });
      if (shortExportSessionRef.current?.id === session.id) {
        shortExportSessionRef.current = null;
        shortExportRestoreSnapshotRef.current = null;
        setIsExportingShort(false);
        setShortExportStage("preparing");
      }
      return;
    }

    let shortProjectRecord = buildCurrentShortProjectRecord("exporting", {
      id: activeEditableShortProjectId,
      clipOverride: exportClip,
    });
    if (!shortProjectRecord) {
      shortExportSessionRef.current = null;
      shortExportRestoreSnapshotRef.current = null;
      setIsExportingShort(false);
      setShortExportStage("preparing");
      return;
    }

    try {
      await upsertProject(shortProjectRecord);
      if (shortExportSessionRef.current?.id !== session.id) return;
      setActiveSavedShortProjectId(shortProjectRecord.id);
      setDetachedShortSelection({ clip: shortProjectRecord.clip, plan: shortProjectRecord.plan });
      setShortProjectNameDraft(shortProjectRecord.name);

      const sourceVideoSize = sourceVideoMeta
        ? { width: sourceVideoMeta.width, height: sourceVideoMeta.height }
        : await readVideoMetadata(mediaFile, previewVideoRef.current);
      if (shortExportSessionRef.current?.id !== session.id) return;
      const frameRect = previewFrameElRef.current?.getBoundingClientRect();
      const previewViewport = frameRect ? { width: frameRect.width, height: frameRect.height } : null;

      // NOTE: We intentionally pass null for previewVideoRect.
      // getBoundingClientRect() on a <video> with objectFit:"contain" returns
      // the full element box (including letterbox/pillarbox areas), not the
      // actual rendered video content rect. Using that rect causes
      // export-geometry to compute an incorrectly stretched scale.
      // The fallback path (source dimensions + editor zoom) is correct.

      const localExport = await exportShortVideoLocally({
        sourceFile: mediaFile,
        sourceFilename: mediaFilename || selectedProject.filename,
        clip: exportClip,
        plan: selectedPlan,
        subtitleChunks: exportSubtitleChunks,
        editor: currentEditorState,
        sourceVideoSize,
        previewViewport,
        previewVideoRect: null,
        onProgress: bumpExportProgress,
        renderLifecycle: {
          signal: session.controller.signal,
          onStageChange: (stage) => syncShortExportStage(session.id, stage),
        },
      });
      if (shortExportSessionRef.current?.id !== session.id) return;
      bumpExportProgress(97);

      const exportedVideoMetadata = await readVideoMetadata(localExport.file);
      if (shortExportSessionRef.current?.id !== session.id) return;
      const now = Date.now();
      const outputAsset = createEditorAssetRecord({
        projectId: selectedProjectRootId || selectedProject.id,
        role: "derived",
        origin: "short-export",
        derivedFromAssetId: selectedSourceAssetId || selectedProject.id,
        kind: "video",
        filename: localExport.file.name,
        mimeType: localExport.file.type || "video/mp4",
        sizeBytes: localExport.file.size,
        durationSeconds: exportedVideoMetadata.durationSeconds ?? exportClip.durationSeconds,
        width: exportedVideoMetadata.width,
        height: exportedVideoMetadata.height,
        hasAudio: true,
        sourceType: "upload",
        captionSource: { kind: "none" },
        fileBlob: localExport.file,
        now,
      });

      await db.transaction("rw", db.projects, db.projectAssets, async () => {
        await db.projectAssets.put(outputAsset);
        const rootProject = await db.projects.get(selectedProjectRootId || selectedProject.id);
        if (rootProject) {
          await db.projects.put({
            ...rootProject,
            assetIds: [...rootProject.assetIds, outputAsset.id],
            updatedAt: now,
            lastOpenedAt: now,
          });
        }
      });
      if (shortExportSessionRef.current?.id !== session.id) return;

      const exportRecord = buildCompletedShortExportRecord({
        id: makeId("shortexport"),
        shortProjectId: shortProjectRecord.id,
        projectId: selectedProjectRootId || selectedProject.id,
        sourceAssetId: selectedSourceAssetId || selectedProject.id,
        outputAssetId: outputAsset.id,
        sourceFilename: mediaFilename || selectedProject.filename,
        plan: selectedPlan,
        clip: exportClip,
        editor: currentEditorState,
        createdAt: now,
        filename: localExport.file.name,
        mimeType: localExport.file.type || "video/mp4",
        sizeBytes: localExport.file.size,
        fileBlob: localExport.file,
        debugFfmpegCommand: localExport.ffmpegCommandPreview,
        debugNotes: localExport.notes,
      });

      await upsertExport(exportRecord);
      if (shortExportSessionRef.current?.id !== session.id) return;
      bumpExportProgress(98);

      shortProjectRecord = markShortProjectExported(shortProjectRecord, {
        now: Date.now(),
        exportId: exportRecord.id,
      });
      await upsertProject(shortProjectRecord);
      if (shortExportSessionRef.current?.id !== session.id) return;
      bumpExportProgress(99);

      const renderResult = buildLocalBrowserRenderResponse({
        jobId: exportRecord.id,
        createdAt: exportRecord.createdAt,
        plan: selectedPlan,
        filename: exportRecord.filename,
        subtitleBurnedIn: localExport.subtitleBurnedIn,
        ffmpegCommandPreview: localExport.ffmpegCommandPreview,
        notes: localExport.notes,
      });
      syncShortExportStage(session.id, "complete");
      setLastRender(renderResult);

      handleDownloadSavedExport(exportRecord);
      bumpExportProgress(100);
      toast.success(`Short exported and saved (${formatBytes(exportRecord.sizeBytes)})`, {
        className: "bg-green-500/20 border-green-500/50 text-green-100",
      });
    } catch (error) {
      if (isBrowserRenderCanceledError(error) || session.controller.signal.aborted) {
        return;
      }

      console.error(error);
      const rawMessage = error instanceof Error ? error.message : "Short export failed";
      const toastMessage = rawMessage.split("\n")[0] || "Short export failed";
      const diagnostics = buildDiagnosticsSnapshot(rawMessage);
      setLocalRenderError(toastMessage);
      setLocalRenderDiagnostics(diagnostics);
      console.error("[ShortExport] failed diagnostics\n" + diagnostics);

      if (shortProjectRecord) {
        try {
          const failedProject = markShortProjectFailed(shortProjectRecord, {
            now: Date.now(),
            error: toastMessage,
          });
          await upsertProject(failedProject);
        } catch (persistErr) {
          console.error("Failed to persist short export error state", persistErr);
        }
      }

      toast.error(toastMessage, {
        className: "bg-red-500/20 border-red-500/50 text-red-100",
      });
    } finally {
      if (shortExportSessionRef.current?.id === session.id) {
        shortExportSessionRef.current = null;
        shortExportRestoreSnapshotRef.current = null;
        setIsExportingShort(false);
        setShortExportStage("preparing");
      }
    }
  };

  const previewSubtitleLine = useMemo(() => {
    if (!showSubtitles) return "";
    if (activePreviewSubtitleChunk) {
      return String(activePreviewSubtitleChunk.text ?? "").trim().slice(0, 100);
    }

    const isWithinClipBounds = !!editedClip && currentTime >= editedClip.startSeconds && currentTime <= editedClip.endSeconds;
    const hasMovedAwayFromClipStart = !!editedClip && Math.abs(currentTime - editedClip.startSeconds) > 0.05;
    if (selectedClipSubtitleChunks.length > 0 && isWithinClipBounds && (isPlaying || hasMovedAwayFromClipStart)) {
      return "";
    }

    if (!clipTextPreview) return "Add subtitles + punchy hook text";
    return clipTextPreview.split(/(?<=[.!?])\s+/)[0]?.slice(0, 80) || clipTextPreview.slice(0, 80);
  }, [activePreviewSubtitleChunk, clipTextPreview, currentTime, editedClip, isPlaying, selectedClipSubtitleChunks.length, showSubtitles]);

  const previewSubtitleDisplayLine = useMemo(() => {
    if (!previewSubtitleLine) return "";
    return resolvedSubtitleStyle.textCase === "uppercase" ? previewSubtitleLine.toUpperCase() : previewSubtitleLine;
  }, [previewSubtitleLine, resolvedSubtitleStyle.textCase]);

  const previewWrappedSubtitleLine = useMemo(() => {
    if (!previewSubtitleDisplayLine) return "";
    // Use the exact same fontSize + maxCharsPerLine formula as FFmpeg export so wrapping matches 1:1.
    const fontSize = Math.round(clampNumber(56 * subtitleScale, 36, 96));
    const maxCharsPerLine = getSubtitleMaxCharsPerLine(fontSize, resolvedSubtitleStyle.letterWidth, 1080);
    return wrapSubtitleLines(previewSubtitleDisplayLine, maxCharsPerLine).join("\n");
  }, [previewSubtitleDisplayLine, resolvedSubtitleStyle.letterWidth, subtitleScale]);

  // Export-equivalent font size (px at 1080-wide canvas) – used to derive preview CSS values.
  const exportFontSize = Math.round(clampNumber(56 * subtitleScale, 36, 96));

  const clipProgressPct = useMemo(() => {
    if (!editedClip) return 0;
    const elapsed = currentTime - editedClip.startSeconds;
    const duration = editedClip.durationSeconds;
    if (duration <= 0) return 0;
    return Math.min(100, Math.max(0, (elapsed / duration) * 100));
  }, [currentTime, editedClip]);

  const topBadgeLabel = isVideoInfoPage ? "Video Info Studio" : isShortsPage ? "Shorts Forge" : "Creator Tool Bench";
  const pageHeading = isVideoInfoPage ? "Packaging Lab" : isShortsPage ? "Shorts Forge" : "Content Engine";
  const pageDescription = isVideoInfoPage
    ? "Generate long-form titles, descriptions, chapters, hooks, and SEO blocks on a dedicated page. No clip tools mixed in."
    : isShortsPage
      ? ""
      : "Use your transcript as a source asset. Run only the tool you need: video info generation or clip lab + vertical editor.";

  return (
    <main
      className={cn(
        "min-h-screen w-full relative py-10 px-4 sm:px-6 lg:px-8",
        isVideoInfoPage && "bg-[radial-gradient(circle_at_20%_10%,rgba(16,185,129,0.12),transparent_40%),radial-gradient(circle_at_85%_15%,rgba(34,211,238,0.15),transparent_45%),#06090a]",
        isShortsPage && "bg-[radial-gradient(circle_at_12%_8%,rgba(244,114,182,0.14),transparent_40%),radial-gradient(circle_at_88%_12%,rgba(251,146,60,0.16),transparent_45%),#090607]"
      )}
    >
      <div className="fixed inset-0 pointer-events-none">
        <div
          className={cn(
            "absolute -top-20 left-[6%] w-[34rem] h-[34rem] rounded-full blur-[120px]",
            isVideoInfoPage ? "bg-emerald-400/14" : isShortsPage ? "bg-fuchsia-500/14" : "bg-cyan-500/10"
          )}
        />
        <div
          className={cn(
            "absolute top-[35%] right-[4%] w-[28rem] h-[28rem] rounded-full blur-[130px]",
            isVideoInfoPage ? "bg-cyan-400/12" : isShortsPage ? "bg-orange-500/14" : "bg-orange-500/10"
          )}
        />
        <div
          className={cn(
            "absolute bottom-[-6rem] left-[32%] w-[32rem] h-[32rem] rounded-full blur-[150px]",
            isVideoInfoPage ? "bg-teal-300/8" : isShortsPage ? "bg-rose-400/8" : "bg-emerald-500/5"
          )}
        />
        <div
          className={cn(
            "absolute inset-0 opacity-15 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_40%,#000_70%,transparent_100%)]",
            isShortsPage
              ? "bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:44px_44px]"
              : "bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:56px_56px]"
          )}
        />
      </div>

      <div className="relative z-10 w-full space-y-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.22em]",
                isVideoInfoPage
                  ? "border border-emerald-300/25 bg-gradient-to-r from-emerald-400/10 to-cyan-400/10 text-emerald-100/80"
                  : isShortsPage
                    ? "border border-orange-300/25 bg-gradient-to-r from-orange-400/10 to-fuchsia-400/10 text-orange-100/80"
                    : "border border-cyan-300/20 bg-gradient-to-r from-cyan-400/10 to-orange-400/10 text-cyan-100/70"
              )}
            >
              <Rocket className="w-3.5 h-3.5" /> {topBadgeLabel}
            </div>
            <h1
              className={cn(
                "text-4xl md:text-5xl font-black tracking-tight text-transparent bg-clip-text",
                isVideoInfoPage
                  ? "bg-gradient-to-r from-emerald-200 via-cyan-100 to-white"
                  : isShortsPage
                    ? "bg-gradient-to-r from-orange-200 via-rose-100 to-fuchsia-200"
                    : "bg-gradient-to-r from-cyan-200 via-white to-orange-200"
              )}
            >
              {pageHeading}
            </h1>
            <p className="text-white/60 max-w-3xl">
              {pageDescription}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isToolLocked && (
              <Link href="/creator">
                <Button
                  variant="ghost"
                  className={cn(
                    "text-white/85 border",
                    isVideoInfoPage
                      ? "bg-emerald-400/8 border-emerald-300/20 hover:bg-emerald-300/12"
                      : "bg-orange-400/8 border-orange-300/20 hover:bg-orange-300/12"
                  )}
                >
                  <Sparkles className="w-4 h-4 mr-2" /> Tool Hub
                </Button>
              </Link>
            )}
            {isToolLocked && (
              <Link href={isVideoInfoPage ? "/creator/shorts" : "/creator/video-info"}>
                <Button
                  variant="ghost"
                  className={cn(
                    "text-white/85 border",
                    isVideoInfoPage
                      ? "bg-white/5 border-cyan-300/20 hover:bg-cyan-400/10"
                      : "bg-white/5 border-fuchsia-300/20 hover:bg-fuchsia-400/10"
                  )}
                >
                  {isVideoInfoPage ? (
                    <>
                      <Clapperboard className="w-4 h-4 mr-2" /> Shorts Page
                    </>
                  ) : (
                    <>
                      <Lightbulb className="w-4 h-4 mr-2" /> Info Page
                    </>
                  )}
                </Button>
              </Link>
            )}
            <Link href="/">
              <Button variant="ghost" className="bg-white/5 hover:bg-white/10 text-white/80">
                <ArrowLeft className="w-4 h-4 mr-2" /> Home
              </Button>
            </Link>
            <Link href="/history">
              <Button variant="ghost" className="bg-white/5 hover:bg-white/10 text-white/80">
                <Layers className="w-4 h-4 mr-2" /> History
              </Button>
            </Link>
          </div>
        </div>

        <div className="w-full">
          <Card className="bg-white/[0.03] border-white/10 text-white shadow-2xl backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <FileVideo className="w-5 h-5 text-cyan-300" /> Source + Tool Controls
              </CardTitle>
              <CardDescription className="text-white/50">
                {isToolLocked
                  ? isVideoInfoPage
                    ? "Select a transcript/subtitle source and generate only packaging outputs on this page. Use the hub to switch into shorts production."
                    : ""
                  : "Pick the transcript/subtitle source once, then run either tool independently. Video info supports scoped output blocks."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wider text-white/50">AI Provider</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-100">
                          OpenAI
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-1",
                            hasOpenAIApiKey
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                              : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                          )}
                        >
                          {hasOpenAIApiKey ? `Key ${maskedOpenAIApiKey}` : "Key missing"}
                        </span>
                      </div>
                      <div className="text-xs text-white/45">Se guarda solo en este navegador y se envía por request al backend.</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="bg-white/5 text-white/85 hover:bg-white/10"
                      onClick={openAiSettingsDialog}
                    >
                      <KeyRound className="mr-2 h-4 w-4" />
                      {hasOpenAIApiKey ? "Update API Key" : "Add API Key"}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Project</label>
                  <Select
                    value={selectedProject?.id ?? ""}
                    onValueChange={(value) => {
                      setSelectedProjectId(value);
                      setSelectedTranscriptId("");
                      setSelectedSubtitleId("");
                    }}
                    disabled={isLoadingHistory || history.length === 0}
                  >
                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                      <SelectValue placeholder={isLoadingHistory ? "Loading projects..." : "Select project"} />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                      {history.map((item) => (
                        <SelectItem key={item.id} value={item.id} className="focus:bg-cyan-500/20 cursor-pointer">
                          {item.filename} ({item.transcripts.length} transcript{item.transcripts.length === 1 ? "" : "s"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Transcript Version</label>
                    <Select
                      value={effectiveTranscriptId}
                      onValueChange={(value) => {
                        setSelectedTranscriptId(value);
                        setSelectedSubtitleId("");
                      }}
                      disabled={!selectedProject || transcriptOptions.length === 0}
                    >
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                        <SelectValue placeholder="Select transcript version" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                        {transcriptOptions.map((tx) => (
                          <SelectItem key={tx.id} value={tx.id} className="focus:bg-cyan-500/20 cursor-pointer">
                            {tx.label} • {tx.status} • {new Date(tx.createdAt).toLocaleString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Subtitle Version</label>
                    <Select value={effectiveSubtitleId} onValueChange={setSelectedSubtitleId} disabled={!selectedTranscript || subtitleOptions.length === 0}>
                      <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                        <SelectValue placeholder="Select subtitle version" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                        {subtitleOptions.map((sub) => (
                          <SelectItem key={sub.id} value={sub.id} className="focus:bg-cyan-500/20 cursor-pointer">
                            {subtitleVersionLabel(sub)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Niche (Optional)</label>
                    <input
                      value={niche}
                      placeholder="e.g. Creator tools / workflow"
                      onChange={(e) => setNiche(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Audience (Optional)</label>
                    <input
                      value={audience}
                      placeholder="e.g. Content creators..."
                      onChange={(e) => setAudience(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Tone (Optional)</label>
                    <input
                      value={tone}
                      placeholder="e.g. Sharp, practical..."
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
                  {!isToolLocked && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTool("video_info")}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left transition-colors",
                          activeTool === "video_info"
                            ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        )}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Lightbulb className="w-4 h-4" />
                          Video Info Generator
                        </div>
                        <div className="text-xs opacity-80 mt-1">Titles, description, hashtags, chapters, content notes, insights</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTool("clip_lab")}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left transition-colors",
                          activeTool === "clip_lab"
                            ? "border-orange-300/40 bg-orange-400/10 text-orange-100"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        )}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Flame className="w-4 h-4" />
                          Clip Lab + Editor
                        </div>
                        <div className="text-xs opacity-80 mt-1">Viral clips, shorts plans, vertical framing, mock render</div>
                      </button>
                    </div>
                  )}



                  {activeTool === "video_info" && (
                    <div className="space-y-3">
                      <div className="text-xs uppercase tracking-wider text-white/50">
                        Output blocks (generate only what you need)
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {VIDEO_INFO_BLOCK_OPTIONS.map((option) => {
                          const enabled = selectedVideoInfoBlocks.has(option.value);
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setVideoInfoBlocks((prev) => toggleBlock(prev, option.value))}
                              className={cn(
                                "rounded-xl border p-3 text-left transition-colors",
                                enabled
                                  ? `border-white/10 ${option.accent}`
                                  : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-semibold">{option.label}</div>
                                <div
                                  className={cn(
                                    "h-4 w-4 rounded border transition-colors",
                                    enabled ? "bg-white/90 border-white/90" : "border-white/30 bg-transparent"
                                  )}
                                />
                              </div>
                              <div className="text-xs opacity-80 mt-1 leading-relaxed">{option.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {activeTool === "video_info" && (
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-block cursor-not-allowed">
                              <Button
                                onClick={handleGenerateVideoInfo}
                                disabled={!canAnalyzeWithAI || isAnalyzing || videoInfoBlocks.length === 0}
                                className="text-black font-semibold bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300"
                                style={{ pointerEvents: (!canAnalyzeWithAI || isAnalyzing || videoInfoBlocks.length === 0) ? 'none' : 'auto' }}
                              >
                                {isAnalyzing ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <WandSparkles className="w-4 h-4 mr-2" />
                                )}
                                Generate Video Info
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {(!canAnalyzeWithAI || isAnalyzing || videoInfoBlocks.length === 0) && (
                            <TooltipContent>
                              {!canAnalyzeWithAI ? "Please configure your OpenAI API key in settings" : videoInfoBlocks.length === 0 ? "Select at least one info block" : "Generating..."}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <Button variant="ghost" onClick={() => void refresh()} className="bg-white/5 hover:bg-white/10 text-white/80">
                      Refresh Media Library
                    </Button>
                    {activeAnalysisMeta && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-white/70">
                        Provider: {activeAnalysisMeta.providerMode} · {activeAnalysisMeta.model}
                      </span>
                    )}
                  </div>
                </div>

                {historyError && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{historyError}</div>}
                {analyzeErrorDetails && (
                  <Alert className="border-red-500/20 bg-red-500/10 text-red-100">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle className="text-red-100">{analyzeErrorDetails.title}</AlertTitle>
                    <AlertDescription className="text-red-100/85">{analyzeErrorDetails.body}</AlertDescription>
                  </Alert>
                )}
                {!historyError && !isLoadingHistory && history.length === 0 && (
                  <div className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                    No transcription projects found yet. Transcribe a file first, then come back to build creator assets.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>


        </div>

        {(videoInfoAnalysis || activeTool === "clip_lab") && (
          <>
            {activeTool === "video_info" && videoInfoAnalysis && (
            <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.95fr] gap-6 items-start">
              <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-cyan-300" /> YouTube Content Pack</CardTitle>
                  <CardDescription className="text-white/50">
                    Copy-ready packaging generated from transcript + timed chunks.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {!showTitleIdeas && !showDescription && !showHashtagsSeo && !showPinnedComment && !showThumbnailHooks && (
                    <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-sm text-white/60">
                      No video info blocks selected. Enable blocks above and run the generator.
                    </div>
                  )}

                  {showTitleIdeas && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <label className="text-xs uppercase tracking-wider text-white/50">Title Ideas</label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-white/70 hover:bg-white/10"
                          onClick={() => copyText(videoInfoAnalysis.youtube.titleIdeas.join("\n"), "Title ideas")}
                        >
                          <Copy className="w-4 h-4 mr-2" /> Copy
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {videoInfoAnalysis.youtube.titleIdeas.map((title, index) => (
                          <button
                            key={`${index}-${title}`}
                            onClick={() => copyText(title, `Title #${index + 1}`)}
                            className="w-full text-left rounded-xl border border-white/10 bg-black/20 hover:bg-black/30 transition-colors p-3 text-sm text-white/90"
                          >
                            <span className="text-cyan-300/80 mr-2">{index + 1}.</span>
                            {title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {showDescription && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <label className="text-xs uppercase tracking-wider text-white/50">Description</label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-white/70 hover:bg-white/10"
                          onClick={() => copyText(videoInfoAnalysis.youtube.description, "Description")}
                        >
                          <Copy className="w-4 h-4 mr-2" /> Copy
                        </Button>
                      </div>
                      <textarea
                        readOnly
                        value={videoInfoAnalysis.youtube.description}
                        className="w-full h-56 rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-white/85 leading-relaxed"
                      />
                    </div>
                  )}

                  {(showHashtagsSeo || showPinnedComment || showThumbnailHooks) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {showHashtagsSeo && (
                        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                          <div className="text-xs uppercase tracking-wider text-white/50">Hashtags + SEO</div>
                          <div className="flex flex-wrap gap-2">
                            {videoInfoAnalysis.youtube.hashtags.map((tag) => (
                              <button
                                key={tag}
                                onClick={() => copyText(tag, "Hashtag")}
                                className="px-2.5 py-1 rounded-full border border-cyan-300/20 bg-cyan-400/5 text-cyan-100 text-xs hover:bg-cyan-400/10"
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                          <div className="text-xs text-white/60 leading-relaxed">
                            Keywords: {videoInfoAnalysis.youtube.seoKeywords.join(", ")}
                          </div>
                        </div>
                      )}

                      {(showPinnedComment || showThumbnailHooks) && (
                        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                          <div className="text-xs uppercase tracking-wider text-white/50">
                            {showPinnedComment && showThumbnailHooks
                              ? "Pinned Comment + Thumbnail Hooks"
                              : showPinnedComment
                                ? "Pinned Comment"
                                : "Thumbnail Hooks"}
                          </div>
                          {showPinnedComment && (
                            <button
                              onClick={() => copyText(videoInfoAnalysis.youtube.pinnedComment, "Pinned comment")}
                              className="w-full text-left rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 p-3 text-sm text-white/85"
                            >
                              {videoInfoAnalysis.youtube.pinnedComment}
                            </button>
                          )}
                          {showThumbnailHooks && (
                            <div className="grid grid-cols-1 gap-2">
                              {videoInfoAnalysis.youtube.thumbnailHooks.map((hook) => (
                                <button
                                  key={hook}
                                  onClick={() => copyText(hook, "Thumbnail hook")}
                                  className="text-left text-xs rounded-md border border-white/10 bg-black/20 p-2 text-orange-100/90 hover:bg-black/30"
                                >
                                  {hook}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                {!showChapters && !showContentPack && !showInsights && (
                  <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                    <CardContent className="p-6 text-sm text-white/60">
                      This column is empty because <code className="text-white">Chapters</code>, <code className="text-white">Content Pack</code>,
                      and <code className="text-white">Insights</code> are all disabled in the Video Info Generator config.
                    </CardContent>
                  </Card>
                )}

                {showChapters && (
                  <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-orange-300" /> Time Marks / Chapters</CardTitle>
                      <CardDescription className="text-white/50">Copy these directly into your YouTube description.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="bg-white/5 hover:bg-white/10 text-white/80"
                          onClick={() => copyText(buildYouTubeTimestamps(videoInfoAnalysis.chapters), "YouTube timestamps")}
                        >
                          <Copy className="w-4 h-4 mr-2" /> Copy timestamps
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="bg-white/5 hover:bg-white/10 text-white/80"
                          onClick={() => copyText(videoInfoAnalysis.youtube.chapterText, "Chapter block")}
                        >
                          <Copy className="w-4 h-4 mr-2" /> Copy chapter block
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-80 overflow-auto pr-1">
                        {videoInfoAnalysis.chapters.map((chapter) => (
                          <div key={chapter.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="text-sm font-medium text-white/90">{secondsToClock(chapter.timeSeconds)} {chapter.label}</div>
                            <div className="text-xs text-white/50 mt-1">{chapter.reason}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(showContentPack || showInsights) && (
                  <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><Film className="w-5 h-5 text-emerald-300" /> Insights + Repurpose Strategy</CardTitle>
                      <CardDescription className="text-white/50">
                        {showContentPack && showInsights
                          ? "AI content notes plus transcript-level signals."
                          : showContentPack
                            ? "AI content notes to plan posts beyond one upload."
                            : "Transcript-level metrics and theme signals."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {showContentPack && (
                        <>
                          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-white/80 leading-relaxed">
                            {videoInfoAnalysis.content.videoSummary}
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                            <div className="text-xs uppercase tracking-wider text-white/50 mb-2">Hook Ideas</div>
                            <ul className="space-y-2 text-white/80">
                              {videoInfoAnalysis.content.hookIdeas.map((hook) => (
                                <li key={hook} className="text-sm">• {hook}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                            <div className="text-xs uppercase tracking-wider text-white/50 mb-2">Repurpose Ideas</div>
                            <ul className="space-y-2 text-white/80">
                              {videoInfoAnalysis.content.repurposeIdeas.map((idea) => (
                                <li key={idea} className="text-sm">• {idea}</li>
                              ))}
                            </ul>
                          </div>
                        </>
                      )}

                      {showInsights && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">Words: <span className="text-cyan-200">{videoInfoAnalysis.insights.transcriptWordCount}</span></div>
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3">WPM: <span className="text-cyan-200">{videoInfoAnalysis.insights.estimatedSpeakingRateWpm}</span></div>
                          <div className="rounded-lg border border-white/10 bg-black/20 p-3 col-span-2">Theme: <span className="text-white/90">{videoInfoAnalysis.insights.detectedTheme}</span></div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
            )}

            {activeTool === "clip_lab" && hubView === "start" && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                  <Card 
                    className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl cursor-pointer hover:bg-white/5 transition-colors group relative overflow-hidden"
                    onClick={() => {
                      if (!manualFallbackClip || !manualFallbackPlan) {
                        toast.error("Select a source asset first.");
                        return;
                      }
                      setActiveSavedShortProjectId("");
                      setDetachedShortSelection(null);
                      setSelectedClipId(manualFallbackClip.id);
                      setSelectedPlanId(manualFallbackPlan.id);
                      setShortProjectNameDraft("");
                      setTrimStartNudge(0);
                      setTrimEndNudge(0);
                      setHubView("editor");
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader>
                      <CardTitle className="text-2xl font-bold flex items-center gap-2">
                        ✂️ Manual Edit
                      </CardTitle>
                      <CardDescription className="text-white/60 text-base mt-2 leading-relaxed">
                        Jump straight into the editor with your full video. Perfect for when you already know what you want to cut.
                      </CardDescription>
                    </CardHeader>
                  </Card>

                  <Card 
                    className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl cursor-pointer hover:bg-white/5 transition-colors group relative overflow-hidden"
                    onClick={() => setHubView("ai_lab")}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/10 to-orange-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader>
                      <CardTitle className="text-2xl font-bold flex items-center gap-2">
                        ✨ AI Magic Clips
                      </CardTitle>
                      <CardDescription className="text-white/60 text-base mt-2 leading-relaxed">
                        Let AI analyze your transcript and suggest the most viral, engaging moments based on your defined niche and tone.
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </div>
                
                {/* Saved Shorts Gallery */}
                {!isLoadingShortsLibrary && savedShortProjects.length > 0 && (
                  <div className="space-y-4 mt-8">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-white/90">Your Saved Shorts</h3>
                      <span className="text-xs text-white/50">{savedShortProjects.length} preset{savedShortProjects.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {savedShortProjects.map((project) => {
                        const exportCount = (exportsByProjectId.get(project.id) ?? []).length;
                        return (
                          <div
                            key={project.id}
                            onClick={() => {
                              applySavedShortProject(project);
                              setHubView("editor");
                            }}
                            className="rounded-xl border border-white/10 bg-black/20 hover:bg-white/5 cursor-pointer transition-colors p-5 group relative overflow-hidden"
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="relative">
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="text-base font-semibold text-white/90 line-clamp-2 leading-snug">{project.name}</div>
                                <div className="text-10px uppercase tracking-wider bg-emerald-500/10 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-500/20 whitespace-nowrap">{platformLabel(project.platform)}</div>
                              </div>
                              <div className="text-xs text-white/50 font-medium mb-4">
                                {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)}
                              </div>
                              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                                <div className="text-[11px] text-white/40">{new Date(project.updatedAt).toLocaleDateString()}</div>
                                {exportCount > 0 ? (
                                  <div className="flex items-center gap-1.5 text-[11px] text-white/60 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                                    <Download className="w-3 h-3" />
                                    <span>{exportCount} file{exportCount === 1 ? '' : 's'}</span>
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-white/30 italic">Not exported yet</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!isLoadingShortsLibrary && aiSuggestionsByGeneration.length > 0 && (
                  <div className="space-y-4 mt-8">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold text-white/90">AI Suggestions</h3>
                      <span className="text-xs text-white/50">
                        {aiSuggestionsByGeneration.reduce((total, group) => total + group.projects.length, 0)} suggestion
                        {aiSuggestionsByGeneration.reduce((total, group) => total + group.projects.length, 0) === 1 ? "" : "s"} in{" "}
                        {aiSuggestionsByGeneration.length} batch{aiSuggestionsByGeneration.length === 1 ? "" : "es"}
                      </span>
                    </div>

                    <div className="space-y-4">
                      {aiSuggestionsByGeneration.map((group) => (
                        <div key={group.generationId} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-fuchsia-100">
                                  AI
                                </span>
                                <span className="text-sm font-semibold text-white/90">
                                  {new Date(group.generatedAt).toLocaleString()}
                                </span>
                                <span className="text-xs text-white/45">
                                  {group.projects.length} suggestion{group.projects.length === 1 ? "" : "s"}
                                </span>
                              </div>
                              <div className="text-xs leading-relaxed text-white/55">
                                {formatAiSuggestionInputSummary(group.inputSummary)}
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="bg-white/5 text-white/75 hover:bg-red-500/15 hover:text-red-100"
                              onClick={() =>
                                void handleDeleteAiSuggestionGeneration(
                                  group.generationId,
                                  new Date(group.generatedAt).toLocaleString()
                                )
                              }
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete batch
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {group.projects.map((project) => (
                              <div
                                key={project.id}
                                onClick={() => {
                                  applySavedShortProject(project);
                                  setHubView("editor");
                                }}
                                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/5 cursor-pointer"
                              >
                                <div className="mb-2 flex items-start justify-between gap-3">
                                  <div className="text-sm font-semibold leading-snug text-white/90">{project.plan.title}</div>
                                  <div className="rounded-full border border-orange-400/20 bg-orange-400/10 px-2 py-1 text-[10px] uppercase tracking-wide text-orange-100">
                                    {platformLabel(project.platform)}
                                  </div>
                                </div>
                                <div className="mb-2 text-xs font-medium text-white/50">
                                  {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)}
                                </div>
                                <div className="mb-3 line-clamp-3 text-xs leading-relaxed text-white/60">{project.clip.reason}</div>
                                <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                                  <div className="text-[11px] text-white/40">Score {project.clip.score}</div>
                                  <Button
                                    type="button"
                                    size="icon-xs"
                                    variant="ghost"
                                    className="shrink-0 bg-white/5 hover:bg-red-500/15 text-white/50 hover:text-red-200"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteShortProject(project);
                                    }}
                                    title={`Delete ${project.name}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTool === "clip_lab" && hubView === "ai_lab" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10 -ml-3" onClick={() => setHubView("start")}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block cursor-not-allowed">
                          <Button
                            onClick={handleGenerateClipLab}
                            disabled={!canAnalyzeWithAI || isAnalyzing}
                            className="text-black font-semibold bg-gradient-to-r from-orange-500 to-fuchsia-400 hover:from-orange-400 hover:to-fuchsia-300 shadow-lg"
                            style={{ pointerEvents: (!canAnalyzeWithAI || isAnalyzing) ? 'none' : 'auto' }}
                          >
                            {isAnalyzing ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Flame className="w-4 h-4 mr-2" />
                            )}
                            {matchingAiSuggestionGenerations.length > 0 || aiSuggestionsByGeneration.length > 0
                              ? "Generate More Clips"
                              : "Generate Clips"}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {!canAnalyzeWithAI && (
                        <TooltipContent>
                          <p>Please configure your OpenAI API key in settings</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-2xl"><Flame className="w-6 h-6 text-orange-300" /> AI Magic Clips</CardTitle>
                    <CardDescription className="text-white/50 text-base">
                      Review saved AI suggestion batches. Each generation keeps the inputs used so you can compare recommendations over time.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 max-h-[42rem] overflow-auto pr-1">
                    {matchingAiSuggestionGenerations.length > 0 ? (
                      matchingAiSuggestionGenerations.map((group) => (
                        <div key={group.generationId} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-fuchsia-100">
                                  AI Batch
                                </span>
                                <span className="text-sm font-semibold text-white/90">
                                  {new Date(group.generatedAt).toLocaleString()}
                                </span>
                              </div>
                              <div className="text-xs leading-relaxed text-white/55">
                                {formatAiSuggestionInputSummary(group.inputSummary)}
                              </div>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="bg-white/5 text-white/75 hover:bg-red-500/15 hover:text-red-100"
                              onClick={() =>
                                void handleDeleteAiSuggestionGeneration(
                                  group.generationId,
                                  new Date(group.generatedAt).toLocaleString()
                                )
                              }
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete batch
                            </Button>
                          </div>

                          <div className="space-y-3">
                            {group.projects.map((project) => {
                              const textPreview = selectedSubtitle
                                ? summarizeClipText(project.clip, selectedSubtitle.chunks, 200)
                                : project.clip.hook;
                              return (
                                <button
                                  key={project.id}
                                  onClick={() => {
                                    applySavedShortProject(project);
                                    setHubView("editor");
                                  }}
                                  className="w-full text-left rounded-2xl border border-white/10 bg-black/20 hover:bg-black/40 hover:border-orange-300/30 transition-all p-5 group"
                                >
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                    <div className="text-base font-semibold text-white/90 group-hover:text-orange-200 transition-colors">
                                      {project.plan.title}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2.5 py-1 rounded-full bg-fuchsia-400/10 border border-fuchsia-400/20 text-fuchsia-100/90 font-medium tracking-wide">
                                        AI
                                      </div>
                                      <div className="text-xs px-2.5 py-1 rounded-full bg-orange-400/10 border border-orange-400/20 text-orange-100/90 font-medium tracking-wide">
                                        {platformLabel(project.platform)}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-xs text-white/50 mb-3 font-medium">
                                    {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)} ({Math.round(project.clip.durationSeconds)}s)
                                  </div>
                                  <div className="text-sm text-white/80 leading-relaxed italic border-l-2 border-white/10 pl-3 py-1 mb-3">
                                    {textPreview}
                                  </div>
                                  <div className="flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3">
                                    <div className="text-xs text-white/55 leading-relaxed">{project.clip.reason}</div>
                                    <Button
                                      type="button"
                                      size="icon-xs"
                                      variant="ghost"
                                      className="shrink-0 bg-white/5 hover:bg-red-500/15 text-white/50 hover:text-red-200"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleDeleteShortProject(project);
                                      }}
                                      title={`Delete ${project.name}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-8 text-center text-sm text-white/60">
                        <Flame className="w-8 h-8 mx-auto text-white/20 mb-3" />
                        Run <span className="text-white font-semibold">Generate Clip Lab</span> to save your first AI suggestion batch.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTool === "clip_lab" && hubView === "editor" && (
              <div className="space-y-6">
                <div>
                  <Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10 -ml-3" onClick={() => setHubView("start")}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] 2xl:grid-cols-[320px_1fr] gap-6 items-start">

                <div className="space-y-6">
                  <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                    <CardHeader className="pb-4">
                      <CardTitle className="flex items-center gap-2 text-lg"><FolderOpen className="w-5 h-5 text-emerald-300" /> Saved Shorts</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {shortsLibraryError && (
                        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{shortsLibraryError}</div>
                      )}
                      {isLoadingShortsLibrary && (
                        <div className="text-sm text-white/50">Loading saved shorts…</div>
                      )}
                      {!isLoadingShortsLibrary && savedShortProjects.length === 0 && (
                        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-xs text-white/60 text-center">
                          No saved shorts yet.
                        </div>
                      )}

                            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                        {savedShortProjects.map((project) => {
                          const isActive = activeSavedShortProjectId === project.id;
                          return (
                            <div
                              key={project.id}
                              onClick={() => applySavedShortProject(project)}
                              className={cn(
                                "rounded-xl border p-3 cursor-pointer transition-colors hover:bg-white/10",
                                isActive ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/10 bg-black/20"
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-white/90 truncate mb-1">{project.name}</div>
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[11px] text-white/55">
                                      {platformLabel(project.platform)} · {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)}
                                    </div>
                                    {isActive && <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="ghost"
                                  className="shrink-0 bg-white/5 hover:bg-red-500/15 text-white/50 hover:text-red-200"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteShortProject(project);
                                  }}
                                  title={`Delete ${project.name}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Clapperboard className="w-5 h-5 text-fuchsia-300" /> Vertical Editor + Export</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] 2xl:grid-cols-[440px_1fr] gap-8">
                      <div className="space-y-3 sticky top-6 self-start">
                        <div
                          ref={previewFrameRef}
                          className="relative mx-auto w-full max-w-[420px] aspect-[9/16] rounded-[1.6rem] border border-white/15 overflow-hidden bg-black shadow-2xl"
                        >
                          {isVideoMedia && mediaUrl ? (
                            <video
                              key={mediaUrl}
                              ref={previewVideoRef}
                              src={mediaUrl}
                              muted
                              playsInline
                              onTimeUpdate={handleVideoTimeUpdate}
                              onPlay={handleVideoPlay}
                              onPause={handleVideoPause}
                              onEnded={handleVideoEnded}
                              className="absolute"
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                                left: "50%",
                                top: "50%",
                                transform: `translate(-50%, -50%) scale(${zoom}) translate(${panX}px, ${panY}px)`,
                                transformOrigin: "center center",
                              }}
                            />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-black to-orange-500/10 flex items-center justify-center p-6 text-center">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Preview Placeholder</div>
                                <div className="text-sm text-white/70 leading-relaxed">
                                  {mediaFilename ? `Audio-only source: ${mediaFilename}` : "No video preview available. You can still save editor presets for later."}
                                </div>
                              </div>
                            </div>
                          )}

                          {showSafeZones && selectedPlan && (
                            <>
                              <div
                                className="absolute inset-x-0 border-b border-cyan-300/40 border-dashed"
                                style={{ top: `${selectedPlan.editorPreset.safeTopPct}%` }}
                              />
                              <div
                                className="absolute inset-x-0 border-t border-orange-300/40 border-dashed"
                                style={{ top: `${100 - selectedPlan.editorPreset.safeBottomPct}%` }}
                              />
                            </>
                          )}

                          {showSubtitles && previewWrappedSubtitleLine && (() => {
                            // Render the preview subtitle in the same coordinate space as the FFmpeg export.
                            // previewScale maps the 1080 px export canvas onto the preview frame pixels.
                            const previewScale = previewFrameWidth > 0 ? previewFrameWidth / 1080 : 1;
                            const cssFontSize = exportFontSize * previewScale;
                            const cssMaxWidth = 1080 * 0.80 * previewScale;
                            const cssLineHeight = exportFontSize * 1.18 * previewScale;
                            const cssBorder = resolvedSubtitleStyle.borderWidth * previewScale;
                            return (
                              <div
                                className="absolute text-center transition-opacity duration-150"
                                style={{
                                  left: `${subtitleXPositionPct}%`,
                                  top: `${subtitleYOffsetPct}%`,
                                  transform: "translate(-50%, -50%)",
                                  maxWidth: `${cssMaxWidth}px`,
                                  width: "max-content",
                                }}
                              >
                                <SubtitlePreviewText
                                  text={previewWrappedSubtitleLine}
                                  subtitleStyle={resolvedSubtitleStyle}
                                  fontSizePx={cssFontSize}
                                  lineHeightPx={cssLineHeight}
                                  borderWidthPx={cssBorder}
                                  shadowScale={previewScale}
                                />
                              </div>
                            );
                          })()}

                          {/* Playback controls overlay at bottom of frame */}
                          {isVideoMedia && mediaUrl && (
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-8 pb-3 px-3">
                              {/* Seek bar */}
                              <div
                                className="h-1 rounded-full bg-white/20 mb-2.5 cursor-pointer"
                                onClick={(e) => {
                                  if (!editedClip) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                  const seekTime = editedClip.startSeconds + pct * editedClip.durationSeconds;
                                  const video = previewVideoRef.current;
                                  if (video) {
                                    video.currentTime = seekTime;
                                    setCurrentTime(seekTime);
                                  }
                                }}
                              >
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-300 transition-[width] duration-100"
                                  style={{ width: `${clipProgressPct}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={togglePlayPause}
                                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                    aria-label={isPlaying ? "Pause" : "Play"}
                                  >
                                    {isPlaying ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={toggleMute}
                                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                    aria-label={isMuted ? "Unmute" : "Mute"}
                                  >
                                    {isMuted ? <VolumeX className="w-4 h-4 text-white/70" /> : <Volume2 className="w-4 h-4 text-white" />}
                                  </button>
                                </div>
                                {editedClip && (
                                  <div className="text-[11px] text-white/60 tabular-nums">
                                    {secondsToClock(Math.max(0, currentTime - editedClip.startSeconds))} / {secondsToClock(editedClip.durationSeconds)}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {editedClip && (
                          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70 space-y-1">
                            <div>Clip: {secondsToClock(editedClip.startSeconds)} → {secondsToClock(editedClip.endSeconds)}</div>
                            <div>Duration: {editedClip.durationSeconds.toFixed(1)}s</div>
                            <div>Subtitle source: {selectedSubtitle ? subtitleVersionLabel(selectedSubtitle) : "None"}</div>
                            <div>Subtitle style: {CREATOR_SUBTITLE_STYLE_LABELS[resolvedSubtitleStyle.preset]}</div>
                            <div>Subtitle chunks in clip: {selectedClipSubtitleChunks.length}</div>
                            {activeSavedShortProject && (
                              <div className={cn("font-medium", activeSavedShortProject.origin === "ai_suggestion" ? "text-fuchsia-200/90" : "text-emerald-200/90")}>
                                {activeSavedShortProject.origin === "ai_suggestion"
                                  ? `Loaded AI suggestion: ${activeSavedShortProject.name}`
                                  : `Loaded saved short: ${activeSavedShortProject.name}`}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-4 min-w-0">
                        <Tabs defaultValue="subtitles" className="w-full">
                          <TabsList className="flex w-full mb-6 bg-black/40 border border-white/10 p-1.5 rounded-2xl h-auto gap-1 shadow-2xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500/5 via-cyan-500/5 to-transparent pointer-events-none" />
                            <TabsTrigger value="framing" className="flex-1 py-3 rounded-xl data-[state=active]:bg-[linear-gradient(135deg,rgba(52,211,153,0.15),rgba(255,255,255,0.01))] data-[state=active]:border-emerald-400/30 data-[state=active]:text-emerald-50 text-white/50 hover:text-white/80 transition-all border border-transparent data-[state=active]:shadow-[0_0_15px_rgba(52,211,153,0.15)] font-medium tracking-wide relative">
                              <span className="relative z-10">Framing & Trim</span>
                            </TabsTrigger>
                            <TabsTrigger value="subtitles" className="flex-1 py-3 rounded-xl data-[state=active]:bg-[linear-gradient(135deg,rgba(34,211,238,0.15),rgba(255,255,255,0.01))] data-[state=active]:border-cyan-400/30 data-[state=active]:text-cyan-50 text-cyan-50/50 hover:text-cyan-50 transition-all border border-transparent data-[state=active]:shadow-[0_0_15px_rgba(34,211,238,0.15)] font-medium tracking-wide relative">
                               <span className="relative z-10">Subtitles</span>
                            </TabsTrigger>
                            <TabsTrigger value="export" className="flex-1 py-3 rounded-xl data-[state=active]:bg-[linear-gradient(135deg,rgba(232,121,249,0.15),rgba(255,255,255,0.01))] data-[state=active]:border-fuchsia-400/30 data-[state=active]:text-fuchsia-50 text-white/50 hover:text-white/80 transition-all border border-transparent data-[state=active]:shadow-[0_0_15px_rgba(232,121,249,0.15)] font-medium tracking-wide relative">
                               <span className="relative z-10">Save & Export</span>
                            </TabsTrigger>
                          </TabsList>
                          
                          <TabsContent value="framing" className="mt-0 outline-none">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-5 space-y-5">
                              <div className="text-sm font-semibold text-white/90 flex items-center gap-2">
                                Framing Controls
                              </div>
                            {editedClip && (
                              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-5">
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <label className="text-xs uppercase tracking-widest text-emerald-300/80 font-medium w-20">Start</label>
                                    <div className="relative flex-1">
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        value={editedClip.startSeconds}
                                        onChange={(e) => {
                                          const value = Number(e.target.value);
                                          if (!Number.isFinite(value)) return;
                                          setEditedClipStartSeconds(value);
                                        }}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-3 pr-6 text-left text-sm font-medium text-emerald-100 shadow-inner focus:outline-none focus:border-emerald-400/50 focus:bg-emerald-400/10 transition-colors"
                                      />
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 pointer-events-none">sec</span>
                                    </div>
                                  </div>
                                  
                                  <div className="flex items-center justify-between gap-3">
                                    <label className="text-xs uppercase tracking-widest text-orange-300/80 font-medium w-20">End</label>
                                    <div className="relative flex-1">
                                      <input
                                        type="number"
                                        min={1}
                                        step={0.1}
                                        value={editedClip.endSeconds}
                                        onChange={(e) => {
                                          const value = Number(e.target.value);
                                          if (!Number.isFinite(value)) return;
                                          setEditedClipEndSeconds(value);
                                        }}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-3 pr-6 text-left text-sm font-medium text-orange-100 shadow-inner focus:outline-none focus:border-orange-400/50 focus:bg-orange-400/10 transition-colors"
                                      />
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 pointer-events-none">sec</span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between gap-3">
                                    <label className="text-xs uppercase tracking-widest text-cyan-300/80 font-medium w-20">Duration</label>
                                    <div className="relative flex-1">
                                      <input
                                        type="number"
                                        min={1}
                                        step={0.1}
                                        value={editedClip.durationSeconds}
                                        onChange={(e) => {
                                          const value = Number(e.target.value);
                                          if (!Number.isFinite(value)) return;
                                          setEditedClipDurationSeconds(value);
                                        }}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-3 pr-6 text-left text-sm font-medium text-cyan-100 shadow-inner focus:outline-none focus:border-cyan-400/50 focus:bg-cyan-400/10 transition-colors"
                                      />
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/30 pointer-events-none">sec</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap justify-center gap-2 pt-4 border-t border-white/5">
                                  <Button type="button" size="sm" variant="ghost" className="h-8 px-4 text-xs font-medium rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/70 transition-colors" onClick={() => adjustEditedClipDurationSeconds(-5)}>
                                    -5s
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="h-8 px-4 text-xs font-medium rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/70 transition-colors" onClick={() => adjustEditedClipDurationSeconds(-1)}>
                                    -1s
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="h-8 px-4 text-xs font-medium rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/70 transition-colors" onClick={() => adjustEditedClipDurationSeconds(0.5)}>
                                    +0.5s
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="h-8 px-4 text-xs font-medium rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/70 transition-colors" onClick={() => adjustEditedClipDurationSeconds(1)}>
                                    +1s
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="h-8 px-4 text-xs font-medium rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/70 transition-colors" onClick={() => adjustEditedClipDurationSeconds(5)}>
                                    +5s
                                  </Button>
                                </div>
                                {typeof sourceDurationSeconds === "number" && Number.isFinite(sourceDurationSeconds) && (
                                  <div className="text-[11px] text-white/45">Source duration: {sourceDurationSeconds.toFixed(1)}s (trim is clamped to this length)</div>
                                )}
                              </div>
                            )}
                            <label className="text-xs text-white/70 block">Start nudge: {trimStartNudge.toFixed(1)}s</label>
                            <input
                              type="range"
                              min={-300}
                              max={300}
                              step={0.1}
                              value={trimStartNudge}
                                  onChange={(e) => {
                                    setTrimStartNudge(Number(e.target.value));
                                  }}
                                  className="w-full"
                                />
                            <label className="text-xs text-white/70 block">End nudge: {trimEndNudge.toFixed(1)}s</label>
                            <input
                              type="range"
                              min={-300}
                              max={300}
                              step={0.1}
                              value={trimEndNudge}
                                  onChange={(e) => {
                                    setTrimEndNudge(Number(e.target.value));
                                  }}
                                  className="w-full"
                                />
                            <label className="text-xs text-white/70 block">Zoom: {zoom.toFixed(2)}x</label>
                            <input type="range" min={0.5} max={4.0} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
                            <label className="text-xs text-white/70 block">Pan X: {panX}px</label>
                            <input type="range" min={-600} max={600} step={1} value={panX} onChange={(e) => setPanX(Number(e.target.value))} className="w-full" />
                            <label className="text-xs text-white/70 block">Pan Y: {panY}px</label>
                            <input type="range" min={-600} max={600} step={1} value={panY} onChange={(e) => setPanY(Number(e.target.value))} className="w-full" />
                            </div>
                          </TabsContent>

                          <TabsContent value="subtitles" className="mt-0 outline-none">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-5 space-y-5">
                              <div className="text-sm font-semibold text-white/90 flex items-center gap-2">
                                Subtitle Appearance
                              </div>
                            <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80">
                              <input
                                type="checkbox"
                                checked={!showSubtitles}
                                onChange={(e) => setShowSubtitles(!e.target.checked)}
                                className="mt-0.5"
                              />
                              <span className="leading-relaxed">
                                Disable subtitles for this short. Preview and export will render without subtitles until you turn them back on.
                              </span>
                            </label>
                            {showSubtitles ? (
                              <>
                                <label className="text-xs text-white/70 block">Subtitle scale: {subtitleScale.toFixed(2)}x</label>
                                <input type="range" min={0.7} max={1.8} step={0.01} value={subtitleScale} onChange={(e) => setSubtitleScale(Number(e.target.value))} className="w-full" />
                                <label className="text-xs text-white/70 block">Subtitle horizontal position: {subtitleXPositionPct.toFixed(0)}%</label>
                                <input type="range" min={10} max={90} step={1} value={subtitleXPositionPct} onChange={(e) => setSubtitleXPositionPct(Number(e.target.value))} className="w-full" />
                                <label className="text-xs text-white/70 block">Subtitle vertical position: {subtitleYOffsetPct.toFixed(0)}%</label>
                                <input type="range" min={45} max={92} step={1} value={subtitleYOffsetPct} onChange={(e) => setSubtitleYOffsetPct(Number(e.target.value))} className="w-full" />
                                <div className="space-y-3 pt-2">
                                  <div className="text-sm font-medium text-white/80">Quick Styles</div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {COMMON_SUBTITLE_STYLE_PRESETS.map((quick) => (
                                      <button
                                        key={quick.id}
                                        type="button"
                                        onClick={() => {
                                          setSubtitleStyleOverrides({ ...quick.style });
                                        }}
                                        className="rounded-2xl border border-white/10 bg-black/40 hover:bg-white/5 hover:border-white/20 text-left p-4 transition-all group"
                                      >
                                        <div className="mb-3 rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(3,7,18,0.92),rgba(19,34,54,0.82)_55%,rgba(88,28,135,0.35))] px-4 py-8 shadow-inner flex items-center justify-center group-hover:shadow-cyan-500/10 transition-shadow">
                                          <SubtitlePreviewText
                                            text="Captions Rock!"
                                            subtitleStyle={quick.style}
                                            fontSizePx={22}
                                            lineHeightPx={24}
                                            borderWidthPx={2}
                                            shadowScale={0.7}
                                            className="text-center"
                                          />
                                        </div>
                                        <div className="text-sm font-semibold text-white/90">{quick.name}</div>
                                        <div className="text-xs text-white/55 mt-1 leading-relaxed">{quick.description}</div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                  <label className="text-xs text-white/70 block">
                                    Text color
                                    <input
                                      type="color"
                                      value={resolvedSubtitleStyle.textColor}
                                      onChange={(e) => {
                                        setSubtitleStyleOverrides((prev) => ({ ...prev, textColor: e.target.value.toUpperCase() }));
                                      }}
                                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/5"
                                    />
                                  </label>
                                  <label className="text-xs text-white/70 block">
                                    Letter border color
                                    <input
                                      type="color"
                                      value={resolvedSubtitleStyle.borderColor}
                                      onChange={(e) => {
                                        setSubtitleStyleOverrides((prev) => ({ ...prev, borderColor: e.target.value.toUpperCase() }));
                                      }}
                                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/5"
                                    />
                                  </label>
                                  <label className="text-xs text-white/70 block">
                                    Letter shadow color
                                    <input
                                      type="color"
                                      value={resolvedSubtitleStyle.shadowColor}
                                      onChange={(e) => {
                                        setSubtitleStyleOverrides((prev) => ({ ...prev, shadowColor: e.target.value.toUpperCase() }));
                                      }}
                                      className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/5"
                                    />
                                  </label>
                                  <label className="text-xs text-white/70 block">
                                    Style preset
                                    <Select
                                      value={resolvedSubtitleStyle.preset}
                                      onValueChange={(value) => {
                                        if (value !== "bold_pop" && value !== "clean_caption" && value !== "creator_neon") return;
                                        setSubtitleStyleOverrides(getDefaultCreatorSubtitleStyle(value));
                                      }}
                                    >
                                      <SelectTrigger className="mt-1 h-9 w-full bg-white/5 border-white/10 text-white/90">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                                        {(["bold_pop", "clean_caption", "creator_neon"] as const).map((preset) => (
                                          <SelectItem key={preset} value={preset} className="focus:bg-cyan-500/20 cursor-pointer">
                                            {CREATOR_SUBTITLE_STYLE_LABELS[preset]}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </label>
                                </div>
                                <label className="text-xs text-white/70 block">Letter width: {resolvedSubtitleStyle.letterWidth.toFixed(2)}x</label>
                                <input
                                  type="range"
                                  min={1}
                                  max={1.5}
                                  step={0.01}
                                  value={resolvedSubtitleStyle.letterWidth}
                                  onChange={(e) => {
                                    setSubtitleStyleOverrides((prev) => ({ ...prev, letterWidth: Number(e.target.value) }));
                                  }}
                                  className="w-full"
                                />
                                <label className="text-xs text-white/70 block">Letter border width: {resolvedSubtitleStyle.borderWidth.toFixed(1)}px</label>
                                <input
                                  type="range"
                                  min={0}
                                  max={8}
                                  step={0.1}
                                  value={resolvedSubtitleStyle.borderWidth}
                                  onChange={(e) => {
                                    setSubtitleStyleOverrides((prev) => ({ ...prev, borderWidth: Number(e.target.value) }));
                                  }}
                                  className="w-full"
                                />
                                <label className="text-xs text-white/70 block">
                                  Shadow opacity: {Math.round(resolvedSubtitleStyle.shadowOpacity * 100)}%
                                </label>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={resolvedSubtitleStyle.shadowOpacity}
                                  onChange={(e) => {
                                    setSubtitleStyleOverrides((prev) => ({ ...prev, shadowOpacity: Number(e.target.value) }));
                                  }}
                                  className="w-full"
                                />
                                <label className="text-xs text-white/70 block">Shadow distance: {resolvedSubtitleStyle.shadowDistance.toFixed(1)}px</label>
                                <input
                                  type="range"
                                  min={0}
                                  max={8}
                                  step={0.1}
                                  value={resolvedSubtitleStyle.shadowDistance}
                                  onChange={(e) => {
                                    setSubtitleStyleOverrides((prev) => ({ ...prev, shadowDistance: Number(e.target.value) }));
                                  }}
                                  className="w-full"
                                />
                                <label className="text-xs text-white/70 block">
                                  Text case
                                  <Select
                                    value={resolvedSubtitleStyle.textCase}
                                    onValueChange={(value) => {
                                      if (value !== "original" && value !== "uppercase") return;
                                      setSubtitleStyleOverrides((prev) => ({ ...prev, textCase: value }));
                                    }}
                                  >
                                    <SelectTrigger className="mt-1 h-9 w-full bg-white/5 border-white/10 text-white/90">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                                      <SelectItem value="original" className="focus:bg-cyan-500/20 cursor-pointer">Original</SelectItem>
                                      <SelectItem value="uppercase" className="focus:bg-cyan-500/20 cursor-pointer">Uppercase</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </label>
                                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-xs font-semibold text-white/85">Subtitle background</div>
                                      <div className="text-[11px] text-white/50 leading-relaxed">
                                        Add a rounded box behind the whole subtitle block for busy footage.
                                      </div>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-white/75">
                                      <input
                                        type="checkbox"
                                        checked={resolvedSubtitleStyle.backgroundEnabled}
                                        onChange={(e) => {
                                          setSubtitleStyleOverrides((prev) => ({ ...prev, backgroundEnabled: e.target.checked }));
                                        }}
                                      />
                                      Enable
                                    </label>
                                  </div>
                                  {resolvedSubtitleStyle.backgroundEnabled ? (
                                    <>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <label className="text-xs text-white/70 block">
                                          Background color
                                          <input
                                            type="color"
                                            value={resolvedSubtitleStyle.backgroundColor}
                                            onChange={(e) => {
                                              setSubtitleStyleOverrides((prev) => ({ ...prev, backgroundColor: e.target.value.toUpperCase() }));
                                            }}
                                            className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/5"
                                          />
                                        </label>
                                        <label className="text-xs text-white/70 block">
                                          Background opacity: {Math.round(resolvedSubtitleStyle.backgroundOpacity * 100)}%
                                          <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.01}
                                            value={resolvedSubtitleStyle.backgroundOpacity}
                                            onChange={(e) => {
                                              setSubtitleStyleOverrides((prev) => ({ ...prev, backgroundOpacity: Number(e.target.value) }));
                                            }}
                                            className="mt-1 w-full"
                                          />
                                        </label>
                                      </div>
                                      <label className="text-xs text-white/70 block">
                                        Rounded corners: {resolvedSubtitleStyle.backgroundRadius.toFixed(0)}px
                                      </label>
                                      <input
                                        type="range"
                                        min={0}
                                        max={80}
                                        step={1}
                                        value={resolvedSubtitleStyle.backgroundRadius}
                                        onChange={(e) => {
                                          setSubtitleStyleOverrides((prev) => ({ ...prev, backgroundRadius: Number(e.target.value) }));
                                        }}
                                        className="w-full"
                                      />
                                      <label className="text-xs text-white/70 block">
                                        Horizontal padding: {resolvedSubtitleStyle.backgroundPaddingX.toFixed(0)}px
                                      </label>
                                      <input
                                        type="range"
                                        min={0}
                                        max={80}
                                        step={1}
                                        value={resolvedSubtitleStyle.backgroundPaddingX}
                                        onChange={(e) => {
                                          setSubtitleStyleOverrides((prev) => ({ ...prev, backgroundPaddingX: Number(e.target.value) }));
                                        }}
                                        className="w-full"
                                      />
                                      <label className="text-xs text-white/70 block">
                                        Vertical padding: {resolvedSubtitleStyle.backgroundPaddingY.toFixed(0)}px
                                      </label>
                                      <input
                                        type="range"
                                        min={0}
                                        max={48}
                                        step={1}
                                        value={resolvedSubtitleStyle.backgroundPaddingY}
                                        onChange={(e) => {
                                          setSubtitleStyleOverrides((prev) => ({ ...prev, backgroundPaddingY: Number(e.target.value) }));
                                        }}
                                        className="w-full"
                                      />
                                    </>
                                  ) : (
                                    <div className="text-[11px] leading-relaxed text-white/55">
                                      Background is off. Turn it on for a pill or caption-card look behind the subtitles.
                                    </div>
                                  )}
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs bg-white/5 hover:bg-white/10 text-white/80"
                                    onClick={() => {
                                      setSubtitleStyleOverrides({});
                                    }}
                                  >
                                    Use Plan Default Style
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-[11px] leading-relaxed text-white/60">
                                Subtitle placement and styling controls are hidden while subtitles are disabled.
                              </div>
                            )}
                            <label className="flex items-center gap-2 text-xs text-white/70 mt-4">
                              <input type="checkbox" checked={showSafeZones} onChange={(e) => setShowSafeZones(e.target.checked)} />
                              Show platform safe zones
                            </label>
                            </div>
                          </TabsContent>

                          <TabsContent value="export" className="mt-0 outline-none">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-5 space-y-5">
                              <div className="text-sm font-semibold text-white/90 flex items-center gap-2">
                                Save Config & Render
                              </div>
                            <div className="space-y-2">
                              <label className="text-xs text-white/70 block">
                                Saved short name
                                <input
                                  type="text"
                                  value={shortProjectNameDraft}
                                  onChange={(e) => setShortProjectNameDraft(e.target.value)}
                                  placeholder={autoGeneratedShortProjectName || "Auto-generated on save"}
                                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35"
                                />
                              </label>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs bg-white/5 hover:bg-white/10 text-white/80"
                                  onClick={() => setShortProjectNameDraft("")}
                                  disabled={!shortProjectNameDraft.trim()}
                                >
                                  Auto Name
                                </Button>
                              </div>
                            </div>
                            {!isVideoMedia && mediaFilename && (
                              <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-start gap-2">
                                <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                                Current source is audio-only. Save config is available, local MP4 export needs a video source.
                              </div>
                            )}
                            {!canRender && !isExportingShort && (
                              <div className="text-xs text-white/50 bg-white/5 border border-white/10 rounded-lg p-2">
                                {selectedProject && (!selectedTranscript || !selectedSubtitle)
                                  ? "Select a transcript + subtitle source to enable save/export."
                                  : "Pick a source project to start editing and saving shorts."}
                              </div>
                            )}
                            <div className="pt-2 flex flex-wrap gap-2">
                              <Button
                                onClick={handleSaveShortProject}
                                disabled={!canRender || isExportingShort}
                                variant="ghost"
                                className="bg-white/5 hover:bg-white/10 text-white/90"
                              >
                                <Save className="w-4 h-4 mr-2" />
                                {activeSavedShortProject?.origin === "ai_suggestion" ? "Save As Manual Short" : "Save Short Config"}
                              </Button>
                              <Button
                                onClick={handleRenderShort}
                                disabled={!canExportVideo || isExportingShort}
                                className="bg-gradient-to-r from-fuchsia-500 to-cyan-400 text-black font-semibold hover:from-fuchsia-400 hover:to-cyan-300"
                              >
                                {isExportingShort ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <HardDriveDownload className="w-4 h-4 mr-2" />}
                                {isExportingShort
                                  ? shortExportStage === "handoff" || shortExportStage === "complete"
                                    ? `Finalizing ${exportProgressPct}%`
                                    : `Exporting ${exportProgressPct}%`
                                  : "Export Short (Local)"}
                              </Button>
                              {canCancelShortExport && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                                  onClick={handleCancelShortExport}
                                >
                                  Cancel
                                </Button>
                              )}
                              {activeSavedShortProject && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="bg-red-500/10 hover:bg-red-500/15 text-red-100 border border-red-500/20"
                                  onClick={() => void handleDeleteShortProject(activeSavedShortProject)}
                                  disabled={isExportingShort}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  {activeSavedShortProject.origin === "ai_suggestion" ? "Delete Loaded Suggestion" : "Delete Loaded Short"}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                className="bg-white/5 hover:bg-white/10 text-white/80"
                                onClick={() => {
                                  setTrimStartNudge(0);
                                  setTrimEndNudge(0);
                                  setZoom(1.15);
                                  setPanX(0);
                                  setPanY(0);
                                  setSubtitleScale(1);
                                  setSubtitleXPositionPct(50);
                                  setSubtitleYOffsetPct(78);
                                  setSubtitleStyleOverrides({});
                                  setShowSafeZones(true);
                                }}
                              >
                                Reset Editor
                              </Button>
                            </div>
                            {isExportingShort && (
                              <div className="space-y-2">
                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-fuchsia-400 to-cyan-300 transition-[width] duration-150"
                                    style={{ width: `${Math.max(4, exportProgressPct)}%` }}
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs text-white/55">
                                    {shortExportStage === "handoff" || shortExportStage === "complete"
                                      ? "Render complete. Saving export file to local library… keep this tab open."
                                      : "Local ffmpeg.wasm render in progress… keep this tab open."}
                                  </div>
                                  {canCancelShortExport ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 bg-white/5 px-2 text-xs text-white/85 hover:bg-white/10"
                                      onClick={handleCancelShortExport}
                                    >
                                      Cancel
                                    </Button>
                                  ) : (
                                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">Locked</div>
                                  )}
                                </div>
                                <div className="text-[11px] uppercase tracking-[0.24em] text-white/35">
                                  {shortExportStage === "preparing"
                                    ? "Preparing"
                                    : shortExportStage === "rendering"
                                      ? "Rendering"
                                      : shortExportStage === "handoff"
                                        ? "Finalizing"
                                        : "Complete"}
                                </div>
                              </div>
                            )}
                            {localRenderError && (
                              <div className="space-y-2">
                                <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{localRenderError}</div>
                                {localRenderDiagnostics && (
                                  <div className="rounded-lg border border-white/10 bg-black/40 p-2 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[11px] uppercase tracking-wider text-white/45">Export diagnostics</div>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-[11px] bg-white/5 hover:bg-white/10 text-white/75"
                                        onClick={() => copyText(localRenderDiagnostics, "Export diagnostics")}
                                      >
                                        <Copy className="w-3 h-3 mr-1" /> Copy
                                      </Button>
                                    </div>
                                    <pre className="text-[11px] text-white/70 whitespace-pre-wrap break-words">{localRenderDiagnostics}</pre>
                                  </div>
                                )}
                              </div>
                            )}
                            </div>
                          </TabsContent>
                        </Tabs>


                        {activeSavedShortProject && savedExportsForActiveShort.length > 0 && (
                          <div className="rounded-xl border border-white/10 bg-black/20 p-5 space-y-4 shadow-xl">
                            <div className="text-sm font-semibold text-white/90">Saved Exports for Active Short</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {savedExportsForActiveShort.map((exp) => (
                                <div key={exp.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                                  <div className="text-xs text-white/90 break-all">{exp.filename}</div>
                                  <div className="text-[11px] text-white/50">
                                    {new Date(exp.createdAt).toLocaleString()} · {formatBytes(exp.sizeBytes)} · {exp.status}
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-white/80 hover:bg-white/10"
                                      onClick={() => handleDownloadSavedExport(exp)}
                                    >
                                      <Download className="w-4 h-4 mr-2" /> Download MP4
                                    </Button>
                                    {exp.debugFfmpegCommand && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-white/70 hover:bg-white/10"
                                        onClick={() => copyText(exp.debugFfmpegCommand?.join(" ") ?? "", "Saved FFmpeg command")}
                                      >
                                        <Copy className="w-4 h-4 mr-2" /> Cmd
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={isAiSettingsOpen} onOpenChange={setIsAiSettingsOpen}>
        <DialogContent className="border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.985),rgba(4,7,12,0.985))] text-white shadow-[0_24px_90px_rgba(0,0,0,0.48)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>OpenAI API Key</DialogTitle>
            <DialogDescription className="text-white/55">
              Stored only in this browser. The backend uses it per request and does not persist it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="creator-openai-key" className="text-white/80">
                API key
              </Label>
              <Input
                id="creator-openai-key"
                type="password"
                value={openAIApiKeyDraft}
                onChange={(event) => setOpenAIApiKeyDraft(event.target.value)}
                placeholder="sk-proj-..."
                autoComplete="off"
              />
            </div>

            {hasOpenAIApiKey && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
                Current key: {maskedOpenAIApiKey}
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            <div className="flex gap-2">
              {hasOpenAIApiKey && (
                <Button
                  type="button"
                  variant="ghost"
                  className="bg-white/5 text-white/80 hover:bg-white/10"
                  onClick={handleClearOpenAIApiKey}
                >
                  Remove key
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="bg-white/5 text-white/80 hover:bg-white/10"
                onClick={() => setIsAiSettingsOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-gradient-to-r from-cyan-500 to-emerald-400 font-semibold text-black hover:from-cyan-400 hover:to-emerald-300"
                onClick={handleSaveOpenAIApiKey}
              >
                Save key
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRegenerateAiSuggestionsDialogOpen} onOpenChange={setIsRegenerateAiSuggestionsDialogOpen}>
        <DialogContent className="border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.985),rgba(4,7,12,0.985))] text-white shadow-[0_24px_90px_rgba(0,0,0,0.48)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Existing AI suggestions found</DialogTitle>
            <DialogDescription className="text-white/55">
              There are already saved AI suggestions for the current source, transcript, subtitle, and niche/audience/tone inputs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/75">
              <div className="font-medium text-white/90">
                {matchingAiSuggestionGenerations.length} existing batch{matchingAiSuggestionGenerations.length === 1 ? "" : "es"}
              </div>
              <div className="mt-2 text-xs leading-relaxed text-white/55">
                {shortsRequestPayload
                  ? formatAiSuggestionInputSummary({
                      niche: shortsRequestPayload.niche,
                      audience: shortsRequestPayload.audience,
                      tone: shortsRequestPayload.tone,
                      transcriptVersionLabel: shortsRequestPayload.transcriptVersionLabel,
                      subtitleVersionLabel: shortsRequestPayload.subtitleVersionLabel,
                    })
                  : "No active input summary"}
              </div>
            </div>

            <div className="max-h-56 space-y-3 overflow-auto pr-1">
              {matchingAiSuggestionGenerations.map((group) => (
                <div key={group.generationId} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white/90">{new Date(group.generatedAt).toLocaleString()}</div>
                  <div className="mt-1 text-xs text-white/50">
                    {group.projects.length} suggestion{group.projects.length === 1 ? "" : "s"}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-white/55">
                    {formatAiSuggestionInputSummary(group.inputSummary)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="bg-white/5 text-white/80 hover:bg-white/10"
              onClick={() => setIsRegenerateAiSuggestionsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-gradient-to-r from-orange-500 to-fuchsia-400 font-semibold text-black hover:from-orange-400 hover:to-fuchsia-300"
              onClick={() => {
                setIsRegenerateAiSuggestionsDialogOpen(false);
                void runClipLabGeneration();
              }}
            >
              Generate another batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
