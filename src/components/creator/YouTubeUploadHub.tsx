"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  Copy,
  FileImage,
  FileText,
  FileVideo,
  KeyRound,
  Languages,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TvMinimalPlay,
  Upload,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useCreatorLlmRuns } from "@/hooks/useCreatorLlmRuns";
import { useCreatorVideoInfoGenerator } from "@/hooks/useCreatorVideoInfoGenerator";
import { useHistoryLibrary } from "@/hooks/useHistoryLibrary";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import {
  buildProjectVideoInfoRecord,
  resolveProjectVideoInfoAnalysis,
} from "@/lib/creator/video-info-storage";
import {
  DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS,
  appendChapterBlockToDescription,
  applySuggestedDescription,
  applySuggestedTags,
  applySuggestedTitle,
  getEligibleYouTubeProjectExports,
  resolveInitialYouTubePublishSelection,
  type YouTubePublishDraft,
  type YouTubePublishSourceMode,
} from "@/lib/creator/youtube-publish";
import type {
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
} from "@/lib/creator/types";
import {
  getLatestTranscript,
} from "@/lib/history";
import { normalizeYouTubeRegionCode, parseYouTubeTagsInput } from "@/lib/youtube/drafts";
import { publishToYouTubeFromBrowser } from "@/lib/youtube/browser-upload";
import type {
  YouTubeAccessTokenResponse,
  YouTubeBrowserUploadProgress,
  YouTubeCaptionUpload,
  YouTubeChannelSummary,
  YouTubeLicense,
  YouTubeLocalizationInput,
  YouTubeOptionCatalog,
  YouTubePrivacyStatus,
  YouTubePublishResult,
  YouTubeSessionStatus,
  YouTubeThumbnailUpload,
  YouTubeUploadDraft,
} from "@/lib/youtube/types";
import { cn } from "@/lib/utils";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type LocalizationRow = YouTubeLocalizationInput & {
  id: string;
};

type SessionPayload = YouTubeSessionStatus & {
  error?: string;
};

type OptionsPayload = {
  ok: true;
  regionCode: string;
  categories: YouTubeOptionCatalog["categories"];
  languages: YouTubeOptionCatalog["languages"];
};

type VideoInfoBlockOption = {
  value: CreatorVideoInfoBlock;
  label: string;
  description: string;
  accent: string;
};

const PRIMARY_VIDEO_INFO_BLOCK_OPTIONS: VideoInfoBlockOption[] = [
  {
    value: "titleIdeas",
    label: "Title Ideas",
    description: "Generate multiple headline options for the final upload.",
    accent: "bg-cyan-400/10 text-cyan-100 border-cyan-300/30",
  },
  {
    value: "description",
    label: "Description",
    description: "Produce a full YouTube description draft grounded in the transcript.",
    accent: "bg-emerald-400/10 text-emerald-100 border-emerald-300/30",
  },
  {
    value: "hashtagsSeo",
    label: "Hashtags + SEO",
    description: "Generate hashtags and keyword phrases that can feed the upload tags field.",
    accent: "bg-sky-400/10 text-sky-100 border-sky-300/30",
  },
  {
    value: "thumbnailHooks",
    label: "Thumbnail Hooks",
    description: "Surface short packaging hooks for thumbnails or overlays.",
    accent: "bg-orange-400/10 text-orange-100 border-orange-300/30",
  },
  {
    value: "chapters",
    label: "Chapters",
    description: "Return timestamped chapter text ready to append into the description.",
    accent: "bg-amber-400/10 text-amber-100 border-amber-300/30",
  },
  {
    value: "pinnedComment",
    label: "Pinned Comment",
    description: "Draft a discussion starter for the pinned comment slot.",
    accent: "bg-fuchsia-400/10 text-fuchsia-100 border-fuchsia-300/30",
  },
];

const ADVANCED_VIDEO_INFO_BLOCK_OPTIONS: VideoInfoBlockOption[] = [
  {
    value: "contentPack",
    label: "Content Pack",
    description: "Return summary, hooks, CTAs, and repurpose ideas for adjacent channels.",
    accent: "bg-violet-400/10 text-violet-100 border-violet-300/30",
  },
  {
    value: "insights",
    label: "Insights",
    description: "Return transcript metrics, repeated terms, and theme detection.",
    accent: "bg-white/10 text-white border-white/20",
  },
];

function makeRowId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function formatRelativeDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
  });
  const data = (await response.json()) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
}

function formatDateTime(value: number | undefined) {
  if (!value) return "No token expiry available";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function resultTone(ok: boolean) {
  return ok ? "text-emerald-200 border-emerald-400/25 bg-emerald-400/8" : "text-amber-100 border-amber-400/25 bg-amber-400/10";
}

function createEmptyLocalization(): LocalizationRow {
  return {
    id: makeRowId(),
    locale: "",
    title: "",
    description: "",
  };
}

function buildDraft(input: {
  title: string;
  description: string;
  privacyStatus: YouTubePrivacyStatus;
  tagsInput: string;
  categoryId: string;
  defaultLanguage: string;
  notifySubscribers: boolean;
  embeddable: boolean;
  license: YouTubeLicense;
  publicStatsViewable: boolean;
  publishAt: string;
  selfDeclaredMadeForKids: boolean;
  containsSyntheticMedia: boolean;
  recordingDate: string;
  localizations: LocalizationRow[];
}): YouTubeUploadDraft {
  return {
    title: input.title,
    description: input.description,
    privacyStatus: input.privacyStatus,
    tags: parseYouTubeTagsInput(input.tagsInput),
    categoryId: input.categoryId || undefined,
    defaultLanguage: input.defaultLanguage || undefined,
    notifySubscribers: input.notifySubscribers,
    embeddable: input.embeddable,
    license: input.license,
    publicStatsViewable: input.publicStatsViewable,
    publishAt: input.publishAt || undefined,
    selfDeclaredMadeForKids: input.selfDeclaredMadeForKids,
    containsSyntheticMedia: input.containsSyntheticMedia,
    recordingDate: input.recordingDate || undefined,
    localizations: input.localizations,
  };
}

function ProgressBadge({ progress }: { progress: YouTubeBrowserUploadProgress | null }) {
  if (!progress) {
    return <Badge className="border-white/15 bg-white/5 text-white/70">Idle</Badge>;
  }

  const tone =
    progress.phase === "complete"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
      : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100";

  return <Badge className={cn("capitalize", tone)}>{progress.phase.replace(/_/g, " ")}</Badge>;
}

function BlockToggle({
  option,
  enabled,
  onToggle,
}: {
  option: VideoInfoBlockOption;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "rounded-2xl border p-3 text-left transition-colors",
        enabled
          ? option.accent
          : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{option.label}</div>
        <div
          className={cn(
            "h-4 w-4 rounded border transition-colors",
            enabled ? "border-white/90 bg-white/90" : "border-white/30 bg-transparent"
          )}
        />
      </div>
      <div className="mt-2 text-xs leading-relaxed opacity-80">{option.description}</div>
    </button>
  );
}

function AiResultCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-xs leading-relaxed text-zinc-500">{description}</div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function toggleBlock(blocks: CreatorVideoInfoBlock[], value: CreatorVideoInfoBlock) {
  return blocks.includes(value) ? blocks.filter((block) => block !== value) : [...blocks, value];
}

export function YouTubeUploadHub({
  projectId,
  initialExportId,
  embedded = false,
}: {
  projectId?: string;
  initialExportId?: string;
  embedded?: boolean;
} = {}) {
  const searchParams = useSearchParams();
  const {
    projects,
    assetsByProjectId,
    exportsByProjectId,
    isLoading: isLoadingProjects,
    saveProject,
  } = useProjectLibrary();
  const isProjectLocked = !!projectId;
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [selectedSourceAssetId, setSelectedSourceAssetId] = useState("");
  const {
    history,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useHistoryLibrary(selectedProjectId || undefined);
  const [sourceMode, setSourceMode] = useState<YouTubePublishSourceMode>("local_file");
  const [selectedExportId, setSelectedExportId] = useState(initialExportId ?? "");

  const {
    openAIApiKey,
    hasOpenAIApiKey,
    maskedOpenAIApiKey,
    saveOpenAIApiKey,
    clearOpenAIApiKey,
  } = useCreatorAiSettings();
  const [openAIApiKeyDraft, setOpenAIApiKeyDraft] = useState("");
  const [videoInfoBlocks, setVideoInfoBlocks] = useState<CreatorVideoInfoBlock[]>(
    DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS
  );
  const [showAdvancedAiBlocks, setShowAdvancedAiBlocks] = useState(false);

  const { videoInfoAnalysis, setVideoInfoAnalysis, isGeneratingVideoInfo, videoInfoError, generateVideoInfo } =
    useCreatorVideoInfoGenerator();
  const { runs: llmRuns, refresh: refreshLlmRuns } = useCreatorLlmRuns(selectedProjectId || undefined);

  const [session, setSession] = useState<SessionPayload | null>(null);
  const [channels, setChannels] = useState<YouTubeChannelSummary[]>([]);
  const [catalog, setCatalog] = useState<YouTubeOptionCatalog | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isLoadingRemoteData, setIsLoadingRemoteData] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [captionFile, setCaptionFile] = useState<File | null>(null);

  const [publishDraft, setPublishDraft] = useState<YouTubePublishDraft>({
    title: "",
    description: "",
    tagsInput: "",
  });
  const [privacyStatus, setPrivacyStatus] = useState<YouTubePrivacyStatus>("private");
  const [categoryId, setCategoryId] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("");
  const [notifySubscribers, setNotifySubscribers] = useState(false);
  const [embeddable, setEmbeddable] = useState(true);
  const [license, setLicense] = useState<YouTubeLicense>("youtube");
  const [publicStatsViewable, setPublicStatsViewable] = useState(true);
  const [publishAt, setPublishAt] = useState("");
  const [selfDeclaredMadeForKids, setSelfDeclaredMadeForKids] = useState(false);
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(false);
  const [recordingDate, setRecordingDate] = useState("");
  const [localizations, setLocalizations] = useState<LocalizationRow[]>([]);
  const [captionLanguage, setCaptionLanguage] = useState("");
  const [captionName, setCaptionName] = useState("");
  const [captionIsDraft, setCaptionIsDraft] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<YouTubeBrowserUploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<YouTubePublishResult | null>(null);

  const initialSelectionAppliedRef = useRef(false);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const captionInputRef = useRef<HTMLInputElement | null>(null);

  const regionCode = useMemo(() => {
    if (typeof navigator === "undefined") return "US";
    return normalizeYouTubeRegionCode(navigator.language);
  }, []);

  const availableProjectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const exportOptionsByProjectId = useMemo(() => {
    return new Map(
      projects.map((project) => {
        const assets = assetsByProjectId.get(project.id) ?? [];
        const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
        const exports = exportsByProjectId.get(project.id) ?? [];
        return [project.id, getEligibleYouTubeProjectExports(exports, assetsById)];
      })
    );
  }, [assetsByProjectId, exportsByProjectId, projects]);

  useEffect(() => {
    setOpenAIApiKeyDraft(openAIApiKey);
  }, [openAIApiKey]);

  useEffect(() => {
    if (initialSelectionAppliedRef.current || isLoadingProjects || projects.length === 0) {
      return;
    }

    const resolved = resolveInitialYouTubePublishSelection({
      projectId: projectId ?? searchParams.get("projectId"),
      exportId: initialExportId ?? searchParams.get("exportId"),
      availableProjectIds,
      exportOptionsByProjectId,
    });

    initialSelectionAppliedRef.current = true;
    setSelectedProjectId(
      projectId || resolved.projectId || (projects.length === 1 ? projects[0]?.id ?? "" : "")
    );
    setSelectedExportId(resolved.exportId);
    setSourceMode(resolved.sourceMode);
  }, [availableProjectIds, exportOptionsByProjectId, initialExportId, isLoadingProjects, projectId, projects, searchParams]);

  useEffect(() => {
    if (!projectId) return;
    setSelectedProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!initialExportId) return;
    setSelectedExportId(initialExportId);
    setSourceMode("project_export");
  }, [initialExportId]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const projectHistory = useMemo(() => (selectedProjectId ? history : []), [history, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedSourceAssetId("");
      return;
    }

    if (projectHistory.length === 0) {
      setSelectedSourceAssetId("");
      return;
    }

    const preferredSourceId =
      selectedProject?.activeSourceAssetId && projectHistory.some((item) => item.id === selectedProject.activeSourceAssetId)
        ? selectedProject.activeSourceAssetId
        : projectHistory[0]?.id ?? "";

    if (!selectedSourceAssetId || !projectHistory.some((item) => item.id === selectedSourceAssetId)) {
      setSelectedSourceAssetId(preferredSourceId);
    }
  }, [projectHistory, selectedProject?.activeSourceAssetId, selectedProjectId, selectedSourceAssetId]);

  const selectedHistoryItem = useMemo(
    () => projectHistory.find((item) => item.id === selectedSourceAssetId),
    [projectHistory, selectedSourceAssetId]
  );

  const selectedTranscript = useMemo(
    () => (selectedHistoryItem ? getLatestTranscript(selectedHistoryItem) : undefined),
    [selectedHistoryItem]
  );

  const projectAssets = useMemo(
    () => (selectedProjectId ? assetsByProjectId.get(selectedProjectId) ?? [] : []),
    [assetsByProjectId, selectedProjectId]
  );
  const projectAssetsById = useMemo(
    () => new Map(projectAssets.map((asset) => [asset.id, asset])),
    [projectAssets]
  );
  const eligibleExportOptions = useMemo(
    () => (selectedProjectId ? getEligibleYouTubeProjectExports(exportsByProjectId.get(selectedProjectId) ?? [], projectAssetsById) : []),
    [exportsByProjectId, projectAssetsById, selectedProjectId]
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedExportId("");
      if (sourceMode === "project_export") {
        setSourceMode("local_file");
      }
      return;
    }

    if (eligibleExportOptions.length === 0) {
      setSelectedExportId("");
      if (sourceMode === "project_export") {
        setSourceMode("local_file");
      }
      return;
    }

    if (!selectedExportId || !eligibleExportOptions.some((option) => option.exportId === selectedExportId)) {
      setSelectedExportId(eligibleExportOptions[0]?.exportId ?? "");
    }
  }, [eligibleExportOptions, selectedExportId, selectedProjectId, sourceMode]);

  const selectedExportOption = useMemo(
    () => eligibleExportOptions.find((option) => option.exportId === selectedExportId) ?? null,
    [eligibleExportOptions, selectedExportId]
  );

  const activeVideoFile = sourceMode === "project_export" ? selectedExportOption?.file ?? null : localVideoFile;

  useEffect(() => {
    let objectUrl: string | null = null;
    if (!activeVideoFile) {
      setVideoPreviewUrl(null);
      return;
    }
    objectUrl = URL.createObjectURL(activeVideoFile);
    setVideoPreviewUrl(objectUrl);
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeVideoFile]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("youtube");
    const detail = params.get("detail");
    if (!status) return;

    if (status === "connected") {
      toast.success("YouTube connected");
    } else if (status === "misconfigured") {
      toast.error("YouTube env vars are missing");
    } else {
      toast.error(detail ? decodeURIComponent(detail) : `YouTube flow ended with status: ${status}`);
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("youtube");
    url.searchParams.delete("detail");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const loadRemoteState = useCallback(async () => {
    setIsLoadingSession(true);
    setRemoteError(null);

    try {
      const nextSession = await fetchJson<SessionPayload>("/api/youtube/session");
      setSession(nextSession);

      if (!nextSession.connected) {
        startTransition(() => {
          setChannels([]);
          setCatalog(null);
        });
        return;
      }

      setIsLoadingRemoteData(true);
      const [channelsPayload, optionsPayload] = await Promise.all([
        fetchJson<{ ok: true; channels: YouTubeChannelSummary[] }>("/api/youtube/channels"),
        fetchJson<OptionsPayload>(`/api/youtube/options?regionCode=${encodeURIComponent(regionCode)}`),
      ]);
      startTransition(() => {
        setChannels(channelsPayload.channels);
        setCatalog({
          regionCode: optionsPayload.regionCode,
          categories: optionsPayload.categories,
          languages: optionsPayload.languages,
        });
      });
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Failed to load YouTube remote state.");
    } finally {
      setIsLoadingRemoteData(false);
      setIsLoadingSession(false);
    }
  }, [regionCode]);

  useEffect(() => {
    void loadRemoteState();
  }, [loadRemoteState]);

  const currentDraft = useMemo(
    () =>
      buildDraft({
        title: publishDraft.title,
        description: publishDraft.description,
        privacyStatus,
        tagsInput: publishDraft.tagsInput,
        categoryId,
        defaultLanguage,
        notifySubscribers,
        embeddable,
        license,
        publicStatsViewable,
        publishAt,
        selfDeclaredMadeForKids,
        containsSyntheticMedia,
        recordingDate,
        localizations,
      }),
    [
      categoryId,
      containsSyntheticMedia,
      defaultLanguage,
      embeddable,
      license,
      localizations,
      notifySubscribers,
      privacyStatus,
      publicStatsViewable,
      publishAt,
      publishDraft.description,
      publishDraft.tagsInput,
      publishDraft.title,
      recordingDate,
      selfDeclaredMadeForKids,
    ]
  );

  const canUpload = Boolean(
    session?.configured &&
      session.connected &&
      activeVideoFile &&
      publishDraft.title.trim() &&
      publishDraft.description.trim()
  );

  const videoInfoBlocksSet = useMemo(() => new Set(videoInfoBlocks), [videoInfoBlocks]);

  const creatorVideoInfoRequest = useMemo<CreatorVideoInfoGenerateRequest | null>(() => {
    if (!selectedProject || !selectedTranscript?.transcript || !selectedTranscript.chunks?.length) {
      return null;
    }

    return {
      projectId: selectedProject.id,
      sourceAssetId: selectedSourceAssetId || undefined,
      transcriptId: selectedTranscript.id,
      sourceSignature: `${selectedProject.id}:${selectedSourceAssetId || "source"}:${selectedTranscript.id}`,
      transcriptText: selectedTranscript.transcript,
      transcriptChunks: selectedTranscript.chunks,
      transcriptVersionLabel: selectedTranscript.label,
      videoInfoBlocks,
    };
  }, [selectedProject, selectedSourceAssetId, selectedTranscript, videoInfoBlocks]);

  useEffect(() => {
    const persistedAnalysis = resolveProjectVideoInfoAnalysis(
      selectedProject,
      creatorVideoInfoRequest?.sourceSignature
    );
    setVideoInfoAnalysis(persistedAnalysis);
  }, [creatorVideoInfoRequest?.sourceSignature, selectedProject, setVideoInfoAnalysis]);

  const handleLocalVideoSelection = useCallback((file: File | null) => {
    setPublishResult(null);
    setUploadError(null);
    setUploadProgress(null);
    setLocalVideoFile(file);
  }, []);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Drop a video file to prepare a YouTube upload.");
      return;
    }
    handleLocalVideoSelection(file);
  };

  const handleConnect = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/youtube/auth/start?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const handleDisconnect = async () => {
    try {
      await fetchJson("/api/youtube/disconnect", {
        method: "POST",
      });
      startTransition(() => {
        setSession((prev) => ({
          configured: prev?.configured ?? true,
          connected: false,
          missingEnvKeys: prev?.missingEnvKeys,
        }));
        setChannels([]);
        setCatalog(null);
      });
      toast.success("YouTube disconnected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect YouTube");
    }
  };

  const handleSaveOpenAIApiKey = useCallback(() => {
    const trimmed = openAIApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste an OpenAI API key first.");
      return;
    }
    saveOpenAIApiKey(trimmed);
    toast.success("OpenAI key saved in this browser.");
  }, [openAIApiKeyDraft, saveOpenAIApiKey]);

  const handleClearOpenAIApiKey = useCallback(() => {
    clearOpenAIApiKey();
    setOpenAIApiKeyDraft("");
    toast.success("OpenAI key removed from this browser.");
  }, [clearOpenAIApiKey]);

  const handleGenerateVideoInfo = useCallback(async () => {
    if (!creatorVideoInfoRequest) {
      toast.error("This project needs a transcript before metadata can be generated.");
      return;
    }
    if (!hasOpenAIApiKey) {
      toast.error("Add your OpenAI API key first.");
      return;
    }
    if (videoInfoBlocks.length === 0) {
      toast.error("Select at least one metadata block to generate.");
      return;
    }

    try {
      const result = await generateVideoInfo(creatorVideoInfoRequest, { openAIApiKey });
      if (selectedProject) {
        await saveProject({
          ...selectedProject,
          youtubeVideoInfo: buildProjectVideoInfoRecord({
            request: creatorVideoInfoRequest,
            response: result,
          }),
          updatedAt: Date.now(),
          lastOpenedAt: Date.now(),
        });
      }
      toast.success(`Metadata generated (${result.providerMode})`);
    } catch (error) {
      console.error(error);
    } finally {
      void refreshLlmRuns();
    }
  }, [
    creatorVideoInfoRequest,
    generateVideoInfo,
    hasOpenAIApiKey,
    openAIApiKey,
    refreshLlmRuns,
    saveProject,
    selectedProject,
    videoInfoBlocks.length,
  ]);

  const addLocalization = () => {
    setLocalizations((prev) => [...prev, createEmptyLocalization()]);
  };

  const updateLocalization = (id: string, field: keyof YouTubeLocalizationInput, value: string) => {
    setLocalizations((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const removeLocalization = (id: string) => {
    setLocalizations((prev) => prev.filter((row) => row.id !== id));
  };

  const applyTitleIdea = (title: string) => {
    setPublishDraft((prev) => applySuggestedTitle(prev, title));
    toast.success("Title applied to the draft");
  };

  const applyDescriptionDraft = (description: string) => {
    setPublishDraft((prev) => applySuggestedDescription(prev, description));
    toast.success("Description applied to the draft");
  };

  const applyTagsDraft = (result: CreatorVideoInfoGenerateResponse) => {
    setPublishDraft((prev) => applySuggestedTags(prev, result));
    toast.success("Tags filled from AI output");
  };

  const appendChaptersToDraft = (chapterText: string) => {
    setPublishDraft((prev) => appendChapterBlockToDescription(prev, chapterText));
    toast.success("Chapter block appended to the description");
  };

  const replaceDescriptionWithChapters = (chapterText: string) => {
    setPublishDraft((prev) => applySuggestedDescription(prev, chapterText));
    toast.success("Description replaced with the chapter block");
  };

  const handleUpload = async () => {
    if (!activeVideoFile) return;

    const captionUpload: YouTubeCaptionUpload | null =
      captionFile
        ? {
            file: captionFile,
            filename: captionFile.name,
            language: captionLanguage,
            name: captionName.trim() || fileStem(captionFile.name),
            isDraft: captionIsDraft,
          }
        : null;

    const thumbnailUpload: YouTubeThumbnailUpload | null =
      thumbnailFile
        ? {
            file: thumbnailFile,
            filename: thumbnailFile.name,
            mimeType: thumbnailFile.type || "image/png",
          }
        : null;

    setIsUploading(true);
    setUploadProgress({
      phase: "initializing",
      percent: 4,
      message: "Requesting a fresh YouTube access token",
    });
    setUploadError(null);
    setPublishResult(null);

    try {
      const token = await fetchJson<YouTubeAccessTokenResponse>("/api/youtube/access-token");
      const result = await publishToYouTubeFromBrowser({
        accessToken: token.accessToken,
        draft: currentDraft,
        videoFile: activeVideoFile,
        thumbnail: thumbnailUpload,
        caption: captionUpload,
        onProgress: setUploadProgress,
      });
      setPublishResult(result);
      toast.success("YouTube upload finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube upload failed.";
      setUploadError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const selectedSourceLabel = selectedExportOption
    ? `${selectedExportOption.kind === "timeline" ? "Timeline" : "Short"} export • ${formatRelativeDate(selectedExportOption.createdAt)}`
    : "No export selected";

  const hasTranscriptContext =
    Boolean(selectedProject) &&
    Boolean(selectedTranscript?.transcript) &&
    Boolean(selectedTranscript?.chunks?.length);

  const showContentPack = videoInfoBlocksSet.has("contentPack");
  const showInsights = videoInfoBlocksSet.has("insights");

  return (
    <div className={cn(
      "relative overflow-hidden",
      embedded ? "min-h-0 bg-transparent px-0 py-0" : "min-h-[calc(100vh-var(--header-height,4rem))] bg-zinc-950 px-4 py-6 sm:px-8 lg:px-12"
    )}>
      {!embedded ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_85%_12%,rgba(251,146,60,0.14),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.015),transparent_40%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
        </>
      ) : null}

      <div className={cn(
        "relative flex w-full flex-col gap-8",
        embedded ? "max-w-none" : "mx-auto max-w-7xl"
      )}>
        <div className="flex flex-col gap-5">
          {!embedded ? (
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Library
            </Link>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/8 px-3 py-1 text-xs uppercase tracking-[0.28em] text-cyan-100/85">
                <Sparkles className="h-3.5 w-3.5" />
                YouTube Publish
              </div>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  Generate, refine, and publish without leaving ClipScribe.
                </h1>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/8 bg-white/[0.035] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.26em] text-zinc-500">Session</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {session?.connected ? (
                      <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
                        Connected
                      </Badge>
                    ) : (
                      <Badge className="border-amber-400/25 bg-amber-400/10 text-amber-100">
                        Disconnected
                      </Badge>
                    )}
                    <ProgressBadge progress={uploadProgress} />
                    <Badge className="border-white/10 bg-white/5 text-white/70">
                      {llmRuns.length} AI run{llmRuns.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>

                <div className="text-right text-sm text-zinc-400">
                  <div>Token expiry</div>
                  <div className="mt-1 font-medium text-zinc-200">
                    {formatDateTime(session?.expiresAt)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Alert className="border-amber-400/25 bg-amber-400/10 text-amber-50">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Compliance note</AlertTitle>
          <AlertDescription className="text-amber-50/80">
            Unverified Google API projects can leave uploads locked to <strong>private</strong> even if you request <strong>public</strong> or <strong>unlisted</strong>. This tool defaults to private for safety.
          </AlertDescription>
        </Alert>

        {session && !session.configured && (
          <Alert className="border-red-400/25 bg-red-400/10 text-red-50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>YouTube env vars are missing</AlertTitle>
            <AlertDescription className="text-red-50/80">
              Add <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>YOUTUBE_SESSION_SECRET</code> before using this tool.
            </AlertDescription>
          </Alert>
        )}

        {remoteError && (
          <Alert className="border-red-400/25 bg-red-400/10 text-red-50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load YouTube state</AlertTitle>
            <AlertDescription className="text-red-50/80">{remoteError}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
          <div className="space-y-6">
            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <FileVideo className="h-5 w-5 text-cyan-300" />
                  Video source
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  Upload a local file or choose a completed export from this project.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="grid gap-4">
                  {isProjectLocked ? (
                    <div className="grid gap-2">
                      <Label className="text-zinc-200">Project</Label>
                      <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white">
                        {selectedProject?.name || "Current project"}
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <Label className="text-zinc-200">Project</Label>
                      <Select value={selectedProjectId || "__none__"} onValueChange={(value) => setSelectedProjectId(value === "__none__" ? "" : value)}>
                        <SelectTrigger className="border-white/10 bg-black/25 text-white">
                          <SelectValue placeholder={isLoadingProjects ? "Loading projects..." : "Optional project context"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No project context</SelectItem>
                          {projects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSourceMode("local_file")}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-colors",
                        sourceMode === "local_file"
                          ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-50"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      )}
                    >
                      <div className="text-sm font-semibold">Local file</div>
                      <div className="mt-2 text-xs leading-relaxed opacity-80">
                        Keep the current drag-and-drop upload path and publish any finished video from your machine.
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceMode("project_export")}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-colors",
                        sourceMode === "project_export"
                          ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-50"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      )}
                    >
                      <div className="text-sm font-semibold">Project export</div>
                      <div className="mt-2 text-xs leading-relaxed opacity-80">
                        Use a completed short or timeline export already stored in the selected ClipScribe project.
                      </div>
                    </button>
                  </div>

                  {sourceMode === "project_export" ? (
                    <div className="grid gap-2">
                      <Label className="text-zinc-200">Completed export</Label>
                      <Select
                        value={selectedExportId || "__none__"}
                        onValueChange={(value) => setSelectedExportId(value === "__none__" ? "" : value)}
                        disabled={!selectedProjectId || eligibleExportOptions.length === 0}
                      >
                        <SelectTrigger className="border-white/10 bg-black/25 text-white">
                          <SelectValue placeholder={selectedProjectId ? "Select a completed export" : "Choose a project first"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" disabled>
                            {selectedProjectId ? "Choose a completed export" : "Select a project first"}
                          </SelectItem>
                          {eligibleExportOptions.length === 0 ? (
                            <SelectItem value="__empty_exports__" disabled>
                              No eligible video exports yet
                            </SelectItem>
                          ) : (
                            eligibleExportOptions.map((option) => (
                              <SelectItem key={option.exportId} value={option.exportId}>
                                {option.filename} • {option.kind} • {formatRelativeDate(option.createdAt)}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <div className="text-xs text-zinc-500">
                        {selectedExportOption ? selectedSourceLabel : "Completed timeline and short exports will appear here when they have a readable video blob."}
                      </div>
                    </div>
                  ) : null}
                </div>

              </CardContent>
            </Card>

            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-cyan-300" />
                      YouTube connection
                    </CardTitle>
                    <CardDescription className="mt-2 text-zinc-400">
                      OAuth stays on the backend. The browser only gets a short-lived token right before upload.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-white/5 text-white hover:bg-white/10"
                    onClick={() => void loadRemoteState()}
                    disabled={isLoadingSession || isLoadingRemoteData}
                  >
                    {isLoadingSession || isLoadingRemoteData ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="flex flex-wrap items-center gap-3">
                  {session?.connected ? (
                    <Button
                      variant="outline"
                      className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => void handleDisconnect()}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Disconnect YouTube
                    </Button>
                  ) : (
                    <Button
                      className="bg-[linear-gradient(135deg,rgba(34,211,238,0.9),rgba(251,146,60,0.9))] font-semibold text-black hover:opacity-95"
                      onClick={handleConnect}
                      disabled={!session?.configured}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Connect YouTube
                    </Button>
                  )}

                  {isLoadingSession && (
                    <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Resolving session
                    </span>
                  )}
                </div>

                {session?.connected ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {channels.map((channel) => (
                        <div
                          key={channel.id}
                          className="rounded-2xl border border-white/8 bg-black/20 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-1 rounded-xl border border-cyan-300/15 bg-cyan-400/10 p-2 text-cyan-100">
                              <TvMinimalPlay className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-white">
                                {channel.title}
                              </div>
                              <div className="mt-1 text-xs text-zinc-500">{channel.id}</div>
                              {channel.customUrl ? (
                                <div className="mt-2 text-xs text-cyan-200">{channel.customUrl}</div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {channels.length > 1 ? (
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/8 p-4 text-sm text-amber-50/85">
                        Google can expose more than one accessible channel, but uploads still follow the channel tied to the OAuth consent flow. If this does not match the target channel, reconnect using the correct identity.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-zinc-400">
                    Connect YouTube first to unlock categories, languages, and the access-token bridge used by the direct browser upload.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <WandSparkles className="h-5 w-5 text-emerald-300" />
                  AI metadata assistant
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  Use the existing <code>video_info</code> pipeline for upload-ready packaging. Suggestions stay separate until you explicitly apply them into the draft.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">OpenAI key</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">OpenAI</Badge>
                        <Badge
                          className={cn(
                            hasOpenAIApiKey
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                              : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                          )}
                        >
                          {hasOpenAIApiKey ? `Saved ${maskedOpenAIApiKey}` : "Missing"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                    <Input
                      value={openAIApiKeyDraft}
                      onChange={(event) => setOpenAIApiKeyDraft(event.target.value)}
                      placeholder="Paste the OpenAI key used for creator metadata"
                      className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                    />
                    <Button
                      type="button"
                      className="bg-white text-black hover:bg-zinc-200"
                      onClick={handleSaveOpenAIApiKey}
                    >
                      <KeyRound className="mr-2 h-4 w-4" />
                      Save key
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                      onClick={handleClearOpenAIApiKey}
                      disabled={!hasOpenAIApiKey}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Metadata blocks</div>
                      <div className="text-xs text-zinc-500">
                        Upload-focused blocks are enabled by default. Advanced blocks stay optional.
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="bg-white/5 text-white hover:bg-white/10"
                      onClick={() => setShowAdvancedAiBlocks((prev) => !prev)}
                    >
                      {showAdvancedAiBlocks ? "Hide advanced" : "Show advanced"}
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {PRIMARY_VIDEO_INFO_BLOCK_OPTIONS.map((option) => (
                      <BlockToggle
                        key={option.value}
                        option={option}
                        enabled={videoInfoBlocksSet.has(option.value)}
                        onToggle={() => setVideoInfoBlocks((prev) => toggleBlock(prev, option.value))}
                      />
                    ))}
                  </div>

                  {showAdvancedAiBlocks ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {ADVANCED_VIDEO_INFO_BLOCK_OPTIONS.map((option) => (
                        <BlockToggle
                          key={option.value}
                          option={option}
                          enabled={videoInfoBlocksSet.has(option.value)}
                          onToggle={() => setVideoInfoBlocks((prev) => toggleBlock(prev, option.value))}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-white">Project metadata generation</div>
                      <div className="text-xs leading-relaxed text-zinc-500">
                        {historyError
                          ? historyError
                          : hasTranscriptContext
                            ? `Using the latest transcript from ${selectedHistoryItem?.filename || "the active project source"}.`
                            : "Metadata generation unlocks automatically when this project has a transcript."}
                      </div>
                    </div>
                    <Button
                      type="button"
                      onClick={() => void handleGenerateVideoInfo()}
                      disabled={!hasTranscriptContext || !hasOpenAIApiKey || isGeneratingVideoInfo || videoInfoBlocks.length === 0}
                      className="bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(16,185,129,0.95))] font-semibold text-black hover:opacity-95"
                    >
                      {isGeneratingVideoInfo ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <WandSparkles className="mr-2 h-4 w-4" />
                      )}
                      Generate metadata
                    </Button>
                  </div>
                </div>

                {selectedProjectId && !isLoadingHistory && projectHistory.length === 0 ? (
                  <Alert className="border-white/10 bg-black/20 text-zinc-200">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>No transcript available yet</AlertTitle>
                    <AlertDescription className="text-zinc-400">
                      You can upload manually right now. AI metadata will unlock as soon as this project has a transcript.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {videoInfoError ? (
                  <Alert className="border-red-400/25 bg-red-400/10 text-red-50">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Metadata generation failed</AlertTitle>
                    <AlertDescription className="text-red-50/80">{videoInfoError}</AlertDescription>
                  </Alert>
                ) : null}

                {videoInfoAnalysis ? (
                  <div className="space-y-4">
                    {videoInfoBlocksSet.has("titleIdeas") ? (
                      <AiResultCard
                        title="Title ideas"
                        description="Pick one suggestion or copy the full set into another workflow."
                      >
                        <div className="space-y-2">
                          {videoInfoAnalysis.youtube.titleIdeas.map((title, index) => (
                            <div
                              key={`${index}-${title}`}
                              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="text-sm text-white/90">
                                  <span className="mr-2 text-cyan-300">{index + 1}.</span>
                                  {title}
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(title, "Title idea")}>
                                    <Copy className="mr-2 h-3.5 w-3.5" />
                                    Copy
                                  </Button>
                                  <Button size="sm" className="bg-white text-black hover:bg-zinc-200" onClick={() => applyTitleIdea(title)}>
                                    Use
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </AiResultCard>
                    ) : null}

                    {videoInfoBlocksSet.has("description") ? (
                      <AiResultCard
                        title="Description draft"
                        description="Use the full draft as-is, or keep it separate while you finalize the form manually."
                      >
                        <Textarea
                          readOnly
                          value={videoInfoAnalysis.youtube.description}
                          className="min-h-44 border-white/10 bg-black/25 text-white"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(videoInfoAnalysis.youtube.description, "Description")}>
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy
                          </Button>
                          <Button size="sm" className="bg-white text-black hover:bg-zinc-200" onClick={() => applyDescriptionDraft(videoInfoAnalysis.youtube.description)}>
                            Use description
                          </Button>
                        </div>
                      </AiResultCard>
                    ) : null}

                    {videoInfoBlocksSet.has("hashtagsSeo") ? (
                      <AiResultCard
                        title="Hashtags + SEO"
                        description="Fill the upload tags field from the combined AI hashtag and keyword output."
                      >
                        <div className="flex flex-wrap gap-2">
                          {videoInfoAnalysis.youtube.hashtags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => void copyText(tag, "Hashtag")}
                              className="rounded-full border border-cyan-300/20 bg-cyan-400/5 px-2.5 py-1 text-xs text-cyan-100 transition-colors hover:bg-cyan-400/10"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
                          {videoInfoAnalysis.youtube.seoKeywords.join(", ")}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(videoInfoAnalysis.youtube.seoKeywords.join(", "), "SEO keywords")}>
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy keywords
                          </Button>
                          <Button size="sm" className="bg-white text-black hover:bg-zinc-200" onClick={() => applyTagsDraft(videoInfoAnalysis)}>
                            Use tags in form
                          </Button>
                        </div>
                      </AiResultCard>
                    ) : null}

                    {videoInfoBlocksSet.has("chapters") ? (
                      <AiResultCard
                        title="Chapter block"
                        description="Keep chapters adjacent to the description draft and decide how aggressively to merge them."
                      >
                        <Textarea
                          readOnly
                          value={videoInfoAnalysis.youtube.chapterText}
                          className="min-h-32 border-white/10 bg-black/25 text-white"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(videoInfoAnalysis.youtube.chapterText, "Chapter block")}>
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy
                          </Button>
                          <Button size="sm" className="bg-white text-black hover:bg-zinc-200" onClick={() => appendChaptersToDraft(videoInfoAnalysis.youtube.chapterText)}>
                            Append to description
                          </Button>
                          <Button size="sm" variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={() => replaceDescriptionWithChapters(videoInfoAnalysis.youtube.chapterText)}>
                            Replace with chapters
                          </Button>
                        </div>
                      </AiResultCard>
                    ) : null}

                    {videoInfoBlocksSet.has("pinnedComment") || videoInfoBlocksSet.has("thumbnailHooks") ? (
                      <AiResultCard
                        title="Packaging extras"
                        description="Keep the pinned comment and thumbnail hooks nearby without forcing them into upload metadata."
                      >
                        {videoInfoBlocksSet.has("pinnedComment") ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/85">
                            {videoInfoAnalysis.youtube.pinnedComment}
                          </div>
                        ) : null}
                        {videoInfoBlocksSet.has("thumbnailHooks") ? (
                          <div className="grid gap-2">
                            {videoInfoAnalysis.youtube.thumbnailHooks.map((hook) => (
                              <div key={hook} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/85">
                                {hook}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {videoInfoBlocksSet.has("pinnedComment") ? (
                            <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(videoInfoAnalysis.youtube.pinnedComment, "Pinned comment")}>
                              <Copy className="mr-2 h-3.5 w-3.5" />
                              Copy pinned comment
                            </Button>
                          ) : null}
                          {videoInfoBlocksSet.has("thumbnailHooks") ? (
                            <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(videoInfoAnalysis.youtube.thumbnailHooks.join("\n"), "Thumbnail hooks")}>
                              <Copy className="mr-2 h-3.5 w-3.5" />
                              Copy hooks
                            </Button>
                          ) : null}
                        </div>
                      </AiResultCard>
                    ) : null}

                    {showContentPack || showInsights ? (
                      <AiResultCard
                        title="Advanced analysis"
                        description="These blocks stay optional and never write directly into the upload draft."
                      >
                        {showContentPack ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/85">
                            <div className="font-medium text-white">Summary</div>
                            <div className="mt-2 leading-relaxed text-zinc-300">{videoInfoAnalysis.content.videoSummary}</div>
                            <div className="mt-4 grid gap-2 md:grid-cols-2">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Hooks</div>
                                <div className="mt-2 space-y-2">
                                  {videoInfoAnalysis.content.hookIdeas.map((hook) => (
                                    <div key={hook} className="rounded-xl border border-white/8 bg-black/20 p-2.5">
                                      {hook}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Repurpose</div>
                                <div className="mt-2 space-y-2">
                                  {videoInfoAnalysis.content.repurposeIdeas.map((idea) => (
                                    <div key={idea} className="rounded-xl border border-white/8 bg-black/20 p-2.5">
                                      {idea}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {showInsights ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Words</div>
                              <div className="mt-2 text-2xl font-semibold text-white">{videoInfoAnalysis.insights.transcriptWordCount}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">WPM</div>
                              <div className="mt-2 text-2xl font-semibold text-white">{videoInfoAnalysis.insights.estimatedSpeakingRateWpm}</div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:col-span-2">
                              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Theme</div>
                              <div className="mt-2 text-sm text-white/85">{videoInfoAnalysis.insights.detectedTheme}</div>
                            </div>
                          </div>
                        ) : null}
                      </AiResultCard>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-zinc-400">
                    Generated metadata will land here. The final publish draft on the right stays untouched until you explicitly apply a suggestion.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-orange-300" />
                  Video source
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  Choose whether the upload should stream a local file or a finished ClipScribe export.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(event) => handleLocalVideoSelection(event.target.files?.[0] ?? null)}
                />

                {sourceMode === "local_file" ? (
                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    className="group rounded-[26px] border border-dashed border-cyan-300/20 bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(255,255,255,0.015))] p-6 transition-colors hover:border-cyan-300/35"
                  >
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.22em] text-zinc-300">
                          <CloudUpload className="h-3.5 w-3.5" />
                          Drag & drop
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold text-white">Drop a finished MP4/MOV/WebM here</h3>
                          <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
                            The file stays in the browser and is streamed directly to YouTube after OAuth. ClipScribe does not proxy the video bytes through the server.
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                        onClick={() => videoInputRef.current?.click()}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Choose file
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[26px] border border-emerald-300/15 bg-[linear-gradient(180deg,rgba(16,185,129,0.10),rgba(255,255,255,0.015))] p-6">
                    <div className="flex flex-col gap-4">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.22em] text-zinc-300">
                        <FileVideo className="h-3.5 w-3.5" />
                        Project export
                      </div>
                      {selectedExportOption ? (
                        <div className="space-y-2">
                          <h3 className="text-xl font-semibold text-white">{selectedExportOption.filename}</h3>
                          <p className="text-sm leading-relaxed text-zinc-400">
                            Uploading the stored {selectedExportOption.kind === "timeline" ? "timeline" : "short"} export from the selected project.
                          </p>
                          <div className="text-xs text-zinc-500">{selectedSourceLabel}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-zinc-400">
                          Choose a project and completed export in the workflow context card to unlock project-backed upload.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeVideoFile ? (
                  <div className="space-y-4 rounded-[26px] border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{activeVideoFile.name}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {(activeVideoFile.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                      {sourceMode === "local_file" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-zinc-300 hover:bg-white/10 hover:text-white"
                          onClick={() => handleLocalVideoSelection(null)}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                    {videoPreviewUrl ? (
                      <video
                        className="aspect-video w-full rounded-2xl border border-white/10 bg-black"
                        controls
                        preload="metadata"
                        src={videoPreviewUrl}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-zinc-500">
                    No upload video selected yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-emerald-300" />
                  Publish draft
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  Manual inputs stay authoritative. AI only fills these fields when you explicitly tell it to.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="grid gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="yt-title" className="text-zinc-200">
                      Title
                    </Label>
                    <Input
                      id="yt-title"
                      value={publishDraft.title}
                      onChange={(event) =>
                        setPublishDraft((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Give the video a precise, human title"
                      className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="yt-description" className="text-zinc-200">
                      Description
                    </Label>
                    <Textarea
                      id="yt-description"
                      value={publishDraft.description}
                      onChange={(event) =>
                        setPublishDraft((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Write the final description exactly as it should land on YouTube"
                      className="min-h-44 border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-zinc-200">Privacy</Label>
                      <Select value={privacyStatus} onValueChange={(value: YouTubePrivacyStatus) => setPrivacyStatus(value)}>
                        <SelectTrigger className="border-white/10 bg-black/25 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="private">Private</SelectItem>
                          <SelectItem value="unlisted">Unlisted</SelectItem>
                          <SelectItem value="public">Public</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-zinc-200">Category</Label>
                      <Select value={categoryId} onValueChange={setCategoryId} disabled={!catalog}>
                        <SelectTrigger className="border-white/10 bg-black/25 text-white">
                          <SelectValue placeholder={catalog ? "Select a category" : "Connect YouTube first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog?.categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Accordion
                  type="multiple"
                  className="rounded-[24px] border border-white/8 bg-black/20 px-5"
                  defaultValue={["discovery"]}
                >
                  <AccordionItem value="discovery" className="border-white/8">
                    <AccordionTrigger className="py-5 text-white hover:no-underline">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-cyan-300/15 bg-cyan-400/10 p-2 text-cyan-100">
                          <Languages className="h-4 w-4" />
                        </div>
                        <div className="text-left">
                          <div className="font-medium">Discovery & scheduling</div>
                          <div className="text-xs text-zinc-500">Language, tags, category, publish time.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label className="text-zinc-200">Default language</Label>
                          <Select value={defaultLanguage} onValueChange={setDefaultLanguage} disabled={!catalog}>
                            <SelectTrigger className="border-white/10 bg-black/25 text-white">
                              <SelectValue placeholder="Choose language" />
                            </SelectTrigger>
                            <SelectContent>
                              {catalog?.languages.map((language) => (
                                <SelectItem key={language.id} value={language.id}>
                                  {language.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="yt-recording-date" className="text-zinc-200">
                            Recording date
                          </Label>
                          <Input
                            id="yt-recording-date"
                            type="date"
                            value={recordingDate}
                            onChange={(event) => setRecordingDate(event.target.value)}
                            className="border-white/10 bg-black/25 text-white"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="yt-tags" className="text-zinc-200">
                          Tags
                        </Label>
                        <Input
                          id="yt-tags"
                          value={publishDraft.tagsInput}
                          onChange={(event) =>
                            setPublishDraft((prev) => ({
                              ...prev,
                              tagsInput: event.target.value,
                            }))
                          }
                          placeholder="workflow, clip editing, youtube upload"
                          className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="yt-publish-at" className="text-zinc-200">
                          Publish at
                        </Label>
                        <Input
                          id="yt-publish-at"
                          type="datetime-local"
                          value={publishAt}
                          onChange={(event) => setPublishAt(event.target.value)}
                          className="border-white/10 bg-black/25 text-white"
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="compliance" className="border-white/8">
                    <AccordionTrigger className="py-5 text-white hover:no-underline">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/10 p-2 text-emerald-100">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div className="text-left">
                          <div className="font-medium">Compliance & distribution</div>
                          <div className="text-xs text-zinc-500">Audience flags, embeddability, visibility knobs.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <div className="grid gap-3">
                        {[
                          {
                            label: "Notify subscribers",
                            description: "Leave off by default to avoid accidental notifications during testing.",
                            checked: notifySubscribers,
                            onCheckedChange: setNotifySubscribers,
                          },
                          {
                            label: "Embeddable",
                            description: "Allow the uploaded video to be embedded on external sites.",
                            checked: embeddable,
                            onCheckedChange: setEmbeddable,
                          },
                          {
                            label: "Public stats viewable",
                            description: "Expose public view/like counters when YouTube allows them.",
                            checked: publicStatsViewable,
                            onCheckedChange: setPublicStatsViewable,
                          },
                          {
                            label: "Made for kids",
                            description: "Set the self-declared audience flag immediately in the upload metadata.",
                            checked: selfDeclaredMadeForKids,
                            onCheckedChange: setSelfDeclaredMadeForKids,
                          },
                          {
                            label: "Contains synthetic media",
                            description: "Useful when the final piece includes AI-generated or materially synthetic content.",
                            checked: containsSyntheticMedia,
                            onCheckedChange: setContainsSyntheticMedia,
                          },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3"
                          >
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-white">{item.label}</div>
                              <div className="text-xs leading-relaxed text-zinc-500">
                                {item.description}
                              </div>
                            </div>
                            <Switch checked={item.checked} onCheckedChange={item.onCheckedChange} />
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label className="text-zinc-200">License</Label>
                          <Select value={license} onValueChange={(value: YouTubeLicense) => setLicense(value)}>
                            <SelectTrigger className="border-white/10 bg-black/25 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="youtube">Standard YouTube License</SelectItem>
                              <SelectItem value="creativeCommon">Creative Commons</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="localizations" className="border-white/8">
                    <AccordionTrigger className="py-5 text-white hover:no-underline">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-violet-300/15 bg-violet-400/10 p-2 text-violet-100">
                          <Languages className="h-4 w-4" />
                        </div>
                        <div className="text-left">
                          <div className="font-medium">Localized metadata</div>
                          <div className="text-xs text-zinc-500">Optional per-locale title and description pairs.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      {!defaultLanguage ? (
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-zinc-400">
                          Pick a default language first, then add locale-specific overrides.
                        </div>
                      ) : null}

                      <div className="space-y-4">
                        {localizations.map((row) => (
                          <div key={row.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                            <div className="grid gap-3 sm:grid-cols-[0.8fr_1fr]">
                              <div className="grid gap-2">
                                <Label className="text-zinc-200">Locale code</Label>
                                <Input
                                  value={row.locale}
                                  onChange={(event) => updateLocalization(row.id, "locale", event.target.value)}
                                  placeholder="es, en-US, fr"
                                  className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label className="text-zinc-200">Localized title</Label>
                                <Input
                                  value={row.title}
                                  onChange={(event) => updateLocalization(row.id, "title", event.target.value)}
                                  placeholder="Localized title"
                                  className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                                />
                              </div>
                            </div>
                            <div className="mt-3 grid gap-2">
                              <Label className="text-zinc-200">Localized description</Label>
                              <Textarea
                                value={row.description}
                                onChange={(event) => updateLocalization(row.id, "description", event.target.value)}
                                className="min-h-24 border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                              />
                            </div>
                            <div className="mt-3 flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-zinc-300 hover:bg-white/10 hover:text-white"
                                onClick={() => removeLocalization(row.id)}
                              >
                                Remove locale
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button
                        variant="outline"
                        className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                        onClick={addLocalization}
                        disabled={!defaultLanguage}
                      >
                        Add localized block
                      </Button>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="assets" className="border-b-0">
                    <AccordionTrigger className="py-5 text-white hover:no-underline">
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-orange-300/15 bg-orange-400/10 p-2 text-orange-100">
                          <FileImage className="h-4 w-4" />
                        </div>
                        <div className="text-left">
                          <div className="font-medium">Optional assets</div>
                          <div className="text-xs text-zinc-500">Thumbnail and SRT caption track.</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <input
                            ref={thumbnailInputRef}
                            type="file"
                            accept="image/png,image/jpeg"
                            className="hidden"
                            onChange={(event) => setThumbnailFile(event.target.files?.[0] ?? null)}
                          />
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-white">Thumbnail</div>
                              <div className="mt-1 text-xs text-zinc-500">Manual JPG/PNG upload for <code>thumbnails.set</code>.</div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => thumbnailInputRef.current?.click()}
                            >
                              Pick
                            </Button>
                          </div>
                          <div className="mt-4 rounded-xl border border-dashed border-white/8 bg-black/20 p-3 text-sm text-zinc-400">
                            {thumbnailFile ? thumbnailFile.name : "No thumbnail selected"}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <input
                            ref={captionInputRef}
                            type="file"
                            accept=".srt"
                            className="hidden"
                            onChange={(event) => setCaptionFile(event.target.files?.[0] ?? null)}
                          />
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-white">Caption track</div>
                              <div className="mt-1 text-xs text-zinc-500">Optional <code>.srt</code> sent via <code>captions.insert</code>.</div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                              onClick={() => captionInputRef.current?.click()}
                            >
                              Pick
                            </Button>
                          </div>
                          <div className="mt-4 rounded-xl border border-dashed border-white/8 bg-black/20 p-3 text-sm text-zinc-400">
                            {captionFile ? captionFile.name : "No SRT selected"}
                          </div>
                        </div>
                      </div>

                      {captionFile ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="grid gap-2">
                            <Label className="text-zinc-200">Caption language</Label>
                            <Select value={captionLanguage} onValueChange={setCaptionLanguage} disabled={!catalog}>
                              <SelectTrigger className="border-white/10 bg-black/25 text-white">
                                <SelectValue placeholder="Choose caption language" />
                              </SelectTrigger>
                              <SelectContent>
                                {catalog?.languages.map((language) => (
                                  <SelectItem key={language.id} value={language.id}>
                                    {language.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label className="text-zinc-200">Caption name</Label>
                            <Input
                              value={captionName}
                              onChange={(event) => setCaptionName(event.target.value)}
                              placeholder="English captions"
                              className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
                            />
                          </div>
                          <div className="sm:col-span-2 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <div className="text-sm font-medium text-white">Create caption as draft</div>
                                <div className="mt-1 text-xs text-zinc-500">
                                  Leave this on if you want to review captions inside YouTube Studio before they go live.
                                </div>
                              </div>
                              <Switch checked={captionIsDraft} onCheckedChange={setCaptionIsDraft} />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <Separator className="bg-white/8" />

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="text-sm text-zinc-400">
                    Uploads use your live OAuth session and will fail fast if it is not connected.
                  </div>
                  <Button
                    onClick={() => void handleUpload()}
                    disabled={!canUpload || isUploading}
                    className="min-w-[190px] bg-[linear-gradient(135deg,rgba(34,211,238,0.9),rgba(16,185,129,0.9))] font-semibold text-black hover:opacity-95"
                  >
                    {isUploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Upload to YouTube
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-fuchsia-300" />
                  Progress & result
                </CardTitle>
                <CardDescription className="text-zinc-400">
                  The browser handles the resumable upload, then we collect the resulting YouTube ids and processing state.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="rounded-[26px] border border-white/8 bg-black/20 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.26em] text-zinc-500">Upload status</div>
                      <div className="mt-2 text-lg font-medium text-white">
                        {uploadProgress?.message || "Ready for a new upload"}
                      </div>
                    </div>
                    <ProgressBadge progress={uploadProgress} />
                  </div>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/6">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,rgba(34,211,238,0.95),rgba(16,185,129,0.95))] transition-all duration-300"
                      style={{ width: `${uploadProgress?.percent ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-3 text-xs text-zinc-500">
                    {uploadProgress ? `${uploadProgress.percent}% complete` : "No network activity yet"}
                  </div>
                </div>

                {uploadError ? (
                  <Alert className="border-red-400/25 bg-red-400/10 text-red-50">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Upload failed</AlertTitle>
                    <AlertDescription className="text-red-50/80">{uploadError}</AlertDescription>
                  </Alert>
                ) : null}

                {publishResult ? (
                  <div className="space-y-4">
                    <div className="rounded-[26px] border border-emerald-400/20 bg-emerald-400/8 p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-emerald-100">
                            <CheckCircle2 className="h-4 w-4" />
                            Upload completed
                          </div>
                          <div className="mt-2 text-sm text-emerald-50/80">
                            Video ID <span className="font-mono text-emerald-100">{publishResult.videoId}</span>
                          </div>
                        </div>
                        <Badge className="border-emerald-400/25 bg-black/20 text-emerald-100">
                          {publishResult.processing.processingStatus}
                        </Badge>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <a
                          href={publishResult.watchUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white transition-colors hover:bg-black/35"
                        >
                          Watch page
                          <ChevronRight className="h-4 w-4" />
                        </a>
                        <a
                          href={publishResult.studioUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-white transition-colors hover:bg-black/35"
                        >
                          Open in Studio
                          <ChevronRight className="h-4 w-4" />
                        </a>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className={cn("rounded-2xl border p-4", resultTone(publishResult.thumbnail.ok))}>
                        <div className="text-sm font-medium">Thumbnail</div>
                        <div className="mt-2 text-sm">
                          {publishResult.thumbnail.ok ? "Applied successfully" : publishResult.thumbnail.error}
                        </div>
                      </div>
                      <div className={cn("rounded-2xl border p-4", resultTone(publishResult.caption.ok))}>
                        <div className="text-sm font-medium">Caption</div>
                        <div className="mt-2 text-sm">
                          {publishResult.caption.ok ? "Applied successfully" : publishResult.caption.error}
                        </div>
                      </div>
                    </div>

                    {publishResult.processing.failureReason || publishResult.processing.rejectionReason ? (
                      <Alert className="border-amber-400/25 bg-amber-400/10 text-amber-50">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>YouTube reported a processing issue</AlertTitle>
                        <AlertDescription className="text-amber-50/80">
                          {publishResult.processing.failureReason || publishResult.processing.rejectionReason}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[26px] border border-dashed border-white/10 bg-black/20 p-6 text-sm text-zinc-500">
                    When the upload finishes, this panel will show the YouTube video id, watch/studio links, processing status, and any partial failures for thumbnails or captions.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
