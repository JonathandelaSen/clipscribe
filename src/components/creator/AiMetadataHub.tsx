"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  RefreshCcw,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useCreatorLlmRuns } from "@/hooks/useCreatorLlmRuns";
import { useCreatorVideoInfoGenerator } from "@/hooks/useCreatorVideoInfoGenerator";
import { useHistoryLibrary } from "@/hooks/useHistoryLibrary";
import { useProjectLibrary } from "@/hooks/useProjectLibrary";
import {
  VIDEO_INFO_PROMPT_FIELD_DEFAULTS,
  VIDEO_INFO_PROMPT_SLOT_DEFAULTS,
  VIDEO_INFO_PROMPT_SLOT_ORDER,
  createEmptyPromptSlotOverride,
  createEmptyVideoInfoPromptProfile,
  createVideoInfoPromptCustomizationSnapshot,
  hasCustomizedVideoInfoPromptProfile,
  resolveVideoInfoPromptFieldInstruction,
  resolveVideoInfoPromptSlotLine,
  sanitizeVideoInfoPromptProfile,
  selectVideoInfoPromptCustomizationSnapshot,
  type VideoInfoPromptEditorMode,
} from "@/lib/creator/prompt-customization";
import {
  appendProjectVideoInfoRecord,
  buildProjectVideoInfoRecord,
  removeProjectVideoInfoRecord,
  resolveProjectVideoInfoHistory,
} from "@/lib/creator/video-info-storage";
import { buildCollapsedVideoInfoPromptPreview, buildVideoInfoPrompt } from "@/lib/server/creator/video-info/prompt";
import type {
  CreatorPromptSlotOverrideMode,
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoPromptCustomizationSnapshot,
  CreatorVideoInfoPromptProfile,
  CreatorVideoInfoProjectRecord,
  CreatorVideoInfoPromptSlot,
} from "@/lib/creator/types";
import { getLatestTranscript } from "@/lib/history";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type VideoInfoBlockOption = {
  value: CreatorVideoInfoBlock;
  label: string;
  accent: string;
};

const PRIMARY_VIDEO_INFO_BLOCK_OPTIONS: VideoInfoBlockOption[] = [
  {
    value: "titleIdeas",
    label: "Title Ideas",
    accent: "bg-cyan-400/10 text-cyan-100 border-cyan-300/30",
  },
  {
    value: "description",
    label: "Description",
    accent: "bg-emerald-400/10 text-emerald-100 border-emerald-300/30",
  },
  {
    value: "hashtags",
    label: "Hashtags",
    accent: "bg-sky-400/10 text-sky-100 border-sky-300/30",
  },
  {
    value: "thumbnailHooks",
    label: "Thumbnail Hooks",
    accent: "bg-orange-400/10 text-orange-100 border-orange-300/30",
  },
  {
    value: "chapters",
    label: "Chapters",
    accent: "bg-amber-400/10 text-amber-100 border-amber-300/30",
  },
  {
    value: "pinnedComment",
    label: "Pinned Comment",
    accent: "bg-fuchsia-400/10 text-fuchsia-100 border-fuchsia-300/30",
  },
];

const ADVANCED_VIDEO_INFO_BLOCK_OPTIONS: VideoInfoBlockOption[] = [
  {
    value: "contentPack",
    label: "Content Pack",
    accent: "bg-violet-400/10 text-violet-100 border-violet-300/30",
  },
  {
    value: "insights",
    label: "Insights",
    accent: "bg-white/10 text-white border-white/20",
  },
];

const ALL_VIDEO_INFO_BLOCK_OPTIONS: VideoInfoBlockOption[] = [
  ...PRIMARY_VIDEO_INFO_BLOCK_OPTIONS,
  ...ADVANCED_VIDEO_INFO_BLOCK_OPTIONS,
];

const VIDEO_INFO_PROMPT_SLOT_LABELS: Record<CreatorVideoInfoPromptSlot, string> = {
  persona: "Persona",
};

function toggleBlock(blocks: CreatorVideoInfoBlock[], value: CreatorVideoInfoBlock) {
  return blocks.includes(value) ? blocks.filter((block) => block !== value) : [...blocks, value];
}

function formatRelativeDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
}

function cloneVideoInfoPromptProfile(
  profile: CreatorVideoInfoPromptProfile | undefined
): CreatorVideoInfoPromptProfile {
  return sanitizeVideoInfoPromptProfile(profile) ?? createEmptyVideoInfoPromptProfile();
}

function updatePromptProfileSlot(
  profile: CreatorVideoInfoPromptProfile,
  slot: CreatorVideoInfoPromptSlot,
  update: Partial<{ mode: CreatorPromptSlotOverrideMode; value: string }>
): CreatorVideoInfoPromptProfile {
  const current = profile.slotOverrides?.[slot] ?? createEmptyPromptSlotOverride();
  const nextMode = update.mode ?? current.mode;
  const nextValue = update.value ?? current.value ?? "";
  const nextSlotOverrides = {
    ...(profile.slotOverrides ?? {}),
  };

  if (nextMode === "inherit") {
    delete nextSlotOverrides[slot];
  } else if (nextMode === "omit") {
    nextSlotOverrides[slot] = { mode: "omit" };
  } else {
    nextSlotOverrides[slot] = { mode: "replace", value: nextValue };
  }

  return {
    ...profile,
    slotOverrides: Object.keys(nextSlotOverrides).length > 0 ? nextSlotOverrides : undefined,
  };
}

function updatePromptProfileGlobalInstructions(
  profile: CreatorVideoInfoPromptProfile,
  value: string
): CreatorVideoInfoPromptProfile {
  const trimmed = value.trim();
  return {
    ...profile,
    globalInstructions: trimmed ? value : undefined,
  };
}

function updatePromptProfileFieldInstruction(
  profile: CreatorVideoInfoPromptProfile,
  block: CreatorVideoInfoBlock,
  value: string
): CreatorVideoInfoPromptProfile {
  const nextFieldInstructions = {
    ...(profile.fieldInstructions ?? {}),
  };

  if (value.trim()) {
    nextFieldInstructions[block] = value;
  } else {
    delete nextFieldInstructions[block];
  }

  return {
    ...profile,
    fieldInstructions: Object.keys(nextFieldInstructions).length > 0 ? nextFieldInstructions : undefined,
  };
}

function EffectiveInheritedValue({
  label,
  value,
  emptyCopy,
}: {
  label: string;
  value?: string;
  emptyCopy: string;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-3">
      <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/70">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-cyan-50/90">
        {value?.trim() ? value : emptyCopy}
      </div>
    </div>
  );
}

function MetadataBlockControl({
  option,
  enabled,
  value,
  inheritedValue,
  onToggle,
  onChange,
  inheritLabel,
  inheritEmptyCopy,
  placeholder,
}: {
  option: VideoInfoBlockOption;
  enabled: boolean;
  value: string;
  inheritedValue?: string;
  onToggle: () => void;
  onChange: (value: string) => void;
  inheritLabel: string;
  inheritEmptyCopy: string;
  placeholder: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        enabled
          ? option.accent
          : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10"
      )}
    >
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">{option.label}</div>
          <div
            className={cn(
              "h-4 w-4 rounded border transition-colors",
              enabled ? "border-white/90 bg-white/90" : "border-white/30 bg-transparent"
            )}
          />
        </div>
      </button>

      {enabled ? (
        <div className="mt-4">
          {!value.trim() ? (
            <EffectiveInheritedValue
              label={inheritLabel}
              value={inheritedValue}
              emptyCopy={inheritEmptyCopy}
            />
          ) : null}
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="mt-3 border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
          />
        </div>
      ) : null}
    </div>
  );
}

function PromptSlotControl({
  label,
  defaultValue,
  override,
  effectiveValue,
  onModeChange,
  onValueChange,
  inheritLabel,
  inheritEmptyCopy,
}: {
  label: string;
  defaultValue: string;
  override: { mode: CreatorPromptSlotOverrideMode; value?: string };
  effectiveValue?: string;
  onModeChange: (value: CreatorPromptSlotOverrideMode) => void;
  onValueChange: (value: string) => void;
  inheritLabel: string;
  inheritEmptyCopy: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="mt-1 text-xs text-zinc-500">{defaultValue}</div>
        </div>
        <Select value={override.mode} onValueChange={(value) => onModeChange(value as CreatorPromptSlotOverrideMode)}>
          <SelectTrigger className="w-[170px] border-white/10 bg-black/30 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit</SelectItem>
            <SelectItem value="replace">Replace</SelectItem>
            <SelectItem value="omit">Omit</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {override.mode === "replace" ? (
        <Textarea
          value={override.value ?? ""}
          onChange={(event) => onValueChange(event.target.value)}
          className="mt-3 min-h-24 border-white/10 bg-black/25 text-white"
        />
      ) : (
        <EffectiveInheritedValue
          label={override.mode === "omit" ? "Current result" : inheritLabel}
          value={override.mode === "omit" ? undefined : effectiveValue}
          emptyCopy={override.mode === "omit" ? "This line is currently omitted." : inheritEmptyCopy}
        />
      )}
    </div>
  );
}

function AiResultCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
      <div className={cn("space-y-1", !description && "space-y-0")}>
        <div className="text-sm font-semibold text-white">{title}</div>
        {description ? <div className="text-xs leading-relaxed text-zinc-500">{description}</div> : null}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

export function AiMetadataHub({ projectId }: { projectId: string }) {
  const {
    projects,
    saveProject,
  } = useProjectLibrary();

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projects, projectId]
  );

  const {
    history,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useHistoryLibrary(projectId);

  const [selectedSourceAssetId, setSelectedSourceAssetId] = useState("");

  const {
    openAIApiKey,
    hasOpenAIApiKey,
    maskedOpenAIApiKey,
    videoInfoPromptProfile,
    saveOpenAIApiKey,
    clearOpenAIApiKey,
    saveVideoInfoPromptProfile,
  } = useCreatorAiSettings();
  const [openAIApiKeyDraft, setOpenAIApiKeyDraft] = useState("");
  const [videoInfoBlocks, setVideoInfoBlocks] = useState<CreatorVideoInfoBlock[]>([]);
  const [promptEditorMode, setPromptEditorMode] = useState<VideoInfoPromptEditorMode>("global");
  const [globalPromptProfileDraft, setGlobalPromptProfileDraft] = useState<CreatorVideoInfoPromptProfile>(
    createEmptyVideoInfoPromptProfile()
  );
  const [runPromptProfileDraft, setRunPromptProfileDraft] = useState<CreatorVideoInfoPromptProfile>(
    createEmptyVideoInfoPromptProfile()
  );

  const { videoInfoAnalysis, setVideoInfoAnalysis, isGeneratingVideoInfo, videoInfoError, generateVideoInfo } =
    useCreatorVideoInfoGenerator();
  const { refresh: refreshLlmRuns } = useCreatorLlmRuns(projectId);

  // Generation history
  const videoInfoHistory = useMemo(
    () => resolveProjectVideoInfoHistory(selectedProject),
    [selectedProject]
  );
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Auto-select latest record
  useEffect(() => {
    if (videoInfoHistory.length > 0 && !selectedRecordId) {
      const latest = [...videoInfoHistory].sort((a, b) => b.generatedAt - a.generatedAt)[0];
      if (latest) {
        setSelectedRecordId(latest.id);
        setVideoInfoAnalysis(latest.analysis);
      }
    }
  }, [videoInfoHistory, selectedRecordId, setVideoInfoAnalysis]);

  const selectedRecord = useMemo(
    () => videoInfoHistory.find((r) => r.id === selectedRecordId) ?? null,
    [videoInfoHistory, selectedRecordId]
  );

  const handleSelectRecord = useCallback((record: CreatorVideoInfoProjectRecord) => {
    setSelectedRecordId(record.id);
    setVideoInfoAnalysis(record.analysis);
  }, [setVideoInfoAnalysis]);

  const handleDeleteRecord = useCallback(async (recordId: string) => {
    if (!selectedProject) return;
    const updated = removeProjectVideoInfoRecord(videoInfoHistory, recordId);
    await saveProject({
      ...selectedProject,
      youtubeVideoInfoHistory: updated,
      youtubeVideoInfo: undefined,
      updatedAt: Date.now(),
    });
    if (selectedRecordId === recordId) {
      const next = updated[0] ?? null;
      setSelectedRecordId(next?.id ?? null);
      setVideoInfoAnalysis(next?.analysis ?? null);
    }
    toast.success("Generation deleted");
  }, [selectedProject, videoInfoHistory, selectedRecordId, saveProject, setVideoInfoAnalysis]);

  // Source asset selection
  useEffect(() => {
    if (history.length > 0 && !selectedSourceAssetId) {
      const preferred =
        selectedProject?.activeSourceAssetId &&
        history.some((item) => item.id === selectedProject.activeSourceAssetId)
          ? selectedProject.activeSourceAssetId
          : history[0]?.id ?? "";
      setSelectedSourceAssetId(preferred);
    }
  }, [history, selectedProject?.activeSourceAssetId, selectedSourceAssetId]);

  const selectedHistoryItem = useMemo(
    () => history.find((item) => item.id === selectedSourceAssetId),
    [history, selectedSourceAssetId]
  );

  const selectedTranscript = useMemo(
    () => (selectedHistoryItem ? getLatestTranscript(selectedHistoryItem) : undefined),
    [selectedHistoryItem]
  );

  useEffect(() => {
    setOpenAIApiKeyDraft(openAIApiKey);
  }, [openAIApiKey]);

  useEffect(() => {
    setGlobalPromptProfileDraft(cloneVideoInfoPromptProfile(videoInfoPromptProfile));
  }, [videoInfoPromptProfile]);

  const videoInfoBlocksSet = useMemo(() => new Set(videoInfoBlocks), [videoInfoBlocks]);
  const savedGlobalPromptProfile = useMemo(
    () => cloneVideoInfoPromptProfile(videoInfoPromptProfile),
    [videoInfoPromptProfile]
  );
  const hasGlobalDraftEdits = useMemo(
    () => hasCustomizedVideoInfoPromptProfile(globalPromptProfileDraft),
    [globalPromptProfileDraft]
  );
  const hasRunDraftEdits = useMemo(
    () => hasCustomizedVideoInfoPromptProfile(runPromptProfileDraft),
    [runPromptProfileDraft]
  );
  const globalPromptSnapshot = useMemo(
    () => createVideoInfoPromptCustomizationSnapshot({ globalProfile: globalPromptProfileDraft }),
    [globalPromptProfileDraft]
  );
  const runPromptSnapshot = useMemo(
    () =>
      createVideoInfoPromptCustomizationSnapshot({
        globalProfile: savedGlobalPromptProfile,
        runProfile: runPromptProfileDraft,
      }),
    [runPromptProfileDraft, savedGlobalPromptProfile]
  );

  const creatorVideoInfoRequestBase = useMemo<CreatorVideoInfoGenerateRequest | null>(() => {
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

  const hasTranscriptContext =
    Boolean(selectedProject) &&
    Boolean(selectedTranscript?.transcript) &&
    Boolean(selectedTranscript?.chunks?.length);

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

  const handleSaveGlobalPromptProfile = useCallback(() => {
    saveVideoInfoPromptProfile(hasGlobalDraftEdits ? globalPromptProfileDraft : undefined);
    toast.success(hasGlobalDraftEdits ? "Global prompt defaults saved." : "Global prompt defaults restored.");
  }, [globalPromptProfileDraft, hasGlobalDraftEdits, saveVideoInfoPromptProfile]);

  const handleRestoreGlobalPromptProfile = useCallback(() => {
    setGlobalPromptProfileDraft(createEmptyVideoInfoPromptProfile());
    toast.success("Global prompt draft reset to the recommended defaults.");
  }, []);

  const handleClearRunPromptProfile = useCallback(() => {
    setRunPromptProfileDraft(createEmptyVideoInfoPromptProfile());
    toast.success("Run-only prompt overrides cleared.");
  }, []);

  const buildVideoInfoRequestWithPrompt = useCallback(
    (promptCustomization?: CreatorVideoInfoPromptCustomizationSnapshot) => {
      if (!creatorVideoInfoRequestBase) {
        return null;
      }
      return promptCustomization
        ? {
            ...creatorVideoInfoRequestBase,
            promptCustomization,
          }
        : creatorVideoInfoRequestBase;
    },
    [creatorVideoInfoRequestBase]
  );

  const activePromptSnapshot = useMemo(
    () =>
      selectVideoInfoPromptCustomizationSnapshot(promptEditorMode, {
        globalSnapshot: globalPromptSnapshot,
        runSnapshot: runPromptSnapshot,
      }),
    [globalPromptSnapshot, promptEditorMode, runPromptSnapshot]
  );

  const handleGenerateVideoInfo = useCallback(async (promptCustomization?: CreatorVideoInfoPromptCustomizationSnapshot) => {
    const creatorVideoInfoRequest = buildVideoInfoRequestWithPrompt(promptCustomization);
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
        const newRecord = buildProjectVideoInfoRecord({
          request: creatorVideoInfoRequest,
          response: result,
        });
        const updatedHistory = appendProjectVideoInfoRecord(videoInfoHistory, newRecord);
        await saveProject({
          ...selectedProject,
          youtubeVideoInfoHistory: updatedHistory,
          youtubeVideoInfo: undefined,
          updatedAt: Date.now(),
          lastOpenedAt: Date.now(),
        });
        setSelectedRecordId(newRecord.id);
      }
      toast.success(`Metadata generated (${result.providerMode})`);
      if (promptCustomization?.mode === "run_override") {
        setRunPromptProfileDraft(createEmptyVideoInfoPromptProfile());
      }
    } catch (error) {
      console.error(error);
    } finally {
      void refreshLlmRuns();
    }
  }, [
    buildVideoInfoRequestWithPrompt,
    generateVideoInfo,
    hasOpenAIApiKey,
    openAIApiKey,
    refreshLlmRuns,
    saveProject,
    selectedProject,
    videoInfoBlocks.length,
    videoInfoHistory,
  ]);

  const displayAnalysis = selectedRecord?.analysis ?? videoInfoAnalysis;
  const showContentPack = videoInfoBlocksSet.has("contentPack");
  const showInsights = videoInfoBlocksSet.has("insights");
  const promptSummaryRequest = useMemo(
    () => (videoInfoBlocks.length > 0 ? buildVideoInfoRequestWithPrompt(activePromptSnapshot) : null),
    [activePromptSnapshot, buildVideoInfoRequestWithPrompt, videoInfoBlocks.length]
  );
  const promptPreviewText = useMemo(
    () => (promptSummaryRequest ? buildVideoInfoPrompt(promptSummaryRequest) : ""),
    [promptSummaryRequest]
  );
  const { displayText: promptPreviewDisplay, transcriptText: promptPreviewTranscript } = useMemo(
    () => buildCollapsedVideoInfoPromptPreview(promptPreviewText),
    [promptPreviewText]
  );
  const primaryGenerateLabel =
    promptEditorMode === "run" && hasRunDraftEdits ? "Generate with this run only" : "Generate metadata";
  const secondaryGenerateLabel =
    promptEditorMode === "run" ? "Generate with saved globals" : "Generate with this run only";
  const secondaryGenerateSnapshot = promptEditorMode === "run" ? globalPromptSnapshot : runPromptSnapshot;
  const isGenerateDisabled =
    !hasTranscriptContext || !hasOpenAIApiKey || isGeneratingVideoInfo || videoInfoBlocks.length === 0;

  return (
    <div className="min-h-0 space-y-6 bg-transparent px-0 py-0">
      <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <CardHeader className="border-b border-white/6">
          <CardTitle className="flex items-center gap-2">
            <WandSparkles className="h-5 w-5 text-emerald-300" />
            AI Metadata Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {/* OpenAI key */}
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

          {/* Prompt customization */}
          <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
            <div className="text-sm font-semibold text-white">Prompt customization</div>

            <Tabs
              value={promptEditorMode}
              onValueChange={(value) => setPromptEditorMode(value as VideoInfoPromptEditorMode)}
              className="mt-5"
            >
              <TabsList className="w-full justify-start">
                <TabsTrigger value="global">Global defaults</TabsTrigger>
                <TabsTrigger value="run">This run only</TabsTrigger>
              </TabsList>

              <TabsContent value="global" className="space-y-4">
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-white">Metadata blocks</div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {ALL_VIDEO_INFO_BLOCK_OPTIONS.map((option) => (
                      <MetadataBlockControl
                        key={option.value}
                        option={option}
                        enabled={videoInfoBlocksSet.has(option.value)}
                        value={globalPromptProfileDraft.fieldInstructions?.[option.value] ?? ""}
                        inheritedValue={resolveVideoInfoPromptFieldInstruction(option.value, globalPromptProfileDraft)}
                        onToggle={() => setVideoInfoBlocks((prev) => toggleBlock(prev, option.value))}
                        onChange={(value) =>
                          setGlobalPromptProfileDraft((prev) =>
                            updatePromptProfileFieldInstruction(prev, option.value, value)
                          )
                        }
                        inheritLabel="Current saved note"
                        inheritEmptyCopy="No saved prompt note for this block yet."
                        placeholder={
                          VIDEO_INFO_PROMPT_FIELD_DEFAULTS[option.value]
                            ? `Override: ${VIDEO_INFO_PROMPT_FIELD_DEFAULTS[option.value]}`
                            : `Prompt note for ${option.label}`
                        }
                      />
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {VIDEO_INFO_PROMPT_SLOT_ORDER.map((slot) => {
                      const override = globalPromptProfileDraft.slotOverrides?.[slot] ?? createEmptyPromptSlotOverride();
                      const effectiveValue = resolveVideoInfoPromptSlotLine(slot, globalPromptProfileDraft);
                      return (
                        <PromptSlotControl
                          key={slot}
                          label={VIDEO_INFO_PROMPT_SLOT_LABELS[slot]}
                          defaultValue={VIDEO_INFO_PROMPT_SLOT_DEFAULTS[slot]}
                          override={override}
                          effectiveValue={effectiveValue}
                          onModeChange={(value) =>
                            setGlobalPromptProfileDraft((prev) =>
                              updatePromptProfileSlot(prev, slot, { mode: value })
                            )
                          }
                          onValueChange={(value) =>
                            setGlobalPromptProfileDraft((prev) =>
                              updatePromptProfileSlot(prev, slot, { mode: "replace", value })
                            )
                          }
                          inheritLabel="Current inherited value"
                          inheritEmptyCopy="This line is currently omitted from the effective prompt."
                        />
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="text-sm font-medium text-white">Global instructions</div>
                    {!globalPromptProfileDraft.globalInstructions?.trim() ? (
                      <EffectiveInheritedValue
                        label="Current inherited value"
                        value={undefined}
                        emptyCopy="No saved global instructions yet."
                      />
                    ) : null}
                    <Textarea
                      value={globalPromptProfileDraft.globalInstructions ?? ""}
                      onChange={(event) =>
                        setGlobalPromptProfileDraft((prev) =>
                          updatePromptProfileGlobalInstructions(prev, event.target.value)
                        )
                      }
                      placeholder="Global instructions"
                      className="mt-3 min-h-28 border-white/10 bg-black/25 text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    className="bg-white text-black hover:bg-zinc-200"
                    onClick={handleSaveGlobalPromptProfile}
                  >
                    Save global defaults
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="border border-amber-300/20 bg-amber-400/10 text-amber-50 hover:bg-amber-400/15"
                    onClick={handleRestoreGlobalPromptProfile}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Restore defaults
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="run" className="space-y-4">
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-white">Metadata blocks</div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {ALL_VIDEO_INFO_BLOCK_OPTIONS.map((option) => (
                      <MetadataBlockControl
                        key={option.value}
                        option={option}
                        enabled={videoInfoBlocksSet.has(option.value)}
                        value={runPromptProfileDraft.fieldInstructions?.[option.value] ?? ""}
                        inheritedValue={resolveVideoInfoPromptFieldInstruction(option.value, savedGlobalPromptProfile)}
                        onToggle={() => setVideoInfoBlocks((prev) => toggleBlock(prev, option.value))}
                        onChange={(value) =>
                          setRunPromptProfileDraft((prev) =>
                            updatePromptProfileFieldInstruction(prev, option.value, value)
                          )
                        }
                        inheritLabel="What this run is inheriting"
                        inheritEmptyCopy="No saved global note is being inherited for this block."
                        placeholder={
                          VIDEO_INFO_PROMPT_FIELD_DEFAULTS[option.value]
                            ? `Override: ${VIDEO_INFO_PROMPT_FIELD_DEFAULTS[option.value]}`
                            : `Prompt note for ${option.label}`
                        }
                      />
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {VIDEO_INFO_PROMPT_SLOT_ORDER.map((slot) => {
                      const override = runPromptProfileDraft.slotOverrides?.[slot] ?? createEmptyPromptSlotOverride();
                      const inheritedValue = resolveVideoInfoPromptSlotLine(slot, savedGlobalPromptProfile);
                      return (
                        <PromptSlotControl
                          key={slot}
                          label={VIDEO_INFO_PROMPT_SLOT_LABELS[slot]}
                          defaultValue={VIDEO_INFO_PROMPT_SLOT_DEFAULTS[slot]}
                          override={override}
                          effectiveValue={inheritedValue}
                          onModeChange={(value) =>
                            setRunPromptProfileDraft((prev) =>
                              updatePromptProfileSlot(prev, slot, { mode: value })
                            )
                          }
                          onValueChange={(value) =>
                            setRunPromptProfileDraft((prev) =>
                              updatePromptProfileSlot(prev, slot, { mode: "replace", value })
                            )
                          }
                          inheritLabel="What this run is inheriting"
                          inheritEmptyCopy="Nothing is being inherited here because the saved global defaults currently omit this line."
                        />
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="text-sm font-medium text-white">Global instructions</div>
                    {!runPromptProfileDraft.globalInstructions?.trim() ? (
                      <EffectiveInheritedValue
                        label="What this run is inheriting"
                        value={savedGlobalPromptProfile.globalInstructions}
                        emptyCopy="No saved global instructions are being inherited."
                      />
                    ) : null}
                    <Textarea
                      value={runPromptProfileDraft.globalInstructions ?? ""}
                      onChange={(event) =>
                        setRunPromptProfileDraft((prev) =>
                          updatePromptProfileGlobalInstructions(prev, event.target.value)
                        )
                      }
                      placeholder="Run-only instructions"
                      className="mt-3 min-h-28 border-white/10 bg-black/25 text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="border border-amber-300/20 bg-amber-400/10 text-amber-50 hover:bg-amber-400/15"
                    onClick={handleClearRunPromptProfile}
                    disabled={!hasRunDraftEdits}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Clear run overrides
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Generate button */}
          <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">Project metadata generation</div>
                {historyError ? <div className="text-xs leading-relaxed text-red-300">{historyError}</div> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void handleGenerateVideoInfo(activePromptSnapshot)}
                  disabled={isGenerateDisabled}
                  className="bg-[linear-gradient(135deg,rgba(34,211,238,0.95),rgba(16,185,129,0.95))] font-semibold text-black hover:opacity-95"
                >
                  {isGeneratingVideoInfo ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <WandSparkles className="mr-2 h-4 w-4" />
                  )}
                  {primaryGenerateLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleGenerateVideoInfo(secondaryGenerateSnapshot)}
                  disabled={
                    isGenerateDisabled ||
                    !hasRunDraftEdits
                  }
                  className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  {secondaryGenerateLabel}
                </Button>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-white/8 bg-black/25 p-4">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-200">
                  {promptPreviewDisplay || "Select metadata blocks to see the effective prompt."}
                </pre>
              </div>
              {promptPreviewTranscript ? (
                <Accordion type="single" collapsible className="rounded-2xl border border-white/8 bg-black/25 px-4">
                  <AccordionItem value="transcript" className="border-white/8">
                    <AccordionTrigger className="text-white hover:no-underline">Transcript</AccordionTrigger>
                    <AccordionContent>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                        {promptPreviewTranscript}
                      </pre>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ) : null}
            </div>
          </div>

          {/* Alerts */}
          {projectId && !isLoadingHistory && history.length === 0 ? (
            <Alert className="border-white/10 bg-black/20 text-zinc-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No transcript available yet</AlertTitle>
            </Alert>
          ) : null}

          {videoInfoError ? (
            <Alert className="border-red-400/25 bg-red-400/10 text-red-50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Metadata generation failed</AlertTitle>
              <AlertDescription className="text-red-50/80">{videoInfoError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Generation History */}
      {videoInfoHistory.length > 0 && (
        <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <CardHeader className="border-b border-white/6">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-cyan-300" />
              Generation History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {[...videoInfoHistory]
              .sort((a, b) => b.generatedAt - a.generatedAt)
              .map((record) => {
                const isSelected = record.id === selectedRecordId;
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => handleSelectRecord(record)}
                    className={cn(
                      "w-full rounded-2xl border p-4 text-left transition-all",
                      isSelected
                        ? "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_15px_rgba(6,182,212,0.08)]"
                        : "border-white/8 bg-black/20 hover:border-white/15 hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {isSelected && <Check className="h-3.5 w-3.5 text-cyan-400" />}
                          <span className="text-sm font-medium text-white">
                            {formatRelativeDate(record.generatedAt)}
                          </span>
                          <Badge className="border-white/10 bg-white/5 text-[10px] text-white/60">
                            {record.analysis.model || "unknown"}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {record.inputSummary.videoInfoBlocks.map((block) => (
                            <span
                              key={block}
                              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/55"
                            >
                              {block}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteRecord(record.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </button>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* Selected Generation Results */}
      {displayAnalysis ? (
        <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <CardHeader className="border-b border-white/6">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-300" />
              AI Results
              {selectedRecord && (
                <Badge className="ml-2 border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                  {formatRelativeDate(selectedRecord.generatedAt)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {displayAnalysis.youtube.titleIdeas?.length > 0 && (
              <AiResultCard title="Title ideas">
                <div className="space-y-2">
                  {displayAnalysis.youtube.titleIdeas.map((title, index) => (
                    <div
                      key={`${index}-${title}`}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm text-white/90">
                          <span className="mr-2 text-cyan-300">{index + 1}.</span>
                          {title}
                        </div>
                        <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(title, "Title idea")}>
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </AiResultCard>
            )}

            {displayAnalysis.youtube.description && (
              <AiResultCard title="Description draft">
                <Textarea
                  readOnly
                  value={displayAnalysis.youtube.description}
                  className="min-h-44 border-white/10 bg-black/25 text-white"
                />
                <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(displayAnalysis.youtube.description, "Description")}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy
                </Button>
              </AiResultCard>
            )}

            {displayAnalysis.youtube.hashtags?.length > 0 && (
              <AiResultCard title="Hashtags">
                <div className="flex flex-wrap gap-2">
                  {displayAnalysis.youtube.hashtags.map((tag) => (
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
                <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(displayAnalysis.youtube.hashtags.join(", "), "Hashtags")}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy
                </Button>
              </AiResultCard>
            )}

            {displayAnalysis.youtube.chapterText && (
              <AiResultCard title="Chapter block">
                <Textarea
                  readOnly
                  value={displayAnalysis.youtube.chapterText}
                  className="min-h-32 border-white/10 bg-black/25 text-white"
                />
                <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(displayAnalysis.youtube.chapterText, "Chapter block")}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy
                </Button>
              </AiResultCard>
            )}

            {(displayAnalysis.youtube.pinnedComment || displayAnalysis.youtube.thumbnailHooks?.length > 0) && (
              <AiResultCard title="Packaging extras">
                {displayAnalysis.youtube.pinnedComment ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/85">
                    {displayAnalysis.youtube.pinnedComment}
                  </div>
                ) : null}
                {displayAnalysis.youtube.thumbnailHooks?.length > 0 ? (
                  <div className="grid gap-2">
                    {displayAnalysis.youtube.thumbnailHooks.map((hook) => (
                      <div key={hook} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/85">
                        {hook}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {displayAnalysis.youtube.pinnedComment ? (
                    <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(displayAnalysis.youtube.pinnedComment, "Pinned comment")}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy pinned comment
                    </Button>
                  ) : null}
                  {displayAnalysis.youtube.thumbnailHooks?.length > 0 ? (
                    <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(displayAnalysis.youtube.thumbnailHooks.join("\n"), "Thumbnail hooks")}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy hooks
                    </Button>
                  ) : null}
                </div>
              </AiResultCard>
            )}

            {showContentPack || showInsights ? (
              <AiResultCard title="Advanced analysis">
                {showContentPack ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/85">
                    <div className="font-medium text-white">Summary</div>
                    <div className="mt-2 leading-relaxed text-zinc-300">{displayAnalysis.content.videoSummary}</div>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Hooks</div>
                        <div className="mt-2 space-y-2">
                          {displayAnalysis.content.hookIdeas.map((hook) => (
                            <div key={hook} className="rounded-xl border border-white/8 bg-black/20 p-2.5">
                              {hook}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Repurpose</div>
                        <div className="mt-2 space-y-2">
                          {displayAnalysis.content.repurposeIdeas.map((idea) => (
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
                      <div className="mt-2 text-2xl font-semibold text-white">{displayAnalysis.insights.transcriptWordCount}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">WPM</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{displayAnalysis.insights.estimatedSpeakingRateWpm}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:col-span-2">
                      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Theme</div>
                      <div className="mt-2 text-sm text-white/85">{displayAnalysis.insights.detectedTheme}</div>
                    </div>
                  </div>
                ) : null}
              </AiResultCard>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-zinc-400">
          Generated metadata will appear here. Run a generation or select a previous one from the history.
        </div>
      )}
    </div>
  );
}
