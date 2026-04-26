"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  RefreshCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useCreatorImageFeatureConfig } from "@/hooks/useCreatorImageFeatureConfig";
import { useCreatorImageGenerator } from "@/hooks/useCreatorImageGenerator";
import { useCreatorLlmRuns } from "@/hooks/useCreatorLlmRuns";
import { getCreatorProviderLabel } from "@/lib/creator/ai";
import {
  IMAGE_PROMPT_SLOT_DEFAULTS,
  IMAGE_PROMPT_SLOT_ORDER,
  createEmptyImagePromptProfile,
  createEmptyPromptSlotOverride,
  createImagePromptCustomizationSnapshot,
  hasCustomizedImagePromptProfile,
  resolveImagePromptSlotLine,
  sanitizeImagePromptProfile,
  selectImagePromptCustomizationSnapshot,
  type VideoInfoPromptEditorMode,
} from "@/lib/creator/prompt-customization";
import { buildCreatorImagePrompt } from "@/lib/server/creator/images/prompt";
import { buildCreatorTextProviderHeaders } from "@/lib/creator/user-ai-settings";
import {
  buildProjectImageRecord,
  removeProjectImageRecord,
  resolveProjectImageHistory,
} from "@/lib/creator/image-storage";
import { createProjectImageAssetFromFile } from "@/lib/projects/source-assets";
import type {
  ContentProjectRecord,
  ProjectAssetRecord,
} from "@/lib/projects/types";
import type {
  CreatorImageAspectRatio,
  CreatorImageFormat,
  CreatorImageGenerateRequest,
  CreatorImagePromptProfile,
  CreatorImagePromptSlot,
  CreatorImageQuality,
  CreatorLLMProvider,
  CreatorPromptSlotOverrideMode,
} from "@/lib/creator/types";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const IMAGE_PROMPT_SLOT_LABELS: Record<CreatorImagePromptSlot, string> = {
  persona: "Persona",
  style: "Style guardrails",
};

const ASPECT_RATIOS: CreatorImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:5", "3:4"];
const QUALITIES: CreatorImageQuality[] = ["auto", "low", "medium", "high"];
const FORMATS: CreatorImageFormat[] = ["png", "jpeg", "webp"];

function cloneImagePromptProfile(profile: CreatorImagePromptProfile | undefined): CreatorImagePromptProfile {
  return sanitizeImagePromptProfile(profile) ?? createEmptyImagePromptProfile();
}

function updatePromptProfileSlot(
  profile: CreatorImagePromptProfile,
  slot: CreatorImagePromptSlot,
  update: Partial<{ mode: CreatorPromptSlotOverrideMode; value: string }>
): CreatorImagePromptProfile {
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
  profile: CreatorImagePromptProfile,
  value: string
): CreatorImagePromptProfile {
  return {
    ...profile,
    globalInstructions: value.trim() ? value : undefined,
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
    <div className="mt-3 rounded-2xl border border-emerald-300/15 bg-emerald-400/5 p-3">
      <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/70">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-emerald-50/90">
        {value?.trim() ? value : emptyCopy}
      </div>
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
          {defaultValue ? <div className="mt-1 text-xs leading-relaxed text-zinc-500">{defaultValue}</div> : null}
        </div>
        <Select value={override.mode} onValueChange={(value) => onModeChange(value as CreatorPromptSlotOverrideMode)}>
          <SelectTrigger className="w-[160px] border-white/10 bg-black/30 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-white/10 bg-zinc-950 text-white">
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

function formatRelativeDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function getCreatorProviderEnvKey(provider: CreatorLLMProvider): string {
  return provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
}

function getCreatorProviderKeyPlaceholder(provider: CreatorLLMProvider): string {
  return provider === "gemini" ? "AIza..." : "sk-proj-...";
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
}

function base64ToFile(base64: string, filename: string, mimeType: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename, { type: mimeType });
}

function withObjectUrl(file: File | Blob, action: (url: string) => void) {
  const url = URL.createObjectURL(file);
  action(url);
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function openFile(file: File) {
  withObjectUrl(file, (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function downloadFile(file: File, filename = file.name) {
  withObjectUrl(file, (url) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  });
}

function AssetImagePreview({ file, alt }: { file?: File; alt: string }) {
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!file || !imageRef.current) return;

    const url = URL.createObjectURL(file);
    imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/30 text-xs text-white/35">
        Preview unavailable
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      alt={alt}
      className="aspect-video w-full rounded-xl object-cover"
    />
  );
}

export function AiImagesHub({
  project,
  assets,
  saveProject,
  saveGeneratedImageAssets,
}: {
  project: ContentProjectRecord;
  assets: ProjectAssetRecord[];
  saveProject: (record: ContentProjectRecord) => Promise<void>;
  saveGeneratedImageAssets: (input: { assets: ProjectAssetRecord[]; imageRecord: ReturnType<typeof buildProjectImageRecord> }) => Promise<void>;
}) {
  const {
    openAIApiKey,
    geminiApiKey,
    hasOpenAIApiKey,
    hasGeminiApiKey,
    maskedOpenAIApiKey,
    maskedGeminiApiKey,
    imagesFeatureSettings,
    imagePromptProfile,
    saveOpenAIApiKey,
    saveGeminiApiKey,
    clearOpenAIApiKey,
    clearGeminiApiKey,
    saveFeatureModel,
    saveFeatureProvider,
    saveImagePromptProfile,
  } = useCreatorAiSettings();
  const creatorProviderHeaders = useMemo(
    () => buildCreatorTextProviderHeaders({ openAIApiKey, geminiApiKey }),
    [geminiApiKey, openAIApiKey]
  );
  const { config: imageConfig } = useCreatorImageFeatureConfig({
    headers: creatorProviderHeaders,
    provider: imagesFeatureSettings?.provider,
  });
  const { imageResult, setImageResult, isGeneratingImages, imageError, generateImages } =
    useCreatorImageGenerator();
  const { refresh: refreshLlmRuns } = useCreatorLlmRuns(project.id);

  const [openAIApiKeyDraft, setOpenAIApiKeyDraft] = useState("");
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState("");
  const [brief, setBrief] = useState("");
  const [aspectRatio, setAspectRatio] = useState<CreatorImageAspectRatio>("1:1");
  const [quality, setQuality] = useState<CreatorImageQuality>("auto");
  const [outputFormat, setOutputFormat] = useState<CreatorImageFormat>("png");
  const [count, setCount] = useState("1");
  const [promptEditorMode, setPromptEditorMode] = useState<VideoInfoPromptEditorMode>("global");
  const [globalPromptProfileDraft, setGlobalPromptProfileDraft] = useState<CreatorImagePromptProfile>(
    createEmptyImagePromptProfile()
  );
  const [runPromptProfileDraft, setRunPromptProfileDraft] = useState<CreatorImagePromptProfile>(
    createEmptyImagePromptProfile()
  );

  useEffect(() => {
    setOpenAIApiKeyDraft(openAIApiKey);
    setGeminiApiKeyDraft(geminiApiKey);
  }, [geminiApiKey, openAIApiKey]);

  useEffect(() => {
    setGlobalPromptProfileDraft(cloneImagePromptProfile(imagePromptProfile));
  }, [imagePromptProfile]);

  const resolvedProvider = imagesFeatureSettings?.provider ?? imageConfig?.provider ?? "openai";
  const resolvedModel = useMemo(() => {
    const savedModel = imagesFeatureSettings?.model;
    if (savedModel && imageConfig?.models.some((option) => option.value === savedModel)) {
      return savedModel;
    }
    return imageConfig?.defaultModel ?? savedModel ?? "";
  }, [imageConfig?.defaultModel, imageConfig?.models, imagesFeatureSettings?.model]);

  useEffect(() => {
    if (!imageConfig?.defaultModel) return;
    if (imagesFeatureSettings?.provider !== imageConfig.provider) return;
    const savedModel = imagesFeatureSettings?.model;
    if (savedModel && imageConfig.models.some((option) => option.value === savedModel)) return;
    saveFeatureModel("images", imageConfig.defaultModel, imageConfig.provider);
  }, [
    imageConfig?.defaultModel,
    imageConfig?.models,
    imageConfig?.provider,
    imagesFeatureSettings?.model,
    imagesFeatureSettings?.provider,
    saveFeatureModel,
  ]);

  const activeApiKeyDraft = resolvedProvider === "gemini" ? geminiApiKeyDraft : openAIApiKeyDraft;
  const hasActiveApiKey = resolvedProvider === "gemini" ? hasGeminiApiKey : hasOpenAIApiKey;
  const maskedActiveApiKey = resolvedProvider === "gemini" ? maskedGeminiApiKey : maskedOpenAIApiKey;
  const resolvedApiKeySource =
    imageConfig?.provider === resolvedProvider && imageConfig.hasApiKey ? imageConfig.apiKeySource : undefined;
  const hasResolvedApiKey = Boolean(resolvedApiKeySource);
  const savedGlobalPromptProfile = useMemo(
    () => cloneImagePromptProfile(imagePromptProfile),
    [imagePromptProfile]
  );
  const hasGlobalDraftEdits = useMemo(
    () => hasCustomizedImagePromptProfile(globalPromptProfileDraft),
    [globalPromptProfileDraft]
  );
  const hasRunDraftEdits = useMemo(
    () => hasCustomizedImagePromptProfile(runPromptProfileDraft),
    [runPromptProfileDraft]
  );
  const globalPromptSnapshot = useMemo(
    () => createImagePromptCustomizationSnapshot({ globalProfile: globalPromptProfileDraft }),
    [globalPromptProfileDraft]
  );
  const runPromptSnapshot = useMemo(
    () =>
      createImagePromptCustomizationSnapshot({
        globalProfile: savedGlobalPromptProfile,
        runProfile: runPromptProfileDraft,
      }),
    [runPromptProfileDraft, savedGlobalPromptProfile]
  );
  const activePromptSnapshot = useMemo(
    () =>
      selectImagePromptCustomizationSnapshot(promptEditorMode, {
        globalSnapshot: globalPromptSnapshot,
        runSnapshot: runPromptSnapshot,
      }),
    [globalPromptSnapshot, promptEditorMode, runPromptSnapshot]
  );

  const buildImageRequest = useCallback(
    (promptCustomization = activePromptSnapshot): CreatorImageGenerateRequest => ({
      projectId: project.id,
      prompt: brief,
      aspectRatio,
      quality,
      outputFormat,
      count: Math.min(4, Math.max(1, Number.parseInt(count, 10) || 1)),
      generationConfig: {
        provider: resolvedProvider,
        model: resolvedModel || undefined,
      },
      promptCustomization,
    }),
    [activePromptSnapshot, aspectRatio, brief, count, outputFormat, project.id, quality, resolvedModel, resolvedProvider]
  );

  const promptPreview = useMemo(() => buildCreatorImagePrompt(buildImageRequest(activePromptSnapshot)), [
    activePromptSnapshot,
    buildImageRequest,
  ]);

  const imageHistory = useMemo(() => resolveProjectImageHistory(project), [project]);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const handleSaveActiveApiKey = useCallback(() => {
    const trimmed = activeApiKeyDraft.trim();
    if (!trimmed) {
      toast.error(`Paste a ${getCreatorProviderLabel(resolvedProvider)} API key first.`);
      return;
    }
    if (resolvedProvider === "gemini") {
      saveGeminiApiKey(trimmed);
    } else {
      saveOpenAIApiKey(trimmed);
    }
    toast.success(`${getCreatorProviderLabel(resolvedProvider)} key saved in this browser.`);
  }, [activeApiKeyDraft, resolvedProvider, saveGeminiApiKey, saveOpenAIApiKey]);

  const handleClearActiveApiKey = useCallback(() => {
    if (resolvedProvider === "gemini") {
      clearGeminiApiKey();
      setGeminiApiKeyDraft("");
    } else {
      clearOpenAIApiKey();
      setOpenAIApiKeyDraft("");
    }
    toast.success(`${getCreatorProviderLabel(resolvedProvider)} key removed from this browser.`);
  }, [clearGeminiApiKey, clearOpenAIApiKey, resolvedProvider]);

  const handleSaveGlobalPromptProfile = useCallback(() => {
    saveImagePromptProfile(hasGlobalDraftEdits ? globalPromptProfileDraft : undefined);
    toast.success(hasGlobalDraftEdits ? "Global image prompt defaults saved." : "Image prompt defaults restored.");
  }, [globalPromptProfileDraft, hasGlobalDraftEdits, saveImagePromptProfile]);

  const handleRestoreGlobalPromptProfile = useCallback(() => {
    setGlobalPromptProfileDraft(createEmptyImagePromptProfile());
    toast.success("Image prompt draft reset to defaults.");
  }, []);

  const handleClearRunPromptProfile = useCallback(() => {
    setRunPromptProfileDraft(createEmptyImagePromptProfile());
    toast.success("Run-only image prompt overrides cleared.");
  }, []);

  const handleGenerateImages = useCallback(
    async (promptCustomization = activePromptSnapshot) => {
      if (!brief.trim()) {
        toast.error("Add an image brief before generating.");
        return;
      }
      if (!hasResolvedApiKey) {
        toast.error(
          `Add your ${getCreatorProviderLabel(resolvedProvider)} API key or set ${getCreatorProviderEnvKey(resolvedProvider)} on the server.`
        );
        return;
      }

      const request = buildImageRequest(promptCustomization);
      try {
        const result = await generateImages(request, { headers: creatorProviderHeaders });
        const nextAssets = await Promise.all(
          result.images.map(async (image) => {
            const file = base64ToFile(image.base64, image.filename, image.mimeType);
            return createProjectImageAssetFromFile({ projectId: project.id, file, now: result.generatedAt });
          })
        );
        const record = buildProjectImageRecord({
          request,
          response: result,
          assetIds: nextAssets.map((asset) => asset.id),
        });
        await saveGeneratedImageAssets({ assets: nextAssets, imageRecord: record });
        setImageResult(result);
        if (promptCustomization?.mode === "run_override") {
          setRunPromptProfileDraft(createEmptyImagePromptProfile());
        }
        toast.success(`${result.images.length} image${result.images.length === 1 ? "" : "s"} generated`);
      } catch (error) {
        console.error(error);
      } finally {
        void refreshLlmRuns();
      }
    },
    [
      activePromptSnapshot,
      brief,
      buildImageRequest,
      creatorProviderHeaders,
      generateImages,
      hasResolvedApiKey,
      project.id,
      refreshLlmRuns,
      resolvedProvider,
      saveGeneratedImageAssets,
      setImageResult,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (recordId: string) => {
      const updated = removeProjectImageRecord(imageHistory, recordId);
      await saveProject({
        ...project,
        aiImageHistory: updated,
        updatedAt: Date.now(),
        lastOpenedAt: Date.now(),
      });
      toast.success("Image generation removed from history");
    },
    [imageHistory, project, saveProject]
  );

  const isGenerateDisabled = !brief.trim() || !hasResolvedApiKey || isGeneratingImages;
  const primaryGenerateLabel =
    promptEditorMode === "run" && hasRunDraftEdits ? "Generate with this run only" : "Generate images";
  const secondaryGenerateSnapshot = promptEditorMode === "run" ? globalPromptSnapshot : runPromptSnapshot;
  const secondaryGenerateLabel = promptEditorMode === "run" ? "Generate with saved globals" : "Generate with this run only";

  return (
    <div className="min-h-0 space-y-6 bg-transparent px-0 py-0">
      <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <CardHeader className="border-b border-white/6">
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-emerald-300" />
            AI Images
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Runtime</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className="border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
                    {getCreatorProviderLabel(resolvedProvider)}
                  </Badge>
                  <Badge className="border-white/15 bg-white/5 text-white">
                    {resolvedModel || "Model pending"}
                  </Badge>
                  <Badge
                    className={cn(
                      hasResolvedApiKey
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                        : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                    )}
                  >
                    {resolvedApiKeySource === "header"
                      ? `Saved ${maskedActiveApiKey}`
                      : resolvedApiKeySource === "env"
                        ? "Server env"
                        : "Missing"}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Provider</div>
                <Select
                  value={resolvedProvider}
                  onValueChange={(value) => saveFeatureProvider("images", value as CreatorLLMProvider)}
                  disabled={!imageConfig || imageConfig.allowedProviders.length === 0}
                >
                  <SelectTrigger className="border-white/10 bg-black/25 text-white">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-zinc-950 text-white">
                    {(imageConfig?.allowedProviders ?? [resolvedProvider]).map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {getCreatorProviderLabel(provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Model</div>
                <Select
                  value={resolvedModel}
                  onValueChange={(value) => saveFeatureModel("images", value, resolvedProvider)}
                  disabled={!imageConfig || imageConfig.models.length === 0}
                >
                  <SelectTrigger className="border-white/10 bg-black/25 text-white">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-zinc-950 text-white">
                    {(imageConfig?.models ?? []).map((option) => (
                      <SelectItem key={`${option.provider}:${option.value}`} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <Input
                value={activeApiKeyDraft}
                onChange={(event) => {
                  if (resolvedProvider === "gemini") {
                    setGeminiApiKeyDraft(event.target.value);
                    return;
                  }
                  setOpenAIApiKeyDraft(event.target.value);
                }}
                placeholder={`Paste the ${getCreatorProviderLabel(resolvedProvider)} key used for images (${getCreatorProviderKeyPlaceholder(resolvedProvider)})`}
                className="border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
              />
              <Button type="button" className="bg-white text-black hover:bg-zinc-200" onClick={handleSaveActiveApiKey}>
                <KeyRound className="mr-2 h-4 w-4" />
                Save key
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                onClick={handleClearActiveApiKey}
                disabled={!hasActiveApiKey}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4 rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
              <div className="text-sm font-semibold text-white">Image brief</div>
              <Textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Describe the image to generate"
                className="min-h-40 border-white/10 bg-black/25 text-white placeholder:text-zinc-500"
              />
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Frame</div>
                  <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as CreatorImageAspectRatio)}>
                    <SelectTrigger className="border-white/10 bg-black/25 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-zinc-950 text-white">
                      {ASPECT_RATIOS.map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Quality</div>
                  <Select value={quality} onValueChange={(value) => setQuality(value as CreatorImageQuality)}>
                    <SelectTrigger className="border-white/10 bg-black/25 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-zinc-950 text-white">
                      {QUALITIES.map((value) => (
                        <SelectItem key={value} value={value}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Format</div>
                  <Select value={outputFormat} onValueChange={(value) => setOutputFormat(value as CreatorImageFormat)}>
                    <SelectTrigger className="border-white/10 bg-black/25 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-zinc-950 text-white">
                      {FORMATS.map((value) => (
                        <SelectItem key={value} value={value}>{value.toUpperCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Count</div>
                  <Input
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                    inputMode="numeric"
                    className="border-white/10 bg-black/25 text-white"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
              <div className="text-sm font-semibold text-white">Effective prompt</div>
              <pre className="mt-4 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/25 p-4 text-xs leading-relaxed text-zinc-200">
                {promptPreview}
              </pre>
              <Button
                type="button"
                variant="ghost"
                className="mt-3 border border-white/10 bg-white/5 text-white hover:bg-white/10"
                onClick={() => void copyText(promptPreview, "Prompt")}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
            <div className="text-sm font-semibold text-white">Prompt customization</div>
            <Tabs value={promptEditorMode} onValueChange={(value) => setPromptEditorMode(value as VideoInfoPromptEditorMode)} className="mt-5">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="global">Global defaults</TabsTrigger>
                <TabsTrigger value="run">This run only</TabsTrigger>
              </TabsList>
              <TabsContent value="global" className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  {IMAGE_PROMPT_SLOT_ORDER.map((slot) => {
                    const override = globalPromptProfileDraft.slotOverrides?.[slot] ?? createEmptyPromptSlotOverride();
                    return (
                      <PromptSlotControl
                        key={slot}
                        label={IMAGE_PROMPT_SLOT_LABELS[slot]}
                        defaultValue={IMAGE_PROMPT_SLOT_DEFAULTS[slot]}
                        override={override}
                        effectiveValue={resolveImagePromptSlotLine(slot, globalPromptProfileDraft)}
                        onModeChange={(value) =>
                          setGlobalPromptProfileDraft((prev) => updatePromptProfileSlot(prev, slot, { mode: value }))
                        }
                        onValueChange={(value) =>
                          setGlobalPromptProfileDraft((prev) => updatePromptProfileSlot(prev, slot, { mode: "replace", value }))
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
                    <EffectiveInheritedValue label="Current inherited value" value={undefined} emptyCopy="No saved global image instructions yet." />
                  ) : null}
                  <Textarea
                    value={globalPromptProfileDraft.globalInstructions ?? ""}
                    onChange={(event) =>
                      setGlobalPromptProfileDraft((prev) => updatePromptProfileGlobalInstructions(prev, event.target.value))
                    }
                    placeholder="Global image instructions"
                    className="mt-3 min-h-28 border-white/10 bg-black/25 text-white"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" className="bg-white text-black hover:bg-zinc-200" onClick={handleSaveGlobalPromptProfile}>
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
                <div className="grid gap-4 lg:grid-cols-2">
                  {IMAGE_PROMPT_SLOT_ORDER.map((slot) => {
                    const override = runPromptProfileDraft.slotOverrides?.[slot] ?? createEmptyPromptSlotOverride();
                    return (
                      <PromptSlotControl
                        key={slot}
                        label={IMAGE_PROMPT_SLOT_LABELS[slot]}
                        defaultValue={IMAGE_PROMPT_SLOT_DEFAULTS[slot]}
                        override={override}
                        effectiveValue={resolveImagePromptSlotLine(slot, savedGlobalPromptProfile)}
                        onModeChange={(value) =>
                          setRunPromptProfileDraft((prev) => updatePromptProfileSlot(prev, slot, { mode: value }))
                        }
                        onValueChange={(value) =>
                          setRunPromptProfileDraft((prev) => updatePromptProfileSlot(prev, slot, { mode: "replace", value }))
                        }
                        inheritLabel="What this run is inheriting"
                        inheritEmptyCopy="Nothing is being inherited here because the saved global defaults currently omit this line."
                      />
                    );
                  })}
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="text-sm font-medium text-white">Run instructions</div>
                  {!runPromptProfileDraft.globalInstructions?.trim() ? (
                    <EffectiveInheritedValue label="What this run is inheriting" value={savedGlobalPromptProfile.globalInstructions} emptyCopy="No saved global image instructions are being inherited." />
                  ) : null}
                  <Textarea
                    value={runPromptProfileDraft.globalInstructions ?? ""}
                    onChange={(event) =>
                      setRunPromptProfileDraft((prev) => updatePromptProfileGlobalInstructions(prev, event.target.value))
                    }
                    placeholder="Run-only image instructions"
                    className="mt-3 min-h-28 border-white/10 bg-black/25 text-white"
                  />
                </div>
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
              </TabsContent>
            </Tabs>
          </div>

          <div className="rounded-[1.6rem] border border-white/8 bg-black/20 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm font-semibold text-white">Generate project images</div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void handleGenerateImages(activePromptSnapshot)}
                  disabled={isGenerateDisabled}
                  className="bg-[linear-gradient(135deg,rgba(52,211,153,0.95),rgba(34,211,238,0.95))] font-semibold text-black hover:opacity-95"
                >
                  {isGeneratingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {primaryGenerateLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleGenerateImages(secondaryGenerateSnapshot)}
                  disabled={isGenerateDisabled || !hasRunDraftEdits}
                  className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                >
                  {secondaryGenerateLabel}
                </Button>
              </div>
            </div>
          </div>

          {imageError ? (
            <Alert className="border-red-400/25 bg-red-400/10 text-red-50">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Image generation failed</AlertTitle>
              <AlertDescription className="text-red-50/80">{imageError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {imageResult?.images.length ? (
        <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <CardHeader className="border-b border-white/6">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-300" />
              Latest Images
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
            {imageResult.images.map((image) => (
                <div key={image.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                  <NextImage
                    src={`data:${image.mimeType};base64,${image.base64}`}
                    alt={image.revisedPrompt || imageResult.prompt}
                    width={512}
                    height={512}
                    unoptimized
                    className="aspect-square w-full object-cover"
                  />
                  <div className="space-y-3 p-3">
                    <div className="break-all text-xs text-white/55">{image.filename}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                        onClick={() => openFile(base64ToFile(image.base64, image.filename, image.mimeType))}
                      >
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        Open
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                        onClick={() => downloadFile(base64ToFile(image.base64, image.filename, image.mimeType))}
                      >
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {imageHistory.length > 0 ? (
        <Card className="overflow-hidden border-white/8 bg-white/[0.035] text-white shadow-[0_22px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <CardHeader className="border-b border-white/6">
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-cyan-300" />
              Image History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {imageHistory.map((record) => (
              <div key={record.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-cyan-400" />
                      <span className="text-sm font-medium text-white">{formatRelativeDate(record.generatedAt)}</span>
                      <Badge className="border-white/10 bg-white/5 text-[10px] text-white/60">
                        {record.inputSummary.model ?? "unknown"}
                      </Badge>
                      <Badge className="border-emerald-300/20 bg-emerald-400/10 text-[10px] text-emerald-100">
                        {record.assetIds.length} asset{record.assetIds.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {record.assetIds.map((assetId) => {
                        const asset = assetsById.get(assetId);
                        const imageFile = asset?.fileBlob;
                        return (
                          <div key={assetId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-2">
                            <AssetImagePreview file={imageFile} alt={asset?.filename ?? "Generated image"} />
                            <div className="mt-2 truncate text-xs text-white/70">{asset?.filename ?? assetId}</div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
                                onClick={() => imageFile && openFile(imageFile)}
                                disabled={!imageFile}
                              >
                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                Open
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 border border-white/10 bg-white/5 text-xs text-white hover:bg-white/10"
                                onClick={() => imageFile && downloadFile(imageFile, asset?.filename)}
                                disabled={!imageFile}
                              >
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                                Download
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => void handleDeleteRecord(record.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
