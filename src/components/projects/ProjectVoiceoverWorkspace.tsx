"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleHelp,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  DEFAULT_GEMINI_TTS_VOICE,
  DEFAULT_OPENAI_TTS_SPEED,
  DEFAULT_OPENAI_TTS_VOICE,
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

type GeminiAdvancedControlKey =
  keyof NonNullable<ProjectVoiceoverDraft["generationConfig"]>;

const GEMINI_ADVANCED_CONTROL_HELP: Record<
  Exclude<GeminiAdvancedControlKey, "stopSequences">,
  {
    label: string;
    placeholder: string;
    min?: string;
    max?: string;
    step: string;
    purpose: string;
    lower: string;
    higher: string;
    caution: string;
  }
> = {
  temperature: {
    label: "Temperature",
    placeholder: "0-2",
    min: "0",
    max: "2",
    step: "0.1",
    purpose: "Controls how adventurous the speech generation can be.",
    lower: "Lower values usually sound more stable and literal.",
    higher: "Higher values can add variation, but may drift in delivery.",
    caution: "Too high can make timing, tone, or pronunciation less predictable.",
  },
  topP: {
    label: "Top P",
    placeholder: "0-1",
    min: "0",
    max: "1",
    step: "0.05",
    purpose: "Limits generation to the most likely slice of possible outputs.",
    lower: "Lower values narrow the delivery and can feel safer.",
    higher: "Higher values allow a wider range of expression.",
    caution: "Very low values can sound flat; very high values can vary more between runs.",
  },
  topK: {
    label: "Top K",
    placeholder: "1-100",
    min: "1",
    max: "100",
    step: "1",
    purpose: "Caps how many likely next choices Gemini can consider.",
    lower: "Lower values make the result tighter and more conservative.",
    higher: "Higher values give Gemini more room for alternate phrasing/delivery.",
    caution: "Large values can add variety without guaranteeing better audio.",
  },
  seed: {
    label: "Seed",
    placeholder: "Optional",
    step: "1",
    purpose: "Gives Gemini a repeatability hint for similar requests.",
    lower: "The number itself has no quality direction.",
    higher: "Different numbers can produce different takes.",
    caution: "Preview models may still vary, so treat seed as a hint, not a lock.",
  },
  candidateCount: {
    label: "Candidates",
    placeholder: "1-4",
    min: "1",
    max: "4",
    step: "1",
    purpose: "Requests how many candidate generations the API may produce.",
    lower: "One candidate is cheaper and simplest.",
    higher: "More candidates can increase work and cost, but this UI uses the first audio result.",
    caution: "For voiceover, keep this at 1 unless you are deliberately testing provider behavior.",
  },
  maxOutputTokens: {
    label: "Max output tokens",
    placeholder: "Optional",
    min: "1",
    max: "32768",
    step: "1",
    purpose: "Limits the maximum generated audio token budget.",
    lower: "Lower values can stop long audio early.",
    higher: "Higher values allow longer scripts to complete.",
    caution: "Set only when you need a hard ceiling; unnecessary limits can truncate narration.",
  },
};

const GEMINI_ADVANCED_CONTROL_ORDER = [
  "temperature",
  "topP",
  "topK",
  "seed",
  "candidateCount",
  "maxOutputTokens",
] as const;

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

function formatTokenSummary(input?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) {
  if (!input) return "n/d";
  const total = input.totalTokens ?? ((input.promptTokens ?? 0) + (input.completionTokens ?? 0));
  return total > 0 ? `${formatWholeNumber(total)} tokens` : "n/d";
}

function getProviderLabel(provider: ProjectVoiceoverDraft["provider"]) {
  if (provider === "gemini") return "Google Gemini";
  if (provider === "openai") return "OpenAI";
  return "ElevenLabs";
}

function getVoiceoverVoiceLabel(record: ProjectVoiceoverRecord) {
  if (record.provider === "gemini") {
    if (record.speakerMode === "multi" && record.speakers?.length) {
      return record.speakers.map((speaker) => `${speaker.speaker}: ${speaker.voiceName}`).join(" / ");
    }
    return record.voiceName || record.voiceId || DEFAULT_GEMINI_TTS_VOICE;
  }
  if (record.provider === "openai") {
    return record.voiceName || record.voiceId || DEFAULT_OPENAI_TTS_VOICE;
  }

  return maskVoiceoverSecret(record.voiceId);
}

function formatGeminiSettingValue(value: string | number | undefined, fallback = "Default") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function buildGeminiRunSettingItems(record: ProjectVoiceoverRecord): Array<{ label: string; value: string }> {
  if (record.provider !== "gemini") return [];
  const generationConfig = record.generationConfig ?? {};
  return [
    { label: "Voice", value: getVoiceoverVoiceLabel(record) },
    { label: "Language", value: record.languageCode || "Auto" },
    { label: "Speaker mode", value: record.speakerMode === "multi" ? "Two speakers" : "Single" },
    { label: "Director notes", value: record.stylePrompt?.trim() ? "Yes" : "No" },
    { label: "Temperature", value: formatGeminiSettingValue(generationConfig.temperature) },
    { label: "Top P", value: formatGeminiSettingValue(generationConfig.topP) },
    { label: "Top K", value: formatGeminiSettingValue(generationConfig.topK) },
    { label: "Seed", value: formatGeminiSettingValue(generationConfig.seed, "None") },
    { label: "Candidates", value: formatGeminiSettingValue(generationConfig.candidateCount, "Default") },
    { label: "Max tokens", value: formatGeminiSettingValue(generationConfig.maxOutputTokens, "Default") },
    {
      label: "Stops",
      value: generationConfig.stopSequences?.length ? generationConfig.stopSequences.join(", ") : "None",
    },
  ];
}

function buildOpenAIRunSettingItems(record: ProjectVoiceoverRecord): Array<{ label: string; value: string }> {
  if (record.provider !== "openai") return [];
  return [
    { label: "Voice", value: getVoiceoverVoiceLabel(record) },
    { label: "Speed", value: formatGeminiSettingValue(record.speed, String(DEFAULT_OPENAI_TTS_SPEED)) },
  ];
}

function GeminiAdvancedTooltip({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
          aria-label={`${title} help`}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[380px] border border-white/10 bg-slate-950 px-4 py-3.5 text-left text-sm leading-6 text-white shadow-2xl">
        <div className="font-semibold text-cyan-100">{title}</div>
        <div className="mt-2.5 space-y-2.5 text-white/82">{children}</div>
      </TooltipContent>
    </Tooltip>
  );
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
    openAIApiKey,
    geminiApiKey,
    hasElevenLabsApiKey,
    hasOpenAIApiKey,
    hasGeminiApiKey,
    maskedElevenLabsApiKey,
    maskedOpenAIApiKey,
    maskedGeminiApiKey,
    saveElevenLabsApiKey,
    saveOpenAIApiKey,
    saveGeminiApiKey,
    clearElevenLabsApiKey,
    clearOpenAIApiKey,
    clearGeminiApiKey,
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
  const [openAIApiKeyDraft, setOpenAIApiKeyDraft] = useState(openAIApiKey);
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState(geminiApiKey);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [selectedVoiceoverId, setSelectedVoiceoverId] = useState<string | null>(
    null,
  );

  const assetsById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const draftUsage = useMemo(
    () => {
      if (draft.provider === "gemini" || draft.provider === "openai") {
        return {
          billedCharacters: draft.text.length,
          source: "estimated" as const,
          estimatedCostUsd: null,
          estimatedCostSource: "unavailable" as const,
          estimatedCreditsMin: 0,
          estimatedCreditsMax: 0,
        };
      }
      return estimateVoiceoverUsage({
        model: draft.model,
        scriptText: draft.text,
      });
    },
    [draft.model, draft.provider, draft.text],
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
  const providerConfig = config.providers[draft.provider] ?? config.providers.elevenlabs;
  const modelOptions = providerConfig?.models?.length ? providerConfig.models : config.models;
  const geminiConfig = config.providers.gemini;
  const openAIConfig = config.providers.openai;
  const elevenLabsConfig = config.providers.elevenlabs;
  const isGeminiProvider = draft.provider === "gemini";
  const isOpenAIProvider = draft.provider === "openai";
  const hasElevenLabsAvailableApiKey = hasElevenLabsApiKey || Boolean(elevenLabsConfig?.hasApiKey ?? config.hasApiKey);
  const hasGeminiAvailableApiKey = hasGeminiApiKey || Boolean(geminiConfig?.hasApiKey);
  const hasOpenAIAvailableApiKey = hasOpenAIApiKey || Boolean(openAIConfig?.hasApiKey);
  const hasCurrentProviderLocalApiKey = isGeminiProvider ? hasGeminiApiKey : isOpenAIProvider ? hasOpenAIApiKey : hasElevenLabsApiKey;
  const hasCurrentProviderEnvApiKey = isGeminiProvider
    ? Boolean(geminiConfig?.hasApiKey)
    : isOpenAIProvider
      ? Boolean(openAIConfig?.hasApiKey)
      : Boolean(elevenLabsConfig?.hasApiKey ?? config.hasApiKey);
  const currentApiKeySource = resolveCurrentApiKeySource(hasCurrentProviderLocalApiKey, hasCurrentProviderEnvApiKey);
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
            hasLocalApiKey: selectedVoiceover.provider === "gemini" ? hasGeminiApiKey : selectedVoiceover.provider === "openai" ? hasOpenAIApiKey : hasElevenLabsApiKey,
          })
        : null,
    [hasElevenLabsApiKey, hasGeminiApiKey, hasOpenAIApiKey, selectedVoiceover],
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
    setOpenAIApiKeyDraft(openAIApiKey);
  }, [openAIApiKey]);

  useEffect(() => {
    setGeminiApiKeyDraft(geminiApiKey);
  }, [geminiApiKey]);

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
  const hasAvailableApiKey = hasCurrentProviderLocalApiKey || hasCurrentProviderEnvApiKey;

  const handleApiKeySave = () => {
    const trimmed = elevenLabsApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste an ElevenLabs API key first.");
      return;
    }
    saveElevenLabsApiKey(trimmed);
    toast.success("ElevenLabs key saved");
  };

  const handleOpenAIApiKeySave = () => {
    const trimmed = openAIApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste an OpenAI API key first.");
      return;
    }
    saveOpenAIApiKey(trimmed);
    toast.success("OpenAI key saved");
  };

  const handleGeminiApiKeySave = () => {
    const trimmed = geminiApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste a Gemini API key first.");
      return;
    }
    saveGeminiApiKey(trimmed);
    toast.success("Gemini key saved");
  };

  const updateGeminiGenerationConfig = (
    key: keyof NonNullable<ProjectVoiceoverDraft["generationConfig"]>,
    value: string,
  ) => {
    setDraft((current) => {
      const nextConfig = {
        ...(current.generationConfig ?? {}),
      };
      if (key === "stopSequences") {
        const stopSequences = value
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 5);
        if (stopSequences.length) {
          nextConfig.stopSequences = stopSequences;
        } else {
          delete nextConfig.stopSequences;
        }
      } else if (value.trim()) {
        nextConfig[key] = Number(value) as never;
      } else {
        delete nextConfig[key];
      }
      return {
        ...current,
        generationConfig: Object.keys(nextConfig).length ? nextConfig : undefined,
      };
    });
  };

  const updateGeminiSpeaker = (
    index: number,
    patch: Partial<NonNullable<ProjectVoiceoverDraft["speakers"]>[number]>,
  ) => {
    setDraft((current) => {
      const speakers = [...(current.speakers ?? [])];
      const fallback = index === 0 ? { speaker: "Speaker1", voiceName: current.voiceName || DEFAULT_GEMINI_TTS_VOICE } : { speaker: "Speaker2", voiceName: "Puck" };
      speakers[index] = {
        ...fallback,
        ...speakers[index],
        ...patch,
      };
      return {
        ...current,
        speakers,
      };
    });
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
    if (draft.provider === "elevenlabs" && !draft.voiceId.trim()) {
      toast.error("Paste an ElevenLabs voice ID before generating.");
      return null;
    }
    if (!hasAvailableApiKey) {
      toast.error(`Add your ${getProviderLabel(draft.provider)} API key or set it in .env first.`);
      return null;
    }
    if (draft.provider === "gemini" && draft.speakerMode === "multi") {
      const speakers = draft.speakers ?? [];
      if (speakers.length !== 2 || speakers.some((speaker) => !speaker.speaker.trim() || !speaker.voiceName.trim())) {
        toast.error("Gemini multi-speaker mode needs two speaker names and voices.");
        return null;
      }
    }

    return {
      projectId: project.id,
      scriptText: draft.text,
      provider: draft.provider,
      model: draft.model,
      voiceId: draft.provider === "gemini" ? draft.voiceName || DEFAULT_GEMINI_TTS_VOICE : draft.provider === "openai" ? draft.voiceName || DEFAULT_OPENAI_TTS_VOICE : draft.voiceId,
      voiceName:
        draft.provider === "gemini"
          ? draft.voiceName || DEFAULT_GEMINI_TTS_VOICE
          : draft.provider === "openai"
            ? draft.voiceName || DEFAULT_OPENAI_TTS_VOICE
            : undefined,
      languageCode: draft.provider === "gemini" ? draft.languageCode : undefined,
      speakerMode: draft.provider === "gemini" ? draft.speakerMode ?? "single" : undefined,
      speakers: draft.provider === "gemini" && draft.speakerMode === "multi" ? draft.speakers : undefined,
      stylePrompt: draft.provider === "gemini" ? draft.stylePrompt : undefined,
      generationConfig: draft.provider === "gemini" ? draft.generationConfig : undefined,
      speed: draft.provider === "openai" ? draft.speed ?? DEFAULT_OPENAI_TTS_SPEED : undefined,
      outputFormat: draft.outputFormat,
    };
  };

  const handleGenerate = async (request: VoiceoverGenerateRequest) => {
    try {
      await saveVoiceoverDraft(draft);
      const result = await generateVoiceover(request, {
        elevenLabsApiKey: hasElevenLabsApiKey ? elevenLabsApiKey : undefined,
        openAIApiKey: hasOpenAIApiKey ? openAIApiKey : undefined,
        geminiApiKey: hasGeminiApiKey ? geminiApiKey : undefined,
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
          voiceName: result.meta.voiceName,
          languageCode: result.meta.languageCode,
          speakerMode: result.meta.speakerMode,
          speakers: result.meta.speakers ?? request.speakers,
          stylePrompt: request.stylePrompt,
          generationConfig: request.generationConfig,
          speed: result.meta.speed ?? request.speed,
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
                    {getProviderLabel(draft.provider)}
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
                      setDraft((current) => {
                        const provider = value as ProjectVoiceoverDraft["provider"];
                        const nextConfig = config.providers[provider];
                        const nextModel = nextConfig?.defaultModel || current.model;
                        return {
                          ...current,
                          provider,
                          model: nextModel,
                          voiceName:
                            provider === "gemini"
                              ? current.voiceName || nextConfig?.defaultVoiceName || DEFAULT_GEMINI_TTS_VOICE
                              : provider === "openai"
                                ? current.voiceName || nextConfig?.defaultVoiceName || DEFAULT_OPENAI_TTS_VOICE
                                : current.voiceName,
                          speakerMode: provider === "gemini" ? current.speakerMode ?? "single" : current.speakerMode,
                          speed: provider === "openai" ? current.speed ?? DEFAULT_OPENAI_TTS_SPEED : current.speed,
                          speakers:
                            provider === "gemini"
                              ? current.speakers ?? [
                                  { speaker: "Speaker1", voiceName: current.voiceName || DEFAULT_GEMINI_TTS_VOICE },
                                  { speaker: "Speaker2", voiceName: "Puck" },
                                ]
                              : current.speakers,
                        };
                      })
                    }
                  >
                    <SelectTrigger id="voiceover-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="gemini">Google Gemini</SelectItem>
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
                      {modelOptions.map((model) => (
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
                {isGeminiProvider ? (
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="voiceover-gemini-voice" className="text-white/80">
                        Voice
                      </Label>
                      <Select
                        value={draft.voiceName || DEFAULT_GEMINI_TTS_VOICE}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            voiceName: value,
                          }))
                        }
                        disabled={draft.speakerMode === "multi"}
                      >
                        <SelectTrigger id="voiceover-gemini-voice">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(geminiConfig?.voices ?? []).map((voice) => (
                            <SelectItem key={voice.value} value={voice.value}>
                              {voice.label}{voice.tone ? ` - ${voice.tone}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voiceover-gemini-language" className="text-white/80">
                        Language
                      </Label>
                      <Select
                        value={draft.languageCode || "auto"}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            languageCode: value === "auto" ? undefined : value,
                          }))
                        }
                      >
                        <SelectTrigger id="voiceover-gemini-language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          {(geminiConfig?.languages ?? []).map((language) => (
                            <SelectItem key={language.value} value={language.value}>
                              {language.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voiceover-gemini-speaker-mode" className="text-white/80">
                        Speakers
                      </Label>
                      <Select
                        value={draft.speakerMode ?? "single"}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            speakerMode: value === "multi" ? "multi" : "single",
                          }))
                        }
                      >
                        <SelectTrigger id="voiceover-gemini-speaker-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">Single</SelectItem>
                          <SelectItem value="multi">Two speakers</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : isOpenAIProvider ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="voiceover-openai-voice" className="text-white/80">
                        Voice
                      </Label>
                      <Select
                        value={draft.voiceName || DEFAULT_OPENAI_TTS_VOICE}
                        onValueChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            voiceName: value,
                          }))
                        }
                      >
                        <SelectTrigger id="voiceover-openai-voice">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(openAIConfig?.voices ?? []).map((voice) => (
                            <SelectItem key={voice.value} value={voice.value}>
                              {voice.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voiceover-openai-speed" className="text-white/80">
                        Speed
                      </Label>
                      <Input
                        id="voiceover-openai-speed"
                        type="number"
                        min="0.25"
                        max="4"
                        step="0.05"
                        value={String(draft.speed ?? DEFAULT_OPENAI_TTS_SPEED)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            speed: event.target.value.trim() ? Number(event.target.value) : undefined,
                          }))
                        }
                        placeholder="1.0"
                      />
                    </div>
                  </div>
                ) : (
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
                )}
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

              {isGeminiProvider && draft.speakerMode === "multi" ? (
                <div className="grid gap-3 rounded-[1.4rem] border border-white/10 bg-black/20 p-4 lg:grid-cols-2">
                  {[0, 1].map((index) => {
                    const speaker = draft.speakers?.[index] ?? {
                      speaker: index === 0 ? "Speaker1" : "Speaker2",
                      voiceName: index === 0 ? draft.voiceName || DEFAULT_GEMINI_TTS_VOICE : "Puck",
                    };
                    return (
                      <div key={index} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <Input
                          value={speaker.speaker}
                          onChange={(event) => updateGeminiSpeaker(index, { speaker: event.target.value })}
                          placeholder={`Speaker ${index + 1}`}
                        />
                        <Select
                          value={speaker.voiceName}
                          onValueChange={(value) => updateGeminiSpeaker(index, { voiceName: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(geminiConfig?.voices ?? []).map((voice) => (
                              <SelectItem key={voice.value} value={voice.value}>
                                {voice.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {isGeminiProvider ? (
                <div className="space-y-2">
                  <Label htmlFor="voiceover-gemini-style" className="text-white/80">
                    Director notes
                  </Label>
                  <Textarea
                    id="voiceover-gemini-style"
                    value={draft.stylePrompt ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        stylePrompt: event.target.value,
                      }))
                    }
                    className="min-h-[96px] rounded-[1.2rem] border-white/10 bg-black/25 px-4 py-3 text-sm leading-6"
                    placeholder="Style, accent, pacing, mood, scene context"
                  />
                </div>
              ) : null}

              {isGeminiProvider ? (
                <details className="rounded-[1.4rem] border border-white/10 bg-black/20 p-4">
                  <summary className="cursor-pointer text-sm font-medium text-white/78">Advanced Gemini controls</summary>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {GEMINI_ADVANCED_CONTROL_ORDER.map((key) => {
                      const control = GEMINI_ADVANCED_CONTROL_HELP[key];
                      return (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={`voiceover-gemini-${key}`} className="text-white/70">
                            {control.label}
                          </Label>
                          <GeminiAdvancedTooltip title={control.label}>
                            <p>{control.purpose}</p>
                            <p>
                              <span className="text-cyan-100">Lower:</span> {control.lower}
                            </p>
                            <p>
                              <span className="text-cyan-100">Higher:</span> {control.higher}
                            </p>
                            <p>
                              <span className="text-amber-100">Watch out:</span> {control.caution}
                            </p>
                          </GeminiAdvancedTooltip>
                        </div>
                        <Input
                          id={`voiceover-gemini-${key}`}
                          type="number"
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={String(draft.generationConfig?.[key as keyof NonNullable<ProjectVoiceoverDraft["generationConfig"]>] ?? "")}
                          onChange={(event) =>
                            updateGeminiGenerationConfig(
                              key as keyof NonNullable<ProjectVoiceoverDraft["generationConfig"]>,
                              event.target.value,
                            )
                          }
                          placeholder={control.placeholder}
                        />
                      </div>
                    );
                    })}
                    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                      <div className="flex items-center gap-1.5">
                        <Label htmlFor="voiceover-gemini-stop-sequences" className="text-white/70">
                          Stop sequences
                        </Label>
                        <GeminiAdvancedTooltip title="Stop sequences">
                          <p>Stops generation when Gemini reaches one of these exact strings.</p>
                          <p>
                            <span className="text-cyan-100">Fewer:</span> safer for narration; the script is less likely to stop early.
                          </p>
                          <p>
                            <span className="text-cyan-100">More:</span> useful for hard boundaries in templated scripts.
                          </p>
                          <p>
                            <span className="text-amber-100">Watch out:</span> a stop string that appears in the narration can truncate the audio.
                          </p>
                        </GeminiAdvancedTooltip>
                      </div>
                      <Textarea
                        id="voiceover-gemini-stop-sequences"
                        value={draft.generationConfig?.stopSequences?.join("\n") ?? ""}
                        onChange={(event) => updateGeminiGenerationConfig("stopSequences", event.target.value)}
                        className="min-h-[88px] rounded-[1.2rem] border-white/10 bg-black/25 px-4 py-3 text-sm"
                        placeholder="One per line, max 5"
                      />
                    </div>
                  </div>
                </details>
              ) : null}

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
                  {!isGeminiProvider && !isOpenAIProvider ? (
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
                  ) : null}
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
                            {getProviderLabel(record.provider)}
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
                          <span>{getVoiceoverVoiceLabel(record)}</span>
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
                            {record.provider === "gemini"
                              ? formatTokenSummary(record.usage)
                              : formatUsageMetric(
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
                      {record.provider === "gemini" || record.provider === "openai" ? (
                        <div className="rounded-[1.2rem] border border-white/10 bg-black/25 p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.18em] text-white/55">
                            Run settings
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {(record.provider === "gemini" ? buildGeminiRunSettingItems(record) : buildOpenAIRunSettingItems(record)).map((item) => (
                              <div
                                key={item.label}
                                className="min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm"
                              >
                                <div className="text-xs text-white/45">{item.label}</div>
                                <div className="mt-0.5 truncate font-medium text-white/82">{item.value}</div>
                              </div>
                            ))}
                          </div>
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
                  hasElevenLabsAvailableApiKey
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-black/20 text-white/50",
                )}
              >
                {hasElevenLabsApiKey
                  ? maskedElevenLabsApiKey
                  : (elevenLabsConfig?.hasApiKey ?? config.hasApiKey)
                    ? elevenLabsConfig?.maskedApiKey || config.maskedApiKey
                    : "No key detected"}
              </div>

              {hasElevenLabsApiKey && (elevenLabsConfig?.hasApiKey ?? config.hasApiKey) ? (
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

          <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(7,13,23,0.92),rgba(7,13,23,0.74))] text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-cyan-300" />
                OpenAI
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai-api-key" className="text-white/80">
                  API Key
                </Label>
                <Input
                  id="openai-api-key"
                  value={openAIApiKeyDraft}
                  onChange={(event) => setOpenAIApiKeyDraft(event.target.value)}
                  placeholder="Paste your OpenAI API key"
                  type="password"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                  onClick={handleOpenAIApiKeySave}
                >
                  Save Key
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => {
                    clearOpenAIApiKey();
                    toast.success("OpenAI key cleared");
                  }}
                  disabled={!hasOpenAIApiKey}
                >
                  Clear
                </Button>
              </div>

              <div
                className={cn(
                  "rounded-[1.4rem] border px-4 py-3 text-sm",
                  hasOpenAIAvailableApiKey
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-black/20 text-white/50",
                )}
              >
                {hasOpenAIApiKey
                  ? maskedOpenAIApiKey
                  : openAIConfig?.hasApiKey
                    ? openAIConfig.maskedApiKey
                    : "No key detected"}
              </div>

              {hasOpenAIApiKey && openAIConfig?.hasApiKey ? (
                <div className="text-xs text-white/45">
                  Local key overrides `.env`
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-[linear-gradient(180deg,rgba(7,13,23,0.92),rgba(7,13,23,0.74))] text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-cyan-300" />
                Google Gemini
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gemini-api-key" className="text-white/80">
                  API Key
                </Label>
                <Input
                  id="gemini-api-key"
                  value={geminiApiKeyDraft}
                  onChange={(event) => setGeminiApiKeyDraft(event.target.value)}
                  placeholder="Paste your Gemini API key"
                  type="password"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                  onClick={handleGeminiApiKeySave}
                >
                  Save Key
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => {
                    clearGeminiApiKey();
                    toast.success("Gemini key cleared");
                  }}
                  disabled={!hasGeminiApiKey}
                >
                  Clear
                </Button>
              </div>

              <div
                className={cn(
                  "rounded-[1.4rem] border px-4 py-3 text-sm",
                  hasGeminiAvailableApiKey
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-50"
                    : "border-white/10 bg-black/20 text-white/50",
                )}
              >
                {hasGeminiApiKey
                  ? maskedGeminiApiKey
                  : geminiConfig?.hasApiKey
                    ? geminiConfig.maskedApiKey
                    : "No key detected"}
              </div>

              {hasGeminiApiKey && geminiConfig?.hasApiKey ? (
                <div className="text-xs text-white/45">
                  Local key overrides `.env`
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
                { label: "Provider", value: getProviderLabel(draft.provider) },
                { label: "Model", value: draft.model },
                {
                  label: isGeminiProvider || isOpenAIProvider ? "Voice" : "Voice ID",
                  value: isGeminiProvider
                    ? draft.speakerMode === "multi"
                      ? (draft.speakers ?? [])
                          .map((speaker) => `${speaker.speaker}: ${speaker.voiceName}`)
                          .join(" / ") || "Missing"
                      : draft.voiceName || DEFAULT_GEMINI_TTS_VOICE
                    : isOpenAIProvider
                      ? draft.voiceName || DEFAULT_OPENAI_TTS_VOICE
                    : maskVoiceoverSecret(draft.voiceId) || "Missing",
                },
                ...(isGeminiProvider
                  ? [
                      {
                        label: "Language",
                        value: draft.languageCode || "Auto",
                      },
                    ]
                  : []),
                ...(isOpenAIProvider
                  ? [
                      {
                        label: "Speed",
                        value: String(draft.speed ?? DEFAULT_OPENAI_TTS_SPEED),
                      },
                    ]
                  : []),
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
                    {isGeminiProvider ? "Tokens" : "Estimate"}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {isGeminiProvider
                      ? "n/d"
                      : formatCredits(
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
