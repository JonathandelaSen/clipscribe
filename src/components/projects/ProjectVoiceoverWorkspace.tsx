"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Download, KeyRound, Loader2, Mic2, Plus, RefreshCcw, Save, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useProjectVoiceoverConfig } from "@/hooks/useProjectVoiceoverConfig";
import { useProjectVoiceoverGenerator } from "@/hooks/useProjectVoiceoverGenerator";
import { appendTimelineAudioItem } from "@/lib/editor/core/timeline";
import { readMediaMetadata } from "@/lib/editor/media";
import { createDefaultAudioTrack, createEditorAssetRecord } from "@/lib/editor/storage";
import type { ContentProjectRecord, ProjectAssetRecord, ProjectVoiceoverRecord } from "@/lib/projects/types";
import type { ProjectVoiceoverDraft, VoiceoverGenerateRequest } from "@/lib/voiceover/types";
import {
  areProjectVoiceoverDraftsEqual,
  buildProjectVoiceoverFilename,
  buildProjectVoiceoverRecord,
  extractVoiceoverTextFromFileContents,
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

function triggerFileDownload(file: File, filename: string) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type ProjectVoiceoverWorkspaceProps = {
  project: ContentProjectRecord;
  assets: ProjectAssetRecord[];
  voiceovers: ProjectVoiceoverRecord[];
  saveProject: (record: ContentProjectRecord) => Promise<void>;
  saveVoiceoverDraft: (draft: ProjectVoiceoverDraft) => Promise<void>;
  saveGeneratedVoiceover: (input: { asset: ProjectAssetRecord; voiceover: ProjectVoiceoverRecord }) => Promise<void>;
  renameAsset: (assetId: string, filename: string) => Promise<void>;
};

export function ProjectVoiceoverWorkspace({
  project,
  assets,
  voiceovers,
  saveProject,
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
  const { generateVoiceover, isGeneratingVoiceover, voiceoverError } = useProjectVoiceoverGenerator();

  const persistedDraft = useMemo(
    () =>
      normalizeProjectVoiceoverDraft(project.voiceoverDraft, {
        model: config.defaultModel,
      }),
    [config.defaultModel, project.voiceoverDraft]
  );
  const [draft, setDraft] = useState<ProjectVoiceoverDraft>(persistedDraft);
  const [elevenLabsApiKeyDraft, setElevenLabsApiKeyDraft] = useState(elevenLabsApiKey);

  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const generatedAudioRecords = useMemo(
    () =>
      voiceovers
        .map((record) => ({
          record,
          asset: assetsById.get(record.assetId),
        }))
        .filter((entry): entry is { record: ProjectVoiceoverRecord; asset: ProjectAssetRecord } => Boolean(entry.asset)),
    [assetsById, voiceovers]
  );

  useEffect(() => {
    if (lastProjectIdRef.current === project.id) {
      return;
    }
    lastProjectIdRef.current = project.id;
    setDraft(persistedDraft);
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
  }, [persistedDraft.model, persistedDraft.outputFormat, persistedDraft.provider, persistedDraft.sourceFilename, persistedDraft.text, persistedDraft.voiceId]);

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
        toast.error(error instanceof Error ? error.message : "Could not save voiceover draft");
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
      const text = extractVoiceoverTextFromFileContents(file.name, await file.text());
      setDraft((current) => ({
        ...current,
        text,
        sourceFilename: file.name,
      }));
      toast.success(`Loaded ${file.name}`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Could not read the script file");
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) {
      toast.error("Add script text and model before generating.");
      return;
    }
    if (!hasAvailableApiKey) {
      toast.error("Add your ElevenLabs API key or set it in .env first.");
      return;
    }

    const request: VoiceoverGenerateRequest = {
      projectId: project.id,
      scriptText: draft.text,
      provider: draft.provider,
      model: draft.model,
      voiceId: draft.voiceId,
      outputFormat: draft.outputFormat,
    };

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
        createdAt: now,
      });

      await saveGeneratedVoiceover({
        asset,
        voiceover,
      });

      toast.success(`Audio generated with ${result.meta.provider}`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Voiceover generation failed");
    }
  };

  const handleRenameAsset = async (asset: ProjectAssetRecord) => {
    const nextName = window.prompt("Rename audio", asset.filename)?.trim();
    if (!nextName || nextName === asset.filename) return;
    await renameAsset(asset.id, nextName);
    toast.success("Audio renamed");
  };

  const handleUseInTimeline = async (asset: ProjectAssetRecord) => {
    const now = Date.now();
    const audioItem = createDefaultAudioTrack({
      assetId: asset.id,
      durationSeconds: asset.durationSeconds,
    });
    await saveProject({
      ...project,
      timeline: {
        ...project.timeline,
        audioItems: appendTimelineAudioItem(project.timeline.audioItems, audioItem),
      },
      updatedAt: now,
      lastOpenedAt: now,
    });
    toast.success("Audio added to the timeline");
  };

  return (
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
                <CardTitle className="text-2xl font-semibold tracking-tight">Script to Audio</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-50">{draft.provider}</Badge>
                <Badge variant="outline" className="border-white/15 bg-white/5 text-white/75">
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
                      outputFormat: value as ProjectVoiceoverDraft["outputFormat"],
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
                  <Badge variant="outline" className="border-white/15 bg-white/5 text-white/70">
                    {draft.sourceFilename}
                  </Badge>
                ) : null}
              </div>
              <Button
                className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                onClick={() => void handleGenerate()}
                disabled={!canGenerate || isGeneratingVoiceover}
              >
                {isGeneratingVoiceover ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
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
            <Badge variant="outline" className="border-white/15 bg-white/5 text-white/70">
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
                  className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-white">{asset.filename}</div>
                        <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-50">{record.provider}</Badge>
                        <Badge variant="outline" className="border-white/15 bg-white/5 text-white/70">
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

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                        onClick={() => asset.fileBlob && triggerFileDownload(asset.fileBlob, asset.filename)}
                        disabled={!asset.fileBlob}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                        onClick={() => void handleRenameAsset(asset)}
                      >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Rename
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl border-cyan-300/20 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/15"
                        onClick={() => void handleUseInTimeline(asset)}
                      >
                        <AudioLines className="mr-2 h-4 w-4" />
                        Use in Timeline
                      </Button>
                    </div>
                  </div>
                  {record.sourceFilename ? (
                    <div className="mt-3 text-xs text-white/38">{record.sourceFilename}</div>
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
                onChange={(event) => setElevenLabsApiKeyDraft(event.target.value)}
                placeholder="Paste your ElevenLabs API key"
                type="password"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={handleApiKeySave}>
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
                  : "border-white/10 bg-black/20 text-white/50"
              )}
            >
              {hasElevenLabsApiKey ? maskedElevenLabsApiKey : config.hasApiKey ? config.maskedApiKey : "No key detected"}
            </div>

            {hasElevenLabsApiKey && config.hasApiKey ? (
              <div className="text-xs text-white/45">Local key overrides `.env`</div>
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
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Draft</div>
              <div className="mt-2 text-2xl font-semibold text-white">{draft.text.trim().split(/\s+/).filter(Boolean).length}</div>
              <div className="text-sm text-white/45">words</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Generated</div>
              <div className="mt-2 text-2xl font-semibold text-white">{generatedAudioRecords.length}</div>
              <div className="text-sm text-white/45">audio assets</div>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Timeline</div>
              <div className="mt-2 text-2xl font-semibold text-white">{project.timeline.audioItems.length}</div>
              <div className="text-sm text-white/45">audio items</div>
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
