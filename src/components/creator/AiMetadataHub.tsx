"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  KeyRound,
  Loader2,
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
  appendProjectVideoInfoRecord,
  buildProjectVideoInfoRecord,
  removeProjectVideoInfoRecord,
  resolveProjectVideoInfoHistory,
} from "@/lib/creator/video-info-storage";
import {
  DEFAULT_YOUTUBE_PUBLISH_VIDEO_INFO_BLOCKS,
} from "@/lib/creator/youtube-publish";
import type {
  CreatorVideoInfoBlock,
  CreatorVideoInfoGenerateRequest,
  CreatorVideoInfoGenerateResponse,
  CreatorVideoInfoProjectRecord,
} from "@/lib/creator/types";
import { getLatestTranscript } from "@/lib/history";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

export function AiMetadataHub({ projectId }: { projectId: string }) {
  const {
    projects,
    isLoading: isLoadingProjects,
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
  const { runs: llmRuns, refresh: refreshLlmRuns } = useCreatorLlmRuns(projectId);

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
    videoInfoHistory,
  ]);

  const displayAnalysis = selectedRecord?.analysis ?? videoInfoAnalysis;
  const showContentPack = videoInfoBlocksSet.has("contentPack");
  const showInsights = videoInfoBlocksSet.has("insights");

  return (
    <div className="min-h-0 space-y-6 bg-transparent px-0 py-0">
      <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <CardHeader className="border-b border-white/6">
          <CardTitle className="flex items-center gap-2">
            <WandSparkles className="h-5 w-5 text-emerald-300" />
            AI Metadata Generator
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Generate upload-ready metadata from your project's transcript. Each generation is saved to the project history.
          </CardDescription>
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

          {/* Metadata blocks */}
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

          {/* Generate button */}
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

          {/* Status badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/5 text-white/70">
              {llmRuns.length} AI run{llmRuns.length === 1 ? "" : "s"}
            </Badge>
            <Badge className="border-white/10 bg-white/5 text-white/70">
              {videoInfoHistory.length} saved generation{videoInfoHistory.length === 1 ? "" : "s"}
            </Badge>
          </div>

          {/* Alerts */}
          {projectId && !isLoadingHistory && history.length === 0 ? (
            <Alert className="border-white/10 bg-black/20 text-zinc-200">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No transcript available yet</AlertTitle>
              <AlertDescription className="text-zinc-400">
                AI metadata will unlock as soon as this project has a transcript.
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
            <CardDescription className="text-zinc-400">
              Select a generation to inspect. This data can be loaded into the Publish tab.
            </CardDescription>
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
              <AiResultCard
                title="Title ideas"
                description="Copy any suggestion to use it in the Publish tab."
              >
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
              <AiResultCard
                title="Description draft"
                description="Full description generated from the transcript."
              >
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

            {(displayAnalysis.youtube.hashtags?.length > 0 || displayAnalysis.youtube.seoKeywords?.length > 0) && (
              <AiResultCard
                title="Hashtags + SEO"
                description="Hashtags and keyword phrases for upload tags."
              >
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
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/80">
                  {displayAnalysis.youtube.seoKeywords.join(", ")}
                </div>
                <Button size="sm" variant="ghost" className="bg-white/5 text-white hover:bg-white/10" onClick={() => void copyText(displayAnalysis.youtube.seoKeywords.join(", "), "SEO keywords")}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy keywords
                </Button>
              </AiResultCard>
            )}

            {displayAnalysis.youtube.chapterText && (
              <AiResultCard
                title="Chapter block"
                description="Timestamped chapters ready to use."
              >
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
              <AiResultCard
                title="Packaging extras"
                description="Pinned comment and thumbnail hooks."
              >
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
              <AiResultCard
                title="Advanced analysis"
                description="Extended content and insights blocks."
              >
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
