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
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  FileImage,
  FileText,
  FileVideo,
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

import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import { resolveProjectVideoInfoHistory } from "@/lib/creator/video-info-storage";
import {
  buildProjectYouTubeUploadRecord,
  getEligibleYouTubeProjectAssets,
  getEligibleYouTubeProjectExports,
  resolveInitialYouTubePublishSelection,
  type YouTubePublishDraft,
  type YouTubePublishSourceMode,
} from "@/lib/creator/youtube-publish";
import type { ProjectYouTubeUploadRecord } from "@/lib/projects/types";
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
  YouTubePublishStepResult,
  YouTubeSessionStatus,
  YouTubeThumbnailUpload,
  YouTubeUploadDraft,
} from "@/lib/youtube/types";
import { cn } from "@/lib/utils";

import { AiAutoloadPicker, AiAutoloadButton, type AutoloadField } from "@/components/creator/AiAutoloadPicker";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type LocalizationRow = YouTubeLocalizationInput & {
  id: string;
};

type OptionalBooleanSelectValue = "unset" | "true" | "false";

type SessionPayload = YouTubeSessionStatus & {
  error?: string;
};

type OptionsPayload = {
  ok: true;
  regionCode: string;
  categories: YouTubeOptionCatalog["categories"];
  languages: YouTubeOptionCatalog["languages"];
};

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

function formatDateTime(value: number | undefined) {
  if (!value) return "No token expiry available";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateTimeInput(value: string) {
  if (!value.trim()) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateInput(value: string) {
  if (!value.trim()) return "Not set";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function resultTone(state: YouTubePublishStepResult["state"]) {
  if (state === "applied") {
    return "border-emerald-400/25 bg-emerald-400/8 text-emerald-200";
  }
  if (state === "skipped") {
    return "border-white/10 bg-white/[0.03] text-zinc-200";
  }
  return "border-amber-400/25 bg-amber-400/10 text-amber-100";
}

function resultMessage(
  result: YouTubePublishStepResult,
  labels: {
    applied: string;
    skipped: string;
    failed: string;
  }
) {
  if (result.state === "applied") return labels.applied;
  if (result.state === "skipped") return labels.skipped;
  return result.error || labels.failed;
}

function toOptionalBooleanSelectValue(value: boolean | undefined): OptionalBooleanSelectValue {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unset";
}

function fromOptionalBooleanSelectValue(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function formatOptionalBoolean(
  value: boolean | undefined,
  labels: {
    trueLabel: string;
    falseLabel: string;
    unsetLabel?: string;
  }
) {
  if (value === true) return labels.trueLabel;
  if (value === false) return labels.falseLabel;
  return labels.unsetLabel ?? "Not set";
}

function formatOptionalLicense(value: YouTubeLicense | undefined) {
  if (value === "youtube") return "Standard YouTube License";
  if (value === "creativeCommon") return "Creative Commons";
  return "Not set";
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
  notifySubscribers: boolean | undefined;
  embeddable: boolean | undefined;
  license: YouTubeLicense | undefined;
  publicStatsViewable: boolean | undefined;
  publishAt: string;
  selfDeclaredMadeForKids: boolean | undefined;
  containsSyntheticMedia: boolean | undefined;
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



export function YouTubeUploadHub({
  projectId,
  initialAssetId,
  initialExportId,
  embedded = false,
  onUploadSuccess,
}: {
  projectId?: string;
  initialAssetId?: string;
  initialExportId?: string;
  embedded?: boolean;
  onUploadSuccess?: (record: ProjectYouTubeUploadRecord) => Promise<void> | void;
} = {}) {
  const searchParams = useSearchParams();
  const {
    projects,
    assetsByProjectId,
    exportsByProjectId,
    isLoading: isLoadingProjects,
  } = useProjectLibrary();
  const isProjectLocked = !!projectId;
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [sourceMode, setSourceMode] = useState<YouTubePublishSourceMode>("local_file");
  const [selectedAssetId, setSelectedAssetId] = useState(initialAssetId ?? "");
  const [selectedExportId, setSelectedExportId] = useState(initialExportId ?? "");

  // Autoload picker state
  const [autoloadField, setAutoloadField] = useState<AutoloadField>("all");
  const [autoloadPickerOpen, setAutoloadPickerOpen] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );
  const hasAiGenerations = useMemo(
    () => resolveProjectVideoInfoHistory(selectedProject).length > 0,
    [selectedProject]
  );

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
  const [notifySubscribers, setNotifySubscribers] = useState<boolean | undefined>(undefined);
  const [embeddable, setEmbeddable] = useState<boolean | undefined>(undefined);
  const [license, setLicense] = useState<YouTubeLicense | undefined>(undefined);
  const [publicStatsViewable, setPublicStatsViewable] = useState<boolean | undefined>(undefined);
  const [publishAt, setPublishAt] = useState("");
  const [selfDeclaredMadeForKids, setSelfDeclaredMadeForKids] = useState<boolean | undefined>(undefined);
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState<boolean | undefined>(undefined);
  const [recordingDate, setRecordingDate] = useState("");
  const [localizations, setLocalizations] = useState<LocalizationRow[]>([]);
  const [captionLanguage, setCaptionLanguage] = useState("");
  const [captionName, setCaptionName] = useState("");
  const [captionIsDraft, setCaptionIsDraft] = useState(false);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);

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
  const assetOptionsByProjectId = useMemo(() => {
    return new Map(
      projects.map((project) => {
        const assets = assetsByProjectId.get(project.id) ?? [];
        return [project.id, getEligibleYouTubeProjectAssets(assets)];
      })
    );
  }, [assetsByProjectId, projects]);
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
    if (initialSelectionAppliedRef.current || isLoadingProjects || projects.length === 0) {
      return;
    }

    const resolved = resolveInitialYouTubePublishSelection({
      projectId: projectId ?? searchParams.get("projectId"),
      assetId: initialAssetId ?? searchParams.get("assetId"),
      exportId: initialExportId ?? searchParams.get("exportId"),
      availableProjectIds,
      assetOptionsByProjectId,
      exportOptionsByProjectId,
    });

    initialSelectionAppliedRef.current = true;
    setSelectedProjectId(
      projectId || resolved.projectId || (projects.length === 1 ? projects[0]?.id ?? "" : "")
    );
    setSelectedAssetId(resolved.assetId);
    setSelectedExportId(resolved.exportId);
    setSourceMode(resolved.sourceMode);
  }, [assetOptionsByProjectId, availableProjectIds, exportOptionsByProjectId, initialAssetId, initialExportId, isLoadingProjects, projectId, projects, searchParams]);

  useEffect(() => {
    if (!projectId) return;
    setSelectedProjectId(projectId);
  }, [projectId]);

  const projectAssets = useMemo(
    () => (selectedProjectId ? assetsByProjectId.get(selectedProjectId) ?? [] : []),
    [assetsByProjectId, selectedProjectId]
  );
  const projectAssetsById = useMemo(
    () => new Map(projectAssets.map((asset) => [asset.id, asset])),
    [projectAssets]
  );
  const eligibleProjectAssetOptions = useMemo(
    () => (selectedProjectId ? getEligibleYouTubeProjectAssets(projectAssets) : []),
    [projectAssets, selectedProjectId]
  );
  const eligibleExportOptions = useMemo(
    () => (selectedProjectId ? getEligibleYouTubeProjectExports(exportsByProjectId.get(selectedProjectId) ?? [], projectAssetsById) : []),
    [exportsByProjectId, projectAssetsById, selectedProjectId]
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedAssetId("");
      setSelectedExportId("");
      return;
    }

    if (!selectedAssetId || !eligibleProjectAssetOptions.some((option) => option.assetId === selectedAssetId)) {
      setSelectedAssetId(eligibleProjectAssetOptions[0]?.assetId ?? "");
    }
  }, [eligibleProjectAssetOptions, selectedAssetId, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedExportId("");
      return;
    }

    if (!selectedExportId || !eligibleExportOptions.some((option) => option.exportId === selectedExportId)) {
      setSelectedExportId(eligibleExportOptions[0]?.exportId ?? "");
    }
  }, [eligibleExportOptions, selectedExportId, selectedProjectId]);

  const selectedAssetOption = useMemo(
    () => eligibleProjectAssetOptions.find((option) => option.assetId === selectedAssetId) ?? null,
    [eligibleProjectAssetOptions, selectedAssetId]
  );

  const selectedExportOption = useMemo(
    () => eligibleExportOptions.find((option) => option.exportId === selectedExportId) ?? null,
    [eligibleExportOptions, selectedExportId]
  );

  useEffect(() => {
    if (initialAssetId && eligibleProjectAssetOptions.some((option) => option.assetId === initialAssetId)) {
      setSelectedAssetId(initialAssetId);
      setSelectedExportId("");
      setSourceMode("project_asset");
      return;
    }

    if (initialExportId && eligibleExportOptions.some((option) => option.exportId === initialExportId)) {
      setSelectedExportId(initialExportId);
      setSelectedAssetId("");
      setSourceMode("project_export");
    }
  }, [eligibleExportOptions, eligibleProjectAssetOptions, initialAssetId, initialExportId]);

  const activeVideoFile =
    sourceMode === "project_asset"
      ? selectedAssetOption?.file ?? null
      : sourceMode === "project_export"
        ? selectedExportOption?.file ?? null
        : localVideoFile;

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
  const categoryLabel = useMemo(
    () => catalog?.categories.find((category) => category.id === categoryId)?.title ?? "Not set",
    [catalog, categoryId]
  );
  const defaultLanguageLabel = useMemo(
    () => catalog?.languages.find((language) => language.id === defaultLanguage)?.name ?? "Not set",
    [catalog, defaultLanguage]
  );
  const captionLanguageLabel = useMemo(
    () => catalog?.languages.find((language) => language.id === captionLanguage)?.name ?? (captionLanguage || "Not set"),
    [captionLanguage, catalog]
  );
  const privacyLabel = useMemo(() => {
    switch (privacyStatus) {
      case "public":
        return "Public";
      case "unlisted":
        return "Unlisted (hidden, share by link)";
      default:
        return "Private";
    }
  }, [privacyStatus]);


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


  const addLocalization = () => {
    setLocalizations((prev) => [...prev, createEmptyLocalization()]);
  };

  const updateLocalization = (id: string, field: keyof YouTubeLocalizationInput, value: string) => {
    setLocalizations((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const removeLocalization = (id: string) => {
    setLocalizations((prev) => prev.filter((row) => row.id !== id));
  };

  const openAutoloadPicker = (field: AutoloadField) => {
    setAutoloadField(field);
    setAutoloadPickerOpen(true);
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

    setIsConfirmDialogOpen(false);
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
      if (projectId) {
        const record = buildProjectYouTubeUploadRecord({
          projectId,
          sourceMode,
          sourceAssetId: sourceMode === "project_asset" ? selectedAssetId || undefined : undefined,
          sourceExportId: sourceMode === "project_export" ? selectedExportId || undefined : undefined,
          outputAssetId: sourceMode === "project_export" ? selectedExportOption?.outputAssetId : undefined,
          sourceFilename:
            sourceMode === "project_asset"
              ? selectedAssetOption?.filename || activeVideoFile.name
              : sourceMode === "project_export"
                ? selectedExportOption?.filename || activeVideoFile.name
                : activeVideoFile.name,
          draft: currentDraft,
          result,
        });
        await onUploadSuccess?.(record);
      }
      toast.success("YouTube upload finished");
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube upload failed.";
      setUploadError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const selectedAssetLabel = selectedAssetOption
    ? `Project asset • ${formatRelativeDate(selectedAssetOption.createdAt)}`
    : "No project video selected";
  const selectedSourceLabel = selectedExportOption
    ? `${selectedExportOption.kind === "timeline" ? "Timeline" : "Short"} export • ${formatRelativeDate(selectedExportOption.createdAt)}`
    : "No export selected";
  const sourceSummaryTitle =
    sourceMode === "project_asset" ? "Project asset" : sourceMode === "project_export" ? "Project export" : "Local file";
  const sourceSummaryLabel =
    sourceMode === "project_asset" ? selectedAssetLabel : sourceMode === "project_export" ? selectedSourceLabel : "Local file";
  const complianceRows = [
    { label: "Notify subscribers", value: formatOptionalBoolean(notifySubscribers, { trueLabel: "Yes", falseLabel: "No" }) },
    { label: "Embeddable", value: formatOptionalBoolean(embeddable, { trueLabel: "Yes", falseLabel: "No" }) },
    { label: "Public stats viewable", value: formatOptionalBoolean(publicStatsViewable, { trueLabel: "Yes", falseLabel: "No" }) },
    { label: "Made for kids", value: formatOptionalBoolean(selfDeclaredMadeForKids, { trueLabel: "Yes", falseLabel: "No" }) },
    { label: "Contains synthetic media", value: formatOptionalBoolean(containsSyntheticMedia, { trueLabel: "Yes", falseLabel: "No" }) },
    { label: "License", value: formatOptionalLicense(license) },
  ];



  return (
    <>
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

        <div className="grid gap-6 w-full">
          <div className="space-y-6">
            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <FileVideo className="h-5 w-5 text-cyan-300" />
                  Video source
                </CardTitle>
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

                  <div className="grid gap-3 md:grid-cols-3">
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
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceMode("project_asset")}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-colors",
                        sourceMode === "project_asset"
                          ? "border-amber-300/30 bg-amber-400/10 text-amber-50"
                          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      )}
                    >
                      <div className="text-sm font-semibold">Project asset</div>
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
                    </button>
                  </div>

                  {sourceMode === "project_asset" ? (
                    <div className="grid gap-2">
                      <Label className="text-zinc-200">Project video</Label>
                      <Select
                        value={selectedAssetId || "__none__"}
                        onValueChange={(value) => setSelectedAssetId(value === "__none__" ? "" : value)}
                        disabled={!selectedProjectId || eligibleProjectAssetOptions.length === 0}
                      >
                        <SelectTrigger className="border-white/10 bg-black/25 text-white">
                          <SelectValue placeholder={selectedProjectId ? "Select a project video" : "Choose a project first"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__" disabled>
                            {selectedProjectId ? "Choose a project video" : "Select a project first"}
                          </SelectItem>
                          {eligibleProjectAssetOptions.length === 0 ? (
                            <SelectItem value="__empty_assets__" disabled>
                              No eligible project videos yet
                            </SelectItem>
                          ) : (
                            eligibleProjectAssetOptions.map((option) => (
                              <SelectItem key={option.assetId} value={option.assetId}>
                                {option.filename} • {formatRelativeDate(option.createdAt)}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <div className="text-xs text-zinc-500">
                        {selectedAssetOption ? selectedAssetLabel : "Saved project videos will appear here when they have a readable video blob."}
                      </div>
                    </div>
                  ) : null}

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

          </div>


          <div className="space-y-6">
            <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <CardHeader className="border-b border-white/6">
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-orange-300" />
                  Video source
                </CardTitle>
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
                ) : sourceMode === "project_asset" ? (
                  <div className="rounded-[26px] border border-amber-300/15 bg-[linear-gradient(180deg,rgba(251,191,36,0.10),rgba(255,255,255,0.015))] p-6">
                    <div className="flex flex-col gap-4">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.22em] text-zinc-300">
                        <FileVideo className="h-3.5 w-3.5" />
                        Project asset
                      </div>
                      {selectedAssetOption ? (
                        <div className="space-y-2">
                          <h3 className="text-xl font-semibold text-white">{selectedAssetOption.filename}</h3>
                          <div className="text-xs text-zinc-500">{selectedAssetLabel}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-zinc-400">
                          Choose a project and saved project video in the workflow context card to unlock project-backed upload.
                        </div>
                      )}
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
                <CardTitle className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-emerald-300" />
                    Publish draft
                  </div>
                  {hasAiGenerations ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openAutoloadPicker("all")}
                      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    >
                      <WandSparkles className="mr-2 h-3.5 w-3.5" />
                      Autoload all
                    </Button>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="grid gap-5">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="yt-title" className="text-zinc-200">
                        Title
                      </Label>
                      <AiAutoloadButton 
                        disabled={!hasAiGenerations} 
                        onClick={() => openAutoloadPicker("title")} 
                      />
                    </div>
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
                    <div className="flex items-center justify-between">
                      <Label htmlFor="yt-description" className="text-zinc-200">
                        Description
                      </Label>
                      <AiAutoloadButton 
                        disabled={!hasAiGenerations} 
                        onClick={() => openAutoloadPicker("description")} 
                      />
                    </div>
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
                          <SelectItem value="unlisted">Unlisted (hidden, share by link)</SelectItem>
                          <SelectItem value="public">Public</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-zinc-200">Category</Label>
                        {categoryId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-zinc-400 hover:bg-white/10 hover:text-white"
                            onClick={() => setCategoryId("")}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      <Select value={categoryId || undefined} onValueChange={setCategoryId} disabled={!catalog}>
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
                        <div className="text-left font-medium">Discovery & scheduling</div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-zinc-200">Title & description language</Label>
                            {defaultLanguage ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-zinc-400 hover:bg-white/10 hover:text-white"
                                onClick={() => setDefaultLanguage("")}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
                          <Select value={defaultLanguage || undefined} onValueChange={setDefaultLanguage} disabled={!catalog}>
                            <SelectTrigger className="border-white/10 bg-black/25 text-white">
                              <SelectValue placeholder="Choose metadata language" />
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
                          <div className="flex items-center justify-between">
                            <Label htmlFor="yt-recording-date" className="text-zinc-200">
                              Recording date
                            </Label>
                            {recordingDate ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-zinc-400 hover:bg-white/10 hover:text-white"
                                onClick={() => setRecordingDate("")}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
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
                        <div className="flex items-center justify-between">
                          <Label htmlFor="yt-tags" className="text-zinc-200">
                            Tags
                          </Label>
                          <AiAutoloadButton 
                            disabled={!hasAiGenerations} 
                            onClick={() => openAutoloadPicker("tags")} 
                          />
                        </div>
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
                        <div className="flex items-center justify-between">
                          <Label htmlFor="yt-publish-at" className="text-zinc-200">
                            Publish at
                          </Label>
                          {publishAt ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-zinc-400 hover:bg-white/10 hover:text-white"
                              onClick={() => setPublishAt("")}
                            >
                              Clear
                            </Button>
                          ) : null}
                        </div>
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
                        <div className="text-left font-medium">Compliance & distribution</div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <div className="grid gap-3">
                        {[
                          {
                            label: "Notify subscribers",
                            description: "Leave off by default to avoid accidental notifications during testing.",
                            value: notifySubscribers,
                            onValueChange: setNotifySubscribers,
                          },
                          {
                            label: "Embeddable",
                            description: "Allow the uploaded video to be embedded on external sites.",
                            value: embeddable,
                            onValueChange: setEmbeddable,
                          },
                          {
                            label: "Public stats viewable",
                            description: "Expose public view/like counters when YouTube allows them.",
                            value: publicStatsViewable,
                            onValueChange: setPublicStatsViewable,
                          },
                          {
                            label: "Made for kids",
                            description: "Set the self-declared audience flag immediately in the upload metadata.",
                            value: selfDeclaredMadeForKids,
                            onValueChange: setSelfDeclaredMadeForKids,
                          },
                          {
                            label: "Contains synthetic media",
                            description: "Useful when the final piece includes AI-generated or materially synthetic content.",
                            value: containsSyntheticMedia,
                            onValueChange: setContainsSyntheticMedia,
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
                            <Select
                              value={toOptionalBooleanSelectValue(item.value)}
                              onValueChange={(value) => item.onValueChange(fromOptionalBooleanSelectValue(value))}
                            >
                              <SelectTrigger className="w-[132px] border-white/10 bg-black/25 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unset">Not set</SelectItem>
                                <SelectItem value="true">Yes</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label className="text-zinc-200">License</Label>
                          <Select
                            value={license ?? "unset"}
                            onValueChange={(value) => setLicense(value === "unset" ? undefined : (value as YouTubeLicense))}
                          >
                            <SelectTrigger className="border-white/10 bg-black/25 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unset">Not set</SelectItem>
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
                        <div className="text-left font-medium">Localized metadata</div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      {!defaultLanguage ? (
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-zinc-400">
                          Pick the title and description language first, then add locale-specific overrides.
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
                        <div className="text-left font-medium">Optional assets</div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <input
                            ref={thumbnailInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(event) => setThumbnailFile(event.target.files?.[0] ?? null)}
                          />
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-white">Thumbnail</div>
                            </div>
                            <div className="flex items-center gap-2">
                              {thumbnailFile ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-zinc-400 hover:bg-white/10 hover:text-white"
                                  onClick={() => {
                                    setThumbnailFile(null);
                                    if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
                                  }}
                                >
                                  Clear
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                                onClick={() => thumbnailInputRef.current?.click()}
                              >
                                Pick
                              </Button>
                            </div>
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
                            </div>
                            <div className="flex items-center gap-2">
                              {captionFile ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-zinc-400 hover:bg-white/10 hover:text-white"
                                  onClick={() => {
                                    setCaptionFile(null);
                                    setCaptionLanguage("");
                                    setCaptionName("");
                                    setCaptionIsDraft(false);
                                    if (captionInputRef.current) captionInputRef.current.value = "";
                                  }}
                                >
                                  Clear
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                                onClick={() => captionInputRef.current?.click()}
                              >
                                Pick
                              </Button>
                            </div>
                          </div>
                          <div className="mt-4 rounded-xl border border-dashed border-white/8 bg-black/20 p-3 text-sm text-zinc-400">
                            {captionFile ? captionFile.name : "No SRT selected"}
                          </div>
                        </div>
                      </div>

                      {captionFile ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-zinc-200">Caption language</Label>
                              {captionLanguage ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-zinc-400 hover:bg-white/10 hover:text-white"
                                  onClick={() => setCaptionLanguage("")}
                                >
                                  Clear
                                </Button>
                              ) : null}
                            </div>
                            <Select value={captionLanguage || undefined} onValueChange={setCaptionLanguage} disabled={!catalog}>
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
                    onClick={() => setIsConfirmDialogOpen(true)}
                    disabled={!canUpload || isUploading}
                    className="min-w-[190px] bg-[linear-gradient(135deg,rgba(34,211,238,0.9),rgba(16,185,129,0.9))] font-semibold text-black hover:opacity-95"
                  >
                    {isUploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="mr-2 h-4 w-4" />
                    )}
                    {isUploading ? "Uploading to YouTube" : "Review upload"}
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
                      <div className={cn("rounded-2xl border p-4", resultTone(publishResult.thumbnail.state))}>
                        <div className="text-sm font-medium">Thumbnail</div>
                        <div className="mt-2 text-sm">
                          {resultMessage(publishResult.thumbnail, {
                            applied: "Applied successfully",
                            skipped: "No thumbnail uploaded",
                            failed: "Thumbnail could not be applied",
                          })}
                        </div>
                      </div>
                      <div className={cn("rounded-2xl border p-4", resultTone(publishResult.caption.state))}>
                        <div className="text-sm font-medium">Caption</div>
                        <div className="mt-2 text-sm">
                          {resultMessage(publishResult.caption, {
                            applied: "Applied successfully",
                            skipped: "No caption uploaded",
                            failed: "Caption could not be applied",
                          })}
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

      {selectedProject && (
        <AiAutoloadPicker
          project={selectedProject}
          field={autoloadField}
          open={autoloadPickerOpen}
          onOpenChange={setAutoloadPickerOpen}
          onApplyTitle={(title) => setPublishDraft(p => ({ ...p, title }))}
          onApplyDescription={(description) => setPublishDraft(p => ({ ...p, description }))}
          onApplyTags={(tags) => setPublishDraft(p => ({ ...p, tagsInput: tags }))}
          onApplyAll={(values) => {
            setPublishDraft(p => ({ 
              ...p, 
              title: values.title,
              description: values.description,
              tagsInput: values.tags 
            }));
          }}
        />
      )}

      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent className="max-h-[88vh] overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.985),rgba(4,7,12,0.985))] p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.48)] sm:max-w-5xl">
          <DialogHeader className="border-b border-white/8 px-6 py-5 text-left">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-white">Confirm YouTube upload</DialogTitle>
            <DialogDescription className="text-sm text-white/55">
              Review the final metadata and attached assets before the upload starts.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(88vh-170px)] overflow-y-auto px-6 py-6">
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-6">
                <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <ShieldCheck className="h-4 w-4 text-cyan-300" />
                    Connected channel
                  </div>
                  <div className="grid gap-3">
                    {channels.length > 0 ? (
                      channels.map((channel) => (
                        <div
                          key={channel.id}
                          className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                        >
                          <div className="text-sm font-medium text-white">{channel.title}</div>
                          <div className="mt-1 text-xs text-zinc-500">{channel.customUrl || channel.id}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-500">
                        No connected channel details available.
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <FileVideo className="h-4 w-4 text-cyan-300" />
                    Video source
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">{activeVideoFile?.name || "No file selected"}</div>
                        <div className="mt-1 text-xs text-zinc-500">{sourceSummaryTitle} • {sourceSummaryLabel}</div>
                      </div>
                      <Badge className="border-white/10 bg-black/20 text-white/80">
                        {activeVideoFile ? formatFileSize(activeVideoFile.size) : "No file"}
                      </Badge>
                    </div>
                    {videoPreviewUrl ? (
                      <video
                        className="mt-4 aspect-video w-full rounded-2xl border border-white/10 bg-black"
                        controls
                        preload="metadata"
                        src={videoPreviewUrl}
                      />
                    ) : null}
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <FileText className="h-4 w-4 text-emerald-300" />
                    Final metadata
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Title</div>
                      <div className="mt-2 text-lg font-medium text-white">{currentDraft.title.trim() || "Untitled"}</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Description</div>
                      <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                        {currentDraft.description.trim() || "No description"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Tags</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {currentDraft.tags.length > 0 ? (
                          currentDraft.tags.map((tag) => (
                            <Badge key={tag} className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-zinc-500">No tags</span>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <Sparkles className="h-4 w-4 text-fuchsia-300" />
                    Publish settings
                  </div>
                  <div className="grid gap-3">
                    {[
                      { label: "Privacy", value: privacyLabel },
                      { label: "Category", value: categoryLabel },
                      { label: "Default language", value: defaultLanguageLabel },
                      { label: "Recording date", value: formatDateInput(recordingDate) },
                      { label: "Publish at", value: formatDateTimeInput(publishAt) },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                      >
                        <div className="text-sm text-zinc-400">{item.label}</div>
                        <div className="text-right text-sm font-medium text-white">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <ShieldAlert className="h-4 w-4 text-amber-300" />
                    Compliance & distribution
                  </div>
                  <div className="grid gap-3">
                    {complianceRows.map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                      >
                        <div className="text-sm text-zinc-400">{item.label}</div>
                        <div className="text-sm font-medium text-white">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[24px] border border-white/8 bg-black/20 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <FileImage className="h-4 w-4 text-orange-300" />
                    Optional assets
                  </div>
                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="text-sm font-medium text-white">Thumbnail</div>
                      <div className="mt-1 text-sm text-zinc-400">{thumbnailFile?.name || "No thumbnail attached"}</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="text-sm font-medium text-white">Captions</div>
                      {captionFile ? (
                        <div className="mt-2 space-y-1 text-sm text-zinc-400">
                          <div>{captionFile.name}</div>
                          <div>{captionLanguageLabel}</div>
                          <div>{captionName.trim() || fileStem(captionFile.name)}</div>
                          <div>{captionIsDraft ? "Draft caption track" : "Publish caption track"}</div>
                        </div>
                      ) : (
                        <div className="mt-1 text-sm text-zinc-400">No caption track attached</div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="text-sm font-medium text-white">Localized metadata</div>
                      <div className="mt-1 text-sm text-zinc-400">
                        {currentDraft.localizations.length > 0
                          ? `${currentDraft.localizations.length} localized override${currentDraft.localizations.length === 1 ? "" : "s"}`
                          : "No localized overrides"}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-white/8 px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-zinc-300 hover:bg-white/10 hover:text-white"
              onClick={() => setIsConfirmDialogOpen(false)}
              disabled={isUploading}
            >
              Back to edit
            </Button>
            <Button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!canUpload || isUploading}
              className="min-w-[190px] bg-[linear-gradient(135deg,rgba(34,211,238,0.9),rgba(16,185,129,0.9))] font-semibold text-black hover:opacity-95"
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Confirm upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
