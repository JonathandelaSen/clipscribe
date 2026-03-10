"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";

import { useComposerLibrary } from "@/hooks/useComposerLibrary";
import { useComposerWorkspacePrefs } from "@/hooks/useComposerWorkspacePrefs";
import { makeId } from "@/lib/history";
import {
  buildComposerAudioTimelineItem,
  buildComposerAssetRecord,
  buildComposerExportRecord,
  buildComposerProjectRecord,
  buildComposerVideoTimelineItem,
  DEFAULT_COMPOSER_EXPORT_SETTINGS,
  deriveComposerProjectName,
} from "@/lib/composer/project";
import { readComposerMediaMetadata } from "@/lib/composer/media";
import { exportComposerVideoLocally } from "@/lib/composer/local-render";
import type {
  ComposerAssetRecord,
  ComposerExportRecord,
  ComposerQuality,
  ComposerRatio,
  ComposerTimelineItem,
} from "@/lib/composer/types";
import {
  clampTimelineItemToAsset,
  computeProjectDurationSeconds,
  computeTimelineItemEndSeconds,
  duplicateTimelineItem,
  hasVisualLaneOverlap,
  pasteTimelineItem,
  sortTimelineItems,
} from "@/lib/composer/core/timeline";
import { buildComposerHorizontalLayout } from "@/lib/composer/core/workspace-prefs";

import { ComposerBinPanel } from "@/components/composer/ComposerBinPanel";
import { ComposerCompactFallback } from "@/components/composer/ComposerCompactFallback";
import { ComposerInspectorPanel } from "@/components/composer/ComposerInspectorPanel";
import { ComposerTimelinePanel } from "@/components/composer/ComposerTimelinePanel";
import { ComposerTopbar } from "@/components/composer/ComposerTopbar";
import { ComposerViewerPanel } from "@/components/composer/ComposerViewerPanel";
import { ComposerWorkspaceShell } from "@/components/composer/ComposerWorkspaceShell";
import { clamp } from "@/components/composer/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";

const RATIO_OPTIONS: Array<{ value: ComposerRatio; label: string }> = [
  { value: "9:16", label: "Vertical 9:16" },
  { value: "1:1", label: "Square 1:1" },
  { value: "16:9", label: "Landscape 16:9" },
];

const QUALITY_OPTIONS: Array<{ value: ComposerQuality; label: string; helper: string }> = [
  { value: "low", label: "Low", helper: "Lighter draft exports" },
  { value: "medium", label: "Medium", helper: "Balanced default" },
  { value: "high", label: "High", helper: "Full HD style render" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function projectHasItem(projectItems: ComposerTimelineItem[], itemId: string | null) {
  return !!itemId && projectItems.some((item) => item.id === itemId);
}

function findActiveItem(
  items: ComposerTimelineItem[],
  lane: ComposerTimelineItem["lane"],
  timeSeconds: number
): ComposerTimelineItem | undefined {
  return items.find((item) => {
    if (item.lane !== lane) return false;
    return timeSeconds >= item.timelineStartSeconds && timeSeconds < computeTimelineItemEndSeconds(item);
  });
}

function getVideoLaneEnd(items: ComposerTimelineItem[]): number {
  return items
    .filter((item) => item.lane === "video")
    .reduce((maxEnd, item) => Math.max(maxEnd, computeTimelineItemEndSeconds(item)), 0);
}

export function TimelineComposer() {
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectName, setProjectName] = useState("Untitled timeline");
  const [timelineItems, setTimelineItems] = useState<ComposerTimelineItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [exportRatio, setExportRatio] = useState<ComposerRatio>(DEFAULT_COMPOSER_EXPORT_SETTINGS.ratio);
  const [exportQuality, setExportQuality] = useState<ComposerQuality>(DEFAULT_COMPOSER_EXPORT_SETTINGS.quality);
  const [assetFiles, setAssetFiles] = useState<Map<string, File>>(new Map());
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(new Map());
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgressPct, setExportProgressPct] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipboardItem, setClipboardItem] = useState<ComposerTimelineItem | null>(null);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [debugExportId, setDebugExportId] = useState<string | null>(null);
  const [lastAutosaveAt, setLastAutosaveAt] = useState<number | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);

  const audioUploadRef = useRef<HTMLInputElement | null>(null);
  const videoUploadRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const horizontalGroupRef = useRef<GroupImperativeHandle | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ startedAt: number; baseTime: number }>({ startedAt: 0, baseTime: 0 });
  const lastUiTickRef = useRef(0);
  const autoOpenedRef = useRef(false);
  const currentVideoAssetIdRef = useRef<string | null>(null);
  const currentAudioAssetIdRef = useRef<string | null>(null);

  const {
    prefs,
    updatePrefs,
    resetPrefs,
  } = useComposerWorkspacePrefs();

  const {
    projects,
    recentProjects,
    assets,
    exports,
    isLoading,
    error,
    upsertProject,
    upsertAsset,
    putAssetFile,
    upsertExport,
    getAssetFile,
  } = useComposerLibrary(activeProjectId || undefined);

  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const timelineSorted = useMemo(() => sortTimelineItems(timelineItems), [timelineItems]);
  const projectDurationSeconds = useMemo(
    () => computeProjectDurationSeconds(timelineItems),
    [timelineItems]
  );
  const selectedItem = useMemo(
    () => timelineItems.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, timelineItems]
  );
  const selectedAsset = selectedItem ? assetsById.get(selectedItem.assetId) ?? null : null;
  const debugExport = exports.find((item) => item.id === debugExportId) ?? null;
  const activeVideoItem = useMemo(
    () => findActiveItem(timelineSorted, "video", currentTimeSeconds),
    [currentTimeSeconds, timelineSorted]
  );
  const activeAudioItem = useMemo(
    () => findActiveItem(timelineSorted, "audio", currentTimeSeconds),
    [currentTimeSeconds, timelineSorted]
  );
  const activeVideoAsset = activeVideoItem ? assetsById.get(activeVideoItem.assetId) ?? null : null;
  const activeAudioAsset = activeAudioItem ? assetsById.get(activeAudioItem.assetId) ?? null : null;
  const activeVideoObjectUrl = activeVideoItem ? assetUrls.get(activeVideoItem.assetId) ?? null : null;
  const canPasteClip = !!clipboardItem && clipboardItem.lane === "video";
  const hasMissingFiles = timelineItems.some((item) => !assetFiles.has(item.assetId));
  const canExport = !!activeProjectId && timelineItems.length > 0 && !hasMissingFiles && !isUploadingAsset && !isExporting;
  const scrubStepSeconds = snapEnabled ? 0.25 : 0.05;

  useEffect(() => {
    let cancelled = false;

    if (!activeProjectId || assets.length === 0) {
      setAssetFiles(new Map());
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const nextEntries = await Promise.all(
        assets.map(async (asset) => {
          const fileRecord = await getAssetFile(asset.fileId);
          return fileRecord ? ([asset.id, fileRecord.file] as const) : null;
        })
      );

      if (cancelled) return;
      const next = new Map<string, File>();
      for (const entry of nextEntries) {
        if (!entry) continue;
        next.set(entry[0], entry[1]);
      }
      setAssetFiles(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, assets, getAssetFile]);

  useEffect(() => {
    const nextUrls = new Map<string, string>();
    assetFiles.forEach((file, assetId) => {
      nextUrls.set(assetId, URL.createObjectURL(file));
    });
    setAssetUrls(nextUrls);

    return () => {
      nextUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assetFiles]);

  const resetComposer = useCallback(() => {
    autoOpenedRef.current = true;
    startTransition(() => {
      setActiveProjectId("");
      setProjectName("Untitled timeline");
      setTimelineItems([]);
      setSelectedItemId(null);
      setExportRatio(DEFAULT_COMPOSER_EXPORT_SETTINGS.ratio);
      setExportQuality(DEFAULT_COMPOSER_EXPORT_SETTINGS.quality);
      setCurrentTimeSeconds(0);
      setIsPlaying(false);
      setExportError(null);
      setExportProgressPct(0);
      setAssetFiles(new Map());
      setClipboardItem(null);
      setLastAutosaveAt(null);
      currentVideoAssetIdRef.current = null;
      currentAudioAssetIdRef.current = null;
    });
  }, []);

  const openProject = useCallback((project: (typeof projects)[number]) => {
    autoOpenedRef.current = true;
    startTransition(() => {
      const nextItems = sortTimelineItems(project.timeline.items ?? []);
      setActiveProjectId(project.id);
      setProjectName(project.name);
      setTimelineItems(nextItems);
      setSelectedItemId(nextItems[0]?.id ?? null);
      setExportRatio(project.exportSettings.ratio);
      setExportQuality(project.exportSettings.quality);
      setCurrentTimeSeconds(0);
      setIsPlaying(false);
      setExportError(null);
      setExportProgressPct(0);
      setAssetFiles(new Map());
      setLastAutosaveAt(project.updatedAt);
      currentVideoAssetIdRef.current = null;
      currentAudioAssetIdRef.current = null;
    });
  }, []);

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (activeProjectId) return;
    if (recentProjects.length === 0) return;
    autoOpenedRef.current = true;
    openProject(recentProjects[0]);
  }, [activeProjectId, openProject, recentProjects]);

  useEffect(() => {
    if (projectHasItem(timelineItems, selectedItemId)) return;
    setSelectedItemId(timelineSorted[0]?.id ?? null);
  }, [selectedItemId, timelineItems, timelineSorted]);

  useEffect(() => {
    if (currentTimeSeconds <= projectDurationSeconds) return;
    setCurrentTimeSeconds(projectDurationSeconds);
  }, [currentTimeSeconds, projectDurationSeconds]);

  const persistProject = useCallback(
    async (status: "draft" | "exporting" | "exported" | "error", options?: { lastExportId?: string; lastError?: string }) => {
      if (!activeProjectId) return;
      const existing = projects.find((project) => project.id === activeProjectId);
      const record = buildComposerProjectRecord({
        now: Date.now(),
        status,
        name: projectName,
        timelineItems,
        exportSettings: { ratio: exportRatio, quality: exportQuality },
        existing,
        explicitId: activeProjectId,
        lastExportId: options?.lastExportId,
        lastError: options?.lastError,
      });
      await upsertProject(record);
      setLastAutosaveAt(record.updatedAt);
    },
    [activeProjectId, exportQuality, exportRatio, projectName, projects, timelineItems, upsertProject]
  );

  useEffect(() => {
    if (!activeProjectId) return;
    if (isExporting) return;

    const timeout = window.setTimeout(() => {
      void persistProject("draft").catch((err) => {
        console.error(err);
      });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [activeProjectId, exportQuality, exportRatio, isExporting, persistProject, projectName, timelineItems]);

  const syncPreviewAtTime = useEffectEvent((targetTime: number, shouldPlay: boolean) => {
    const videoEl = previewVideoRef.current;
    const audioEl = previewAudioRef.current;
    const nextVideo = findActiveItem(timelineSorted, "video", targetTime);
    const nextAudio = findActiveItem(timelineSorted, "audio", targetTime);

    if (videoEl) {
      const nextVideoUrl = nextVideo ? assetUrls.get(nextVideo.assetId) ?? null : null;
      if (!nextVideo || !nextVideoUrl) {
        if (!videoEl.paused) videoEl.pause();
        if (currentVideoAssetIdRef.current) {
          videoEl.removeAttribute("src");
          videoEl.load();
          currentVideoAssetIdRef.current = null;
        }
      } else {
        const nextVideoAsset = assetsById.get(nextVideo.assetId);
        if (currentVideoAssetIdRef.current !== nextVideo.assetId) {
          videoEl.src = nextVideoUrl;
          videoEl.load();
          currentVideoAssetIdRef.current = nextVideo.assetId;
        }
        const desiredTime = clamp(
          targetTime - nextVideo.timelineStartSeconds + nextVideo.sourceStartSeconds,
          0,
          Math.max(0, nextVideoAsset?.durationSeconds ?? nextVideo.durationSeconds)
        );
        if (Number.isFinite(videoEl.currentTime) && Math.abs(videoEl.currentTime - desiredTime) > 0.2) {
          try {
            videoEl.currentTime = desiredTime;
          } catch {}
        }
        videoEl.volume = nextVideo.muted ? 0 : clamp(nextVideo.volume, 0, 1);
        videoEl.muted = nextVideo.muted;
        if (shouldPlay) {
          void videoEl.play().catch(() => {});
        } else {
          videoEl.pause();
        }
      }
    }

    if (audioEl) {
      const nextAudioUrl = nextAudio ? assetUrls.get(nextAudio.assetId) ?? null : null;
      if (!nextAudio || !nextAudioUrl) {
        if (!audioEl.paused) audioEl.pause();
        if (currentAudioAssetIdRef.current) {
          audioEl.removeAttribute("src");
          audioEl.load();
          currentAudioAssetIdRef.current = null;
        }
      } else {
        const nextAudioAsset = assetsById.get(nextAudio.assetId);
        if (currentAudioAssetIdRef.current !== nextAudio.assetId) {
          audioEl.src = nextAudioUrl;
          audioEl.load();
          currentAudioAssetIdRef.current = nextAudio.assetId;
        }
        const desiredTime = clamp(
          targetTime - nextAudio.timelineStartSeconds + nextAudio.sourceStartSeconds,
          0,
          Math.max(0, nextAudioAsset?.durationSeconds ?? nextAudio.durationSeconds)
        );
        if (Number.isFinite(audioEl.currentTime) && Math.abs(audioEl.currentTime - desiredTime) > 0.2) {
          try {
            audioEl.currentTime = desiredTime;
          } catch {}
        }
        audioEl.volume = nextAudio.muted ? 0 : clamp(nextAudio.volume, 0, 1);
        audioEl.muted = nextAudio.muted;
        if (shouldPlay) {
          void audioEl.play().catch(() => {});
        } else {
          audioEl.pause();
        }
      }
    }
  });

  const tickPlayback = useEffectEvent((now: number) => {
    const elapsedSeconds = (now - playStartRef.current.startedAt) / 1000;
    const nextTime = Math.min(projectDurationSeconds, playStartRef.current.baseTime + elapsedSeconds);
    syncPreviewAtTime(nextTime, true);

    if (now - lastUiTickRef.current > 60 || nextTime >= projectDurationSeconds) {
      lastUiTickRef.current = now;
      setCurrentTimeSeconds(nextTime);
    }

    if (nextTime >= projectDurationSeconds) {
      setIsPlaying(false);
      setCurrentTimeSeconds(projectDurationSeconds);
      rafRef.current = null;
      return;
    }

    rafRef.current = window.requestAnimationFrame(tickPlayback);
  });

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      syncPreviewAtTime(currentTimeSeconds, false);
      return;
    }

    playStartRef.current = {
      startedAt: performance.now(),
      baseTime: currentTimeSeconds,
    };
    lastUiTickRef.current = performance.now();
    rafRef.current = window.requestAnimationFrame(tickPlayback);

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [currentTimeSeconds, isPlaying]);

  useEffect(() => {
    if (isPlaying) return;
    syncPreviewAtTime(currentTimeSeconds, false);
  }, [assetUrls, currentTimeSeconds, isPlaying, timelineSorted]);

  const commitTimelineItemUpdate = useCallback(
    (itemId: string, updater: (item: ComposerTimelineItem) => ComposerTimelineItem) => {
      setTimelineItems((prev) => {
        const target = prev.find((item) => item.id === itemId);
        if (!target) return prev;
        const asset = assetsById.get(target.assetId);
        if (!asset) return prev;

        let next = updater(target);
        next = clampTimelineItemToAsset(next, asset.durationSeconds);

        if (next.lane === "video" && hasVisualLaneOverlap(prev, next, itemId)) {
          toast.error("Video clips cannot overlap on the visual lane.");
          return prev;
        }

        return prev.map((item) => (item.id === itemId ? next : item));
      });
    },
    [assetsById]
  );

  const updateSelectedItem = useCallback(
    (updater: (item: ComposerTimelineItem) => ComposerTimelineItem) => {
      if (!selectedItemId) return;
      commitTimelineItemUpdate(selectedItemId, updater);
    },
    [commitTimelineItemUpdate, selectedItemId]
  );

  const ensureProject = useCallback(
    async (suggestedName?: string) => {
      if (activeProjectId) return activeProjectId;
      const now = Date.now();
      const record = buildComposerProjectRecord({
        now,
        status: "draft",
        name: suggestedName ? deriveComposerProjectName(suggestedName) : projectName,
        timelineItems: [],
        exportSettings: { ratio: exportRatio, quality: exportQuality },
      });
      await upsertProject(record);
      setActiveProjectId(record.id);
      setProjectName(record.name);
      setLastAutosaveAt(record.updatedAt);
      return record.id;
    },
    [activeProjectId, exportQuality, exportRatio, projectName, upsertProject]
  );

  const handleFilesSelected = useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = fileList ? Array.from(fileList) : [];
      if (files.length === 0) return;

      setIsUploadingAsset(true);
      setExportError(null);

      try {
        for (const file of files) {
          const projectId = await ensureProject(file.name);
          const metadata = await readComposerMediaMetadata(file);
          const now = Date.now();
          const fileId = makeId("composerfile");
          const asset = buildComposerAssetRecord({
            projectId,
            fileId,
            type: metadata.type,
            filename: file.name,
            mimeType: metadata.mimeType,
            sizeBytes: file.size,
            durationSeconds: metadata.durationSeconds,
            width: metadata.width,
            height: metadata.height,
            hasAudio: metadata.hasAudio,
            createdAt: now,
          });

          await putAssetFile({ id: fileId, file });
          await upsertAsset(asset);
          setAssetFiles((prev) => {
            const next = new Map(prev);
            next.set(asset.id, file);
            return next;
          });

          if (asset.type === "audio") {
            setTimelineItems((prev) => {
              const existingAudio = prev.find((item) => item.lane === "audio");
              if (existingAudio) {
                setSelectedItemId(existingAudio.id);
                updatePrefs({ activeInspectorTab: "audio" });
                return prev.map((item) =>
                  item.id === existingAudio.id
                    ? {
                        ...item,
                        assetId: asset.id,
                        sourceStartSeconds: 0,
                        durationSeconds: asset.durationSeconds,
                        volume: 1,
                        muted: false,
                      }
                    : item
                );
              }

              const nextItem = buildComposerAudioTimelineItem({
                assetId: asset.id,
                durationSeconds: asset.durationSeconds,
              });
              setSelectedItemId(nextItem.id);
              updatePrefs({ activeInspectorTab: "audio" });
              return [...prev, nextItem];
            });
            toast.success(`Audio track ready: ${file.name}`);
          } else {
            setTimelineItems((prev) => {
              const nextItem = buildComposerVideoTimelineItem({
                assetId: asset.id,
                timelineStartSeconds: getVideoLaneEnd(prev),
                durationSeconds: asset.durationSeconds,
              });
              setSelectedItemId(nextItem.id);
              updatePrefs({ activeInspectorTab: "clip" });
              return [...prev, nextItem];
            });
            toast.success(`Video staged: ${file.name}`);
          }
        }
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Failed to add media");
      } finally {
        setIsUploadingAsset(false);
        if (audioUploadRef.current) audioUploadRef.current.value = "";
        if (videoUploadRef.current) videoUploadRef.current.value = "";
      }
    },
    [ensureProject, putAssetFile, updatePrefs, upsertAsset]
  );

  const handleAddAssetToTimeline = useCallback((asset: ComposerAssetRecord) => {
    if (asset.type === "audio") {
      setTimelineItems((prev) => {
        const existingAudio = prev.find((item) => item.lane === "audio");
        if (existingAudio) {
          setSelectedItemId(existingAudio.id);
          updatePrefs({ activeInspectorTab: "audio" });
          return prev.map((item) =>
            item.id === existingAudio.id
              ? {
                  ...item,
                  assetId: asset.id,
                  sourceStartSeconds: 0,
                  durationSeconds: asset.durationSeconds,
                  volume: 1,
                  muted: false,
                }
              : item
          );
        }
        const nextItem = buildComposerAudioTimelineItem({
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
        });
        setSelectedItemId(nextItem.id);
        updatePrefs({ activeInspectorTab: "audio" });
        return [...prev, nextItem];
      });
      return;
    }

    setTimelineItems((prev) => {
      const nextItem = buildComposerVideoTimelineItem({
        assetId: asset.id,
        timelineStartSeconds: getVideoLaneEnd(prev),
        durationSeconds: asset.durationSeconds,
      });
      setSelectedItemId(nextItem.id);
      updatePrefs({ activeInspectorTab: "clip" });
      return [...prev, nextItem];
    });
  }, [updatePrefs]);

  const handleSelectItem = useCallback((itemId: string) => {
    const target = timelineItems.find((item) => item.id === itemId);
    setSelectedItemId(itemId);
    if (target?.lane === "audio") {
      updatePrefs({ activeInspectorTab: "audio" });
    } else if (target?.lane === "video") {
      updatePrefs({ activeInspectorTab: "clip" });
    }
  }, [timelineItems, updatePrefs]);

  const handleDeleteItem = useCallback((itemId: string) => {
    setTimelineItems((prev) => prev.filter((item) => item.id !== itemId));
    setSelectedItemId((current) => (current === itemId ? null : current));
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedItemId) return;
    handleDeleteItem(selectedItemId);
  }, [handleDeleteItem, selectedItemId]);

  const handleCopyItem = useCallback((itemId: string) => {
    const item = timelineItems.find((entry) => entry.id === itemId);
    if (!item || item.lane !== "video") return;
    setClipboardItem(item);
    toast.success("Clip copied inside the editor");
  }, [timelineItems]);

  const handleCopySelected = useCallback(() => {
    if (!selectedItemId) return;
    handleCopyItem(selectedItemId);
  }, [handleCopyItem, selectedItemId]);

  const handleDuplicateItem = useCallback((itemId: string) => {
    const item = timelineItems.find((entry) => entry.id === itemId);
    if (!item || item.lane !== "video") return;
    const next = duplicateTimelineItem(item, makeId("composervideo"), getVideoLaneEnd(timelineItems));
    setTimelineItems((prev) => [...prev, next]);
    setSelectedItemId(next.id);
    updatePrefs({ activeInspectorTab: "clip" });
  }, [timelineItems, updatePrefs]);

  const handleDuplicateSelected = useCallback(() => {
    if (!selectedItemId) return;
    handleDuplicateItem(selectedItemId);
  }, [handleDuplicateItem, selectedItemId]);

  const handlePasteClip = useCallback(() => {
    if (!clipboardItem || clipboardItem.lane !== "video") return;
    const pasted = pasteTimelineItem(
      clipboardItem,
      makeId("composervideo"),
      getVideoLaneEnd(timelineItems)
    );
    setTimelineItems((prev) => [...prev, pasted]);
    setSelectedItemId(pasted.id);
    updatePrefs({ activeInspectorTab: "clip" });
  }, [clipboardItem, timelineItems, updatePrefs]);

  const handleToggleMuteItem = useCallback((itemId: string) => {
    commitTimelineItemUpdate(itemId, (item) => ({
      ...item,
      muted: !item.muted,
    }));
  }, [commitTimelineItemUpdate]);

  const handleCopyAssetPreset = useCallback((asset: ComposerAssetRecord) => {
    if (asset.type !== "video") return;
    setClipboardItem(
      buildComposerVideoTimelineItem({
        assetId: asset.id,
        timelineStartSeconds: 0,
        durationSeconds: asset.durationSeconds,
      })
    );
    toast.success("Video asset copied as reusable clip preset");
  }, []);

  const handleDownloadExport = useCallback((record: ComposerExportRecord) => {
    if (!record.fileBlob) return;
    downloadBlob(record.fileBlob, record.filename);
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    setCurrentTimeSeconds(clamp(seconds, 0, Math.max(projectDurationSeconds, 0)));
  }, [projectDurationSeconds]);

  const handleResetPlayhead = useCallback(() => {
    setCurrentTimeSeconds(0);
    setIsPlaying(false);
  }, []);

  const handleExport = useCallback(async () => {
    if (!activeProjectId) return;
    if (timelineItems.length === 0) {
      toast.error("Add at least one clip or track before exporting.");
      return;
    }
    if (hasMissingFiles) {
      toast.error("Some media files are still loading. Wait a moment and retry.");
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setExportProgressPct(0);

    try {
      await persistProject("exporting");

      const outputName = projectName.trim() || "timeline-composer";
      const result = await exportComposerVideoLocally({
        items: timelineItems,
        assets,
        assetFiles,
        exportSettings: { ratio: exportRatio, quality: exportQuality },
        outputBasename: outputName,
        onProgress: (progressPct) => setExportProgressPct(progressPct),
      });

      const exportRecord = buildComposerExportRecord({
        projectId: activeProjectId,
        createdAt: Date.now(),
        filename: result.file.name,
        mimeType: result.file.type || "video/mp4",
        sizeBytes: result.file.size,
        ratio: exportRatio,
        quality: exportQuality,
        resolution: result.resolution,
        fileBlob: result.file,
        debugFfmpegCommand: result.ffmpegCommandPreview,
        debugNotes: result.notes,
      });

      await upsertExport(exportRecord);
      await persistProject("exported", { lastExportId: exportRecord.id });

      downloadBlob(result.file, result.file.name);
      toast.success(`Export ready: ${result.file.name}`);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Export failed";
      setExportError(message);
      await persistProject("error", { lastError: message });
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  }, [
    activeProjectId,
    assetFiles,
    assets,
    exportQuality,
    exportRatio,
    hasMissingFiles,
    persistProject,
    projectName,
    timelineItems,
    upsertExport,
  ]);

  const handleKeyboardShortcuts = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const isEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      !!target?.closest("[contenteditable='true']");
    if (isEditable) return;

    if (event.code === "Space") {
      event.preventDefault();
      setIsPlaying((prev) => !prev);
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && selectedItemId) {
      event.preventDefault();
      handleDeleteSelected();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      if (!selectedItem || selectedItem.lane !== "video") return;
      event.preventDefault();
      handleCopySelected();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && canPasteClip) {
      event.preventDefault();
      handlePasteClip();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboardShortcuts);
    return () => window.removeEventListener("keydown", handleKeyboardShortcuts);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    const nextPrefs = {
      ...prefs,
      collapsedPanels: {
        ...prefs.collapsedPanels,
        left: !prefs.collapsedPanels.left,
      },
    };
    horizontalGroupRef.current?.setLayout(buildComposerHorizontalLayout(nextPrefs));
    updatePrefs({
      collapsedPanels: nextPrefs.collapsedPanels,
    });
  }, [prefs, updatePrefs]);

  const toggleRightPanel = useCallback(() => {
    const nextPrefs = {
      ...prefs,
      collapsedPanels: {
        ...prefs.collapsedPanels,
        right: !prefs.collapsedPanels.right,
      },
    };
    horizontalGroupRef.current?.setLayout(buildComposerHorizontalLayout(nextPrefs));
    updatePrefs({
      collapsedPanels: nextPrefs.collapsedPanels,
    });
  }, [prefs, updatePrefs]);

  const handleResetLayout = useCallback(() => {
    resetPrefs();
    setWorkspaceRevision((current) => current + 1);
  }, [resetPrefs]);

  const projectStatusLabel = isUploadingAsset
    ? "Probing media"
    : isExporting
      ? `Exporting ${exportProgressPct}%`
      : lastAutosaveAt
        ? `Autosaved ${new Date(lastAutosaveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : activeProjectId
          ? "Draft ready"
          : "No draft yet";

  return (
    <>
      <div className="lg:hidden">
        <ComposerCompactFallback
          recentProjects={recentProjects}
          activeProjectId={activeProjectId}
          onOpenProject={openProject}
          exports={exports}
          onDownloadExport={handleDownloadExport}
        />
      </div>

      <main className="hidden min-h-[calc(100vh-var(--header-height,0px))] flex-col overflow-hidden bg-[color:var(--composer-app)] lg:flex">
        <ComposerTopbar
          projectName={projectName}
          onProjectNameChange={setProjectName}
          projectStatusLabel={projectStatusLabel}
          exportRatio={exportRatio}
          exportQuality={exportQuality}
          ratioOptions={RATIO_OPTIONS}
          qualityOptions={QUALITY_OPTIONS}
          onExportRatioChange={setExportRatio}
          onExportQualityChange={setExportQuality}
          onExport={() => void handleExport()}
          canExport={canExport}
          isExporting={isExporting}
          exportProgressPct={exportProgressPct}
          leftPanelCollapsed={prefs.collapsedPanels.left}
          rightPanelCollapsed={prefs.collapsedPanels.right}
          onToggleLeftPanel={toggleLeftPanel}
          onToggleRightPanel={toggleRightPanel}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          onNewDraft={resetComposer}
          onResetLayout={handleResetLayout}
        />

        <div className="min-h-0 flex-1 flex flex-col p-3">
          <ComposerWorkspaceShell
            key={workspaceRevision}
            prefs={prefs}
            onPrefsChange={updatePrefs}
            horizontalGroupRef={horizontalGroupRef}
            leftPanel={
              <ComposerBinPanel
                activeTab={prefs.activeBinTab}
                onTabChange={(value) => updatePrefs({ activeBinTab: value })}
                recentProjects={recentProjects}
                activeProjectId={activeProjectId}
                onOpenProject={openProject}
                assets={assets}
                isLoading={isLoading}
                isUploadingAsset={isUploadingAsset}
                onAudioImport={() => audioUploadRef.current?.click()}
                onVideoImport={() => videoUploadRef.current?.click()}
                onAddAssetToTimeline={handleAddAssetToTimeline}
                onCopyAssetPreset={handleCopyAssetPreset}
                projectName={projectName}
                projectDurationSeconds={projectDurationSeconds}
                timelineItemCount={timelineItems.length}
                exportRatio={exportRatio}
                exportQuality={exportQuality}
              />
            }
            viewerPanel={
              <ComposerViewerPanel
                previewVideoRef={previewVideoRef}
                previewAudioRef={previewAudioRef}
                activeVideoObjectUrl={activeVideoObjectUrl}
                activeVideoItem={activeVideoItem}
                activeVideoAsset={activeVideoAsset}
                activeAudioItem={activeAudioItem}
                activeAudioAsset={activeAudioAsset}
                exportRatio={exportRatio}
                exportQuality={exportQuality}
                currentTimeSeconds={currentTimeSeconds}
                projectDurationSeconds={projectDurationSeconds}
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying((prev) => !prev)}
                onResetPlayhead={handleResetPlayhead}
                onSeek={handleSeek}
                scrubStepSeconds={scrubStepSeconds}
                timelineItemCount={timelineItems.length}
              />
            }
            timelinePanel={
              <ComposerTimelinePanel
                items={timelineSorted}
                assetsById={assetsById}
                selectedItemId={selectedItemId}
                currentTimeSeconds={currentTimeSeconds}
                projectDurationSeconds={projectDurationSeconds}
                timelineZoom={prefs.timelineZoom}
                onTimelineZoomChange={(value) => updatePrefs({ timelineZoom: value })}
                onSeek={handleSeek}
                onSelectItem={handleSelectItem}
                onCopyItem={handleCopyItem}
                onDuplicateItem={handleDuplicateItem}
                onDeleteItem={handleDeleteItem}
                onToggleItemMute={handleToggleMuteItem}
                onPasteClip={handlePasteClip}
                canPasteClip={canPasteClip}
                snapEnabled={snapEnabled}
                onSnapEnabledChange={setSnapEnabled}
                isPlaying={isPlaying}
              />
            }
            inspectorPanel={
              <ComposerInspectorPanel
                activeTab={prefs.activeInspectorTab}
                onTabChange={(value) => updatePrefs({ activeInspectorTab: value })}
                selectedItem={selectedItem}
                selectedAsset={selectedAsset}
                onUpdateSelectedItem={updateSelectedItem}
                onCopySelected={handleCopySelected}
                onDuplicateSelected={handleDuplicateSelected}
                onDeleteSelected={handleDeleteSelected}
                exportRatio={exportRatio}
                exportQuality={exportQuality}
                ratioOptions={RATIO_OPTIONS}
                qualityOptions={QUALITY_OPTIONS}
                onExportRatioChange={setExportRatio}
                onExportQualityChange={setExportQuality}
                onExport={() => void handleExport()}
                canExport={canExport}
                isExporting={isExporting}
                exportProgressPct={exportProgressPct}
                exportError={exportError}
                exports={exports}
                onDownloadExport={handleDownloadExport}
                onOpenExportDebug={setDebugExportId}
                sliderStepSeconds={scrubStepSeconds}
              />
            }
          />
        </div>

        {error ? (
          <div className="border-t border-[#4c2424] bg-[#241314] px-4 py-3 text-sm text-[#e2bcbc]">
            {error}
          </div>
        ) : null}

        <input
          ref={audioUploadRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac"
          className="hidden"
          onChange={(event) => void handleFilesSelected(event.target.files)}
        />
        <input
          ref={videoUploadRef}
          type="file"
          accept="video/*,.mov,.mkv"
          className="hidden"
          multiple
          onChange={(event) => void handleFilesSelected(event.target.files)}
        />
      </main>

      <Dialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen}>
        <DialogContent className="border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Composer shortcuts</DialogTitle>
            <DialogDescription className="text-[color:var(--composer-muted)]">
              Internal editing shortcuts are focused on repeating clips quickly.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            {[
              ["Play / pause", "Space"],
              ["Copy selected video clip", "Cmd/Ctrl + C"],
              ["Paste copied clip at lane end", "Cmd/Ctrl + V"],
              ["Delete selected item", "Delete"],
            ].map(([label, shortcut]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 rounded-lg border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] px-4 py-3"
              >
                <span>{label}</span>
                <kbd className="composer-ui-mono rounded-md border border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] px-2 py-1 text-xs text-[color:var(--composer-muted)]">
                  {shortcut}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!debugExport} onOpenChange={(open) => !open && setDebugExportId(null)}>
        <DialogContent className="w-[min(94vw,980px)] border-[color:var(--composer-border)] bg-[color:var(--composer-panel)] text-[color:var(--composer-text)]">
          <DialogHeader>
            <DialogTitle>Export debug</DialogTitle>
            <DialogDescription className="text-[color:var(--composer-muted)]">
              FFmpeg command preview and render notes for the selected saved export.
            </DialogDescription>
          </DialogHeader>
          {debugExport ? (
            <div className="grid gap-4">
              <div className="rounded-lg border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                  Command
                </div>
                <pre className="composer-ui-mono overflow-x-auto whitespace-pre-wrap break-words text-xs text-[color:var(--composer-text)]">
                  {(debugExport.debugFfmpegCommand ?? []).join(" ")}
                </pre>
              </div>
              <div className="rounded-lg border border-[color:var(--composer-border)] bg-[color:var(--composer-raised)] p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.22em] text-[color:var(--composer-muted)]">
                  Notes
                </div>
                <pre className="composer-ui-mono whitespace-pre-wrap break-words text-xs text-[color:var(--composer-text)]">
                  {(debugExport.debugNotes ?? []).join("\n")}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Toaster />
    </>
  );
}
