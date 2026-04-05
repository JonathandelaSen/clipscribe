"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  KeyRound,
  Loader2,
  Mic2,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { ProjectAudioPlayer } from "@/components/projects/ProjectAudioPlayer";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useProjectVoiceoverConfig } from "@/hooks/useProjectVoiceoverConfig";
import { useProjectVoiceoverGenerator } from "@/hooks/useProjectVoiceoverGenerator";
import { readMediaMetadata } from "@/lib/editor/media";
import { createEditorAssetRecord } from "@/lib/editor/storage";
import type {
  ContentProjectRecord,
  ProjectAssetRecord,
  ProjectVoiceoverRecord,
} from "@/lib/projects/types";
import type {
  ProjectVoiceoverDraft,
  VoiceoverApiKeySource,
  VoiceoverGenerateRequest,
} from "@/lib/voiceover/types";
import {
  areProjectVoiceoverDraftsEqual,
  buildProjectVoiceoverDraftFromRecord,
  buildProjectVoiceoverFilename,
  buildProjectVoiceoverRecord,
  estimateVoiceoverUsage,
  extractVoiceoverTextFromFileContents,
  getProjectVoiceoverApiKeyLabel,
  getProjectVoiceoverReplayStatus,
  isSupportedVoiceoverScriptFilename,
  maskVoiceoverSecret,
  normalizeProjectVoiceoverDraft,
} from "@/lib/voiceover/utils";
import { cn } from "@/lib/utils";

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("es", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remaining = wholeSeconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatWholeNumber(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "n/d";
  return new Intl.NumberFormat("es").format(Math.max(0, Math.round(value)));
}

function formatUsd(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "n/d";
  return new Intl.NumberFormat("es", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatUsageMetric(value: string, approximate = false) {
  return approximate ? `~${value}` : value;
}

function formatCredits(
  estimatedCreditsMin: number,
  estimatedCreditsMax: number,
) {
  const min = formatWholeNumber(estimatedCreditsMin);
  const max = formatWholeNumber(estimatedCreditsMax);
  return estimatedCreditsMin === estimatedCreditsMax
    ? `${max} cr`
    : `${min}-${max} cr`;
}

function triggerFileDownload(file: File, filename: string) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resolveCurrentApiKeySource(hasLocalApiKey: boolean, hasEnvApiKey: boolean): VoiceoverApiKeySource | undefined {
  if (hasLocalApiKey) return "voiceover_settings";
  if (hasEnvApiKey) return "env";
  return undefined;
}

type ProjectVoiceoverWorkspaceProps = {
  project: ContentProjectRecord;
  assets: ProjectAssetRecord[];
  voiceovers: ProjectVoiceoverRecord[];
  saveVoiceoverDraft: (draft: ProjectVoiceoverDraft) => Promise<void>;
  saveGeneratedVoiceover: (input: {
    asset: ProjectAssetRecord;
    voiceover: ProjectVoiceoverRecord;
  }) => Promise<void>;
  renameAsset: (assetId: string, filename: string) => Promise<void>;
};

export function ProjectVoiceoverWorkspace({
  project,
  assets,
  voiceovers,
  saveVoiceoverDraft,
  saveGeneratedVoiceover,
  renameAsset,
}: ProjectVoiceoverWorkspaceProps) {
  const scriptInputRef = useRef<HTMLInputElement | null>(null);
  const lastProjectIdRef = useRef(project.id);
  const {
    elevenLabsApiKey,
    hasElevenLabsApiKey,
    maskedElevenLabsApiKey,
    saveElevenLabsApiKey,
    clearElevenLabsApiKey,
  } = useCreatorAiSettings();
  const config = useProjectVoiceoverConfig();
  const { generateVoiceover, isGeneratingVoiceover, voiceoverError } =
    useProjectVoiceoverGenerator();

  const persistedDraft = useMemo(
    () =>
      normalizeProjectVoiceoverDraft(project.voiceoverDraft, {
        model: config.defaultModel,
      }),
    [config.defaultModel, project.voiceoverDraft],
  );
  const [draft, setDraft] = useState<ProjectVoiceoverDraft>(persistedDraft);
  const [elevenLabsApiKeyDraft, setElevenLabsApiKeyDraft] =
    useState(elevenLabsApiKey);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [selectedVoiceoverId, setSelectedVoiceoverId] = useState<string | null>(
    null,
  );

  const assetsById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const draftUsage = useMemo(
    () =>
      estimateVoiceoverUsage({
        model: draft.model,
        scriptText: draft.text,
      }),
    [draft.model, draft.text],
  );
  const generatedAudioRecords = useMemo(
    () =>
      voiceovers
        .map((record) => ({
          record,
          asset: assetsById.get(record.assetId),
        }))
        .filter(
          (
            entry,
          ): entry is {
            record: ProjectVoiceoverRecord;
            asset: ProjectAssetRecord;
          } => Boolean(entry.asset),
        ),
    [assetsById, voiceovers],
  );
  const draftWordCount = useMemo(
    () => draft.text.trim().split(/\s+/).filter(Boolean).length,
    [draft.text],
  );
  const scriptPreview = useMemo(() => draft.text.trim(), [draft.text]);
  const currentApiKeySource = resolveCurrentApiKeySource(
    hasElevenLabsApiKey,
    config.hasApiKey,
  );
  const apiKeySourceLabel = currentApiKeySource
    ? getProjectVoiceoverApiKeyLabel(currentApiKeySource)
    : "Missing";
  const selectedVoiceover = useMemo(
    () => voiceovers.find((record) => record.id === selectedVoiceoverId) ?? null,
    [selectedVoiceoverId, voiceovers],
  );
  const selectedVoiceoverReplayStatus = useMemo(
    () =>
      selectedVoiceover
        ? getProjectVoiceoverReplayStatus(selectedVoiceover, {
            hasLocalApiKey: hasElevenLabsApiKey,
          })
        : null,
    [hasElevenLabsApiKey, selectedVoiceover],
  );

  useEffect(() => {
    if (lastProjectIdRef.current === project.id) {
      return;
    }
    lastProjectIdRef.current = project.id;
    setDraft(persistedDraft);
    setSelectedVoiceoverId(null);
  }, [persistedDraft, project.id]);

  useEffect(() => {
    setDraft((current) => {
      if (
        current.text !== persistedDraft.text ||
        current.sourceFilename !== persistedDraft.sourceFilename ||
        current.provider !== persistedDraft.provider ||
        current.outputFormat !== persistedDraft.outputFormat
      ) {
        return current;
      }

      return {
        ...current,
        model: current.model || persistedDraft.model,
        voiceId: current.voiceId || persistedDraft.voiceId,
      };
    });
  }, [
    persistedDraft.model,
    persistedDraft.outputFormat,
    persistedDraft.provider,
    persistedDraft.sourceFilename,
    persistedDraft.text,
    persistedDraft.voiceId,
  ]);

  useEffect(() => {
    setElevenLabsApiKeyDraft(elevenLabsApiKey);
  }, [elevenLabsApiKey]);

  useEffect(() => {
    if (areProjectVoiceoverDraftsEqual(draft, persistedDraft)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveVoiceoverDraft(draft).catch((error) => {
        console.error(error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save voiceover draft",
        );
      });
    }, 320);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draft, persistedDraft, saveVoiceoverDraft]);

  const canGenerate =
    draft.text.trim().length > 0 && draft.model.trim().length > 0;
  const hasAvailableApiKey = hasElevenLabsApiKey || config.hasApiKey;

  const handleApiKeySave = () => {
    const trimmed = elevenLabsApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste an ElevenLabs API key first.");
      return;
    }
    saveElevenLabsApiKey(trimmed);
    toast.success("ElevenLabs key saved");
  };

  const handleImportScript = async (file: File | null | undefined) => {
    if (!file) return;
    if (!isSupportedVoiceoverScriptFilename(file.name)) {
      toast.error("Supported files: .txt, .md, .srt, .vtt");
      return;
    }

    try {
      const text = extractVoiceoverTextFromFileContents(
        file.name,
        await file.text(),
      );
      setDraft((current) => ({
        ...current,
        text,
        sourceFilename: file.name,
      }));
      toast.success(`Loaded ${file.name}`);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not read the script file",
      );
    }
  };

  const buildGenerateRequest = (): VoiceoverGenerateRequest | null => {
    if (!canGenerate) {
      toast.error("Add script text and model before generating.");
      return null;
    }
    if (!draft.voiceId.trim()) {
      toast.error("Paste an ElevenLabs voice ID before generating.");
      return null;
    }
    if (!hasAvailableApiKey) {
      toast.error("Add your ElevenLabs API key or set it in .env first.");
      return null;
    }

    return {
      projectId: project.id,
      scriptText: draft.text,
      provider: draft.provider,
      model: draft.model,
      voiceId: draft.voiceId,
      outputFormat: draft.outputFormat,
    };
  };

  const handleGenerate = async (request: VoiceoverGenerateRequest) => {
    try {
      await saveVoiceoverDraft(draft);
      const result = await generateVoiceover(request, {
        elevenLabsApiKey: hasElevenLabsApiKey ? elevenLabsApiKey : undefined,
      });
      const metadata = await readMediaMetadata(result.file);
      const now = Date.now();
      const asset = createEditorAssetRecord({
        projectId: project.id,
        role: "support",
        origin: "ai-audio",
        kind: "audio",
        filename:
          result.file.name ||
          buildProjectVoiceoverFilename({
            projectName: project.name,
            provider: request.provider,
            outputFormat: request.outputFormat,
            createdAt: now,
          }),
        mimeType: result.file.type || result.meta.mimeType,
        sizeBytes: result.file.size,
        durationSeconds: metadata.durationSeconds,
        hasAudio: true,
        sourceType: "upload",
        captionSource: { kind: "none" },
        fileBlob: result.file,
        now,
      }) as ProjectAssetRecord;
      const voiceover = buildProjectVoiceoverRecord({
        projectId: project.id,
        assetId: asset.id,
        request: {
          ...request,
          model: result.meta.model,
          voiceId: result.meta.voiceId,
          outputFormat: result.meta.outputFormat,
        },
        scriptText: draft.text,
        sourceFilename: draft.sourceFilename,
        apiKeySource: result.meta.apiKeySource,
        maskedApiKey: result.meta.maskedApiKey,
        usage: result.meta.usage,
        createdAt: now,
      });

      await saveGeneratedVoiceover({
        asset,
        voiceover,
      });

      toast.success(`Audio generated with ${result.meta.provider}`);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Voiceover generation failed",
      );
    }
  };

  const handleOpenGenerateConfirm = () => {
    const request = buildGenerateRequest();
    if (!request) return;
    setIsConfirmDialogOpen(true);
  };

  const handleConfirmGenerate = async () => {
    const request = buildGenerateRequest();
    if (!request) {
      setIsConfirmDialogOpen(false);
      return;
    }

    setIsConfirmDialogOpen(false);
    await handleGenerate(request);
  };

  const handleRenameAsset = async (asset: ProjectAssetRecord) => {
    const nextName = window.prompt("Rename audio", asset.filename)?.trim();
    if (!nextName || nextName === asset.filename) return;
    await renameAsset(asset.id, nextName);
    toast.success("Audio renamed");
  };

  const handleSelectVoiceover = (record: ProjectVoiceoverRecord) => {
    setSelectedVoiceoverId(record.id);
    setDraft(buildProjectVoiceoverDraftFromRecord(record));
    toast.success("Voiceover run loaded into the form");
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <section className="space-y-6">
          <Card className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(10,18,32,0.96),rgba(4,8,16,0.92))] text-white shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <CardHeader className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(94,234,212,0.16),transparent_36%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_28%)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.32em] text-cyan-100/70">
                    <Mic2 className="h-3.5 w-3.5" />
                    Voiceover
                  </div>
                  <CardTitle className="text-2xl font-semibold tracking-tight">
                    Script to Audio
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-50">
                    {draft.provider}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white/75"
                  >
                    {draft.outputFormat}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
                <div className="space-y-2">
                  <Label htmlFor="voiceover-provider" className="text-white/80">
                    Provider
                  </Label>
                  <Select
                    value={draft.provider}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        provider: value as ProjectVoiceoverDraft["provider"],
                      }))
                    }
                  >
                    <SelectTrigger id="voiceover-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="voiceover-model" className="text-white/80">
                    Model
                  </Label>
                  <Select
                    value={draft.model}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        model: value,
                      }))
                    }
                  >
                    <SelectTrigger id="voiceover-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {config.models.map((model) => (
                        <SelectItem key={model.value} value={model.value}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="voiceover-format" className="text-white/80">
                    Format
                  </Label>
                  <Select
                    value={draft.outputFormat}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        outputFormat:
                          value as ProjectVoiceoverDraft["outputFormat"],
                      }))
                    }
                  >
                    <SelectTrigger id="voiceover-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp3">MP3</SelectItem>
                      <SelectItem value="wav">WAV</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <Label htmlFor="voiceover-voice-id" className="text-white/80">
                    Voice ID
                  </Label>
                  <Input
                    id="voiceover-voice-id"
                    value={draft.voiceId}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        voiceId: event.target.value,
                      }))
                    }
                    placeholder="Paste the ElevenLabs voice ID"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <input
                    ref={scriptInputRef}
                    type="file"
                    className="hidden"
                    accept=".txt,.md,.srt,.vtt,text/plain,text/markdown,text/vtt,application/x-subrip"
                    onChange={(event) => {
                      void handleImportScript(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => scriptInputRef.current?.click()}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Import Text
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="voiceover-script" className="text-white/80">
                    Script
                  </Label>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">
                    {draft.text.trim().length} chars
                  </div>
                </div>
                <Textarea
                  id="voiceover-script"
                  value={draft.text}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      text: event.target.value,
                    }))
                  }
                  className="min-h-[360px] rounded-[1.7rem] border-white/10 bg-black/25 px-5 py-4 font-['Georgia'] text-[15px] leading-7"
                  placeholder="Paste the narration script here"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-white/10 bg-black/25 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-white/55">
                  <Save className="h-4 w-4 text-cyan-300" />
                  Autosaved
                  {draft.sourceFilename ? (
                    <Badge
                      variant="outline"
                      className="border-white/15 bg-white/5 text-white/70"
                    >
                      {draft.sourceFilename}
                    </Badge>
                  ) : null}
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white/70"
                  >
                    {formatUsageMetric(
                      `${formatWholeNumber(draftUsage.billedCharacters)} chars`,
                      true,
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white/70"
                  >
                    {formatUsageMetric(
                      formatCredits(
                        draftUsage.estimatedCreditsMin,
                        draftUsage.estimatedCreditsMax,
                      ),
                      true,
                    )}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white/70"
                  >
                    {formatUsageMetric(
                      formatUsd(draftUsage.estimatedCostUsd),
                      true,
                    )}
                  </Badge>
                </div>
                <Button
                  className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                  onClick={handleOpenGenerateConfirm}
                  disabled={!canGenerate || isGeneratingVoiceover}
                >
                  {isGeneratingVoiceover ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  Generate Audio
                </Button>
              </div>

              {voiceoverError ? (
                <Alert className="border-red-400/20 bg-red-500/10 text-red-50">
                  <WandSparkles className="h-4 w-4" />
                  <AlertDescription>{voiceoverError}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03] text-white">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle>Generated Audio</CardTitle>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-white/70"
              >
                {generatedAudioRecords.length}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {generatedAudioRecords.length === 0 ? (
                <div className="rounded-[1.6rem] border border-dashed border-white/10 bg-black/20 p-8 text-center text-white/45">
                  No generated audio yet.
                </div>
              ) : (
                generatedAudioRecords.map(({ record, asset }) => (
                  <div
                    key={record.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectVoiceover(record)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectVoiceover(record);
                      }
                    }}
                    aria-pressed={selectedVoiceoverId === record.id}
                    className={cn(
                      "relative rounded-[1.5rem] border bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70",
                      selectedVoiceoverId === record.id
                        ? "border-cyan-300/45 shadow-[0_0_0_1px_rgba(103,232,249,0.28),0_18px_50px_rgba(8,145,178,0.12)]"
                        : "border-white/10 hover:border-white/20",
                    )}
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          className="absolute right-4 top-4 rounded-md text-white/46 hover:bg-white/[0.06] hover:text-white"
                          aria-label={`Actions for ${asset.filename}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          disabled={!asset.fileBlob}
                          onSelect={() =>
                            asset.fileBlob &&
                            triggerFileDownload(asset.fileBlob, asset.filename)
                          }
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => void handleRenameAsset(asset)}
                        >
                          <Pencil className="h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="space-y-3 pr-10">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-white">
                            {asset.filename}
                          </div>
                          {selectedVoiceoverId === record.id ? (
                            <Badge className="border-cyan-300/20 bg-cyan-300/15 text-cyan-50">
                              Loaded
                            </Badge>
                          ) : null}
                          <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-50">
                            {record.provider}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-white/15 bg-white/5 text-white/70"
                          >
                            {record.outputFormat}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-white/52">
                          <span>{formatDateTime(record.createdAt)}</span>
                          <span>{formatDuration(asset.durationSeconds)}</span>
                          <span>{record.model}</span>
                          <span>{maskVoiceoverSecret(record.voiceId)}</span>
                        </div>
                      </div>
                      {record.usage ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                          <Badge
                            variant="outline"
                            className="border-white/15 bg-white/5 text-white/70"
                          >
                            {formatUsageMetric(
                              `${formatWholeNumber(record.usage.billedCharacters)} chars`,
                              record.usage.source !== "provider",
                            )}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-white/15 bg-white/5 text-white/70"
                          >
                            {formatUsageMetric(
                              formatCredits(
                                record.usage.estimatedCreditsMin,
                                record.usage.estimatedCreditsMax,
                              ),
                              true,
                            )}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="border-white/15 bg-white/5 text-white/70"
                          >
                            {formatUsageMetric(
                              formatUsd(record.usage.estimatedCostUsd),
                              true,
                            )}
                          </Badge>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-white/52">
                        <Badge
                          variant="outline"
                          className="border-white/15 bg-white/5 text-white/70"
                        >
                          {getProjectVoiceoverApiKeyLabel(record.apiKeySource)}
                        </Badge>
                        {record.maskedApiKey ? (
                          <Badge
                            variant="outline"
                            className="border-white/15 bg-white/5 text-white/70"
                          >
                            {record.maskedApiKey}
                          </Badge>
                        ) : null}
                      </div>
                      <ProjectAudioPlayer
                        file={asset.fileBlob}
                        className="max-w-xl"
                      />
                    </div>
                    {record.sourceFilename ? (
                      <div className="mt-3 text-xs text-white/38">
                        {record.sourceFilename}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-6">
          <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(7,13,23,0.92),rgba(7,13,23,0.74))] text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-cyan-300" />
                ElevenLabs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="elevenlabs-api-key" className="text-white/80">
                  API Key
                </Label>
                <Input
                  id="elevenlabs-api-key"
                  value={elevenLabsApiKeyDraft}
                  onChange={(event) =>
                    setElevenLabsApiKeyDraft(event.target.value)
                  }
                  placeholder="Paste your ElevenLabs API key"
                  type="password"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                  onClick={handleApiKeySave}
                >
                  Save Key
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => {
                    clearElevenLabsApiKey();
                    toast.success("ElevenLabs key cleared");
                  }}
                  disabled={!hasElevenLabsApiKey}
                >
                  Clear
                </Button>
              </div>

              <div
                className={cn(
                  "rounded-[1.4rem] border px-4 py-3 text-sm",
                  hasAvailableApiKey
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-black/20 text-white/50",
                )}
              >
                {hasElevenLabsApiKey
                  ? maskedElevenLabsApiKey
                  : config.hasApiKey
                    ? config.maskedApiKey
                    : "No key detected"}
              </div>

              {hasElevenLabsApiKey && config.hasApiKey ? (
                <div className="text-xs text-white/45">
                  Local key overrides `.env`
                </div>
              ) : null}

              {selectedVoiceover && selectedVoiceoverReplayStatus ? (
                <div
                  className={cn(
                    "rounded-[1.4rem] border px-4 py-3 text-sm",
                    selectedVoiceoverReplayStatus.needsLocalApiKey
                      ? "border-amber-300/20 bg-amber-500/10 text-amber-50"
                      : "border-cyan-300/20 bg-cyan-400/10 text-cyan-50",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-white/10 bg-black/25 text-current">
                      Loaded run
                    </Badge>
                    <span>{selectedVoiceoverReplayStatus.sourceLabel}</span>
                    {selectedVoiceoverReplayStatus.maskedApiKey ? (
                      <Badge className="border-white/10 bg-black/25 text-current">
                        {selectedVoiceoverReplayStatus.maskedApiKey}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs leading-relaxed opacity-90">
                    {selectedVoiceoverReplayStatus.message}
                  </div>
                </div>
              ) : null}

              {config.hasDefaultVoiceId ? (
                <div className="rounded-[1.4rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/65">
                  Voice ID in `.env`: {config.maskedDefaultVoiceId}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.03] text-white">
            <CardHeader>
              <CardTitle>Project Pulse</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                  Draft
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {draftWordCount}
                </div>
                <div className="text-sm text-white/45">words</div>
              </div>
              <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                  Generated
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {generatedAudioRecords.length}
                </div>
                <div className="text-sm text-white/45">audio assets</div>
              </div>
              <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                  Timeline
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {project.timeline.audioItems.length}
                </div>
                <div className="text-sm text-white/45">audio items</div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent className="overflow-hidden border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.985),rgba(4,7,12,0.985))] p-0 text-white shadow-[0_24px_90px_rgba(0,0,0,0.48)] sm:max-w-3xl">
          <DialogHeader className="border-b border-white/8 px-6 py-5 text-left">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-white">
              Confirm audio generation
            </DialogTitle>
            <DialogDescription className="text-sm text-white/55">
              Review the payload before sending it to the API.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[0.95fr_1.05fr]">
            <section className="space-y-3 rounded-[1.6rem] border border-white/8 bg-black/20 p-4">
              {[
                { label: "Provider", value: draft.provider },
                { label: "Model", value: draft.model },
                {
                  label: "Voice ID",
                  value: maskVoiceoverSecret(draft.voiceId) || "Missing",
                },
                { label: "Format", value: draft.outputFormat.toUpperCase() },
                { label: "API key", value: apiKeySourceLabel },
                {
                  label: "Source file",
                  value: draft.sourceFilename || "Manual script",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="text-sm text-white/52">{item.label}</div>
                  <div className="text-right text-sm font-medium text-white">
                    {item.value}
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3 rounded-[1.6rem] border border-white/8 bg-black/20 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">
                    Words
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {formatWholeNumber(draftWordCount)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">
                    Chars
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {formatWholeNumber(draftUsage.billedCharacters)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/38">
                    Estimate
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {formatCredits(
                      draftUsage.estimatedCreditsMin,
                      draftUsage.estimatedCreditsMax,
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white/70"
                  >
                    {formatUsd(draftUsage.estimatedCostUsd)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white/70"
                  >
                    {draft.sourceFilename || "Manual script"}
                  </Badge>
                </div>
                <div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-[1.2rem] border border-white/8 bg-black/25 px-4 py-3 text-sm leading-6 text-white/78">
                  {scriptPreview || "No script"}
                </div>
              </div>
            </section>
          </div>

          <DialogFooter className="border-t border-white/8 px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-white/72 hover:bg-white/10 hover:text-white"
              onClick={() => setIsConfirmDialogOpen(false)}
              disabled={isGeneratingVoiceover}
            >
              Back to edit
            </Button>
            <Button
              type="button"
              className="min-w-[190px] rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
              onClick={() => void handleConfirmGenerate()}
              disabled={isGeneratingVoiceover}
            >
              {isGeneratingVoiceover ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Confirm generation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
