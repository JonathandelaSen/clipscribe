"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
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
import { isBackgroundTaskActive } from "@/lib/background-tasks/core";
import type { BackgroundTaskRecord } from "@/lib/background-tasks/types";
import {
  getLatestSubtitleForLanguage,
  getLatestTranscript,
  getSubtitleById,
  getTranscriptById,
  makeId,
  shiftSubtitleChunks,
  sortSubtitleVersions,
  sortTranscriptVersions,
  type HistoryItem,
  type SubtitleChunk,
  type SubtitleVersion,
} from "@/lib/history";
import {
  secondsToClock,
  type CreatorGenerationSourceInput,
  type CreatorLLMProvider,
  type CreatorReactiveOverlayItem,
  type CreatorReactiveOverlayPresetId,
  type CreatorShortEditorState,
  type CreatorShortPlan,
  type CreatorShortsGenerateRequest,
  type CreatorSubtitleStyleSettings,
  type CreatorSubtitleTimingMode,
  type CreatorTextOverlayState,
  type CreatorTextOverlayStyleSettings,
  type CreatorVideoInfoGenerateRequest,
  type CreatorViralClip,
  type CreatorVideoInfoBlock,
} from "@/lib/creator/types";
import { getCreatorProviderLabel } from "@/lib/creator/ai";
import { buildCreatorTextProviderHeaders } from "@/lib/creator/user-ai-settings";
import {
  applyTrimNudgesToClip,
  createManualFallbackClip,
  createManualFallbackPlan,
  deriveTrimNudgesFromSavedClip,
} from "@/lib/creator/core/clip-editing";
import { buildPopCaptionChunks } from "@/lib/creator/core/pop-captions";
import { clipSubtitleChunks, findSubtitleChunkAtTime } from "@/lib/creator/core/clip-windowing";
import { buildShortExportDiagnostics } from "@/lib/creator/core/export-diagnostics";
import { prepareShortExport } from "@/lib/creator/core/export-prep";
import {
  buildShortPreviewStyle,
  resolveShortFrameLayout,
  resolveShortFramePanLimits,
  scaleShortFramePanToViewport,
} from "@/lib/creator/core/short-frame-layout";
import {
  getCreatorTextOverlayFallbackPreset,
  getCreatorTextOverlayFontSize,
  getDefaultCreatorTextOverlayState,
  hydrateCreatorShortEditorState,
  resolveCreatorTextOverlayWindow,
  type CreatorResolvedTextOverlayWindow,
  type CreatorTextOverlaySlot,
} from "@/lib/creator/core/text-overlays";
import {
  buildAiSuggestionInputSummary,
  buildAiSuggestionProjectRecords,
  buildAiSuggestionSourceSignature,
  buildCompletedShortExportRecord,
  buildShortProjectRecord,
  markShortProjectExported,
  markShortProjectFailed,
  restoreShortProjectAfterCanceledExport,
  shouldReuseShortProjectId,
} from "@/lib/creator/core/short-lifecycle";
import {
  getNextActiveShortPreviewId,
  getShortPreviewProgressPct,
  getShortPreviewSeekTime,
  isLikelyVideoSourceFilename,
  resolveShortPreviewBoundary,
} from "@/lib/creator/core/short-preview";
import type { CreatorShortExportRecord, CreatorShortProjectRecord } from "@/lib/creator/storage";
import { readMediaMetadata } from "@/lib/editor/media";
import { createEditorAssetRecord } from "@/lib/editor/storage";
import { buildCompletedCreatorShortRenderResponse } from "@/lib/creator/system-export-contract";
import { requestSystemCreatorShortExport } from "@/lib/creator/system-export-client";
import {
  buildCreatorReactiveOverlayAudioAnalysis,
  CREATOR_REACTIVE_OVERLAY_PRESETS,
  createDefaultCreatorReactiveOverlay,
  getCreatorReactiveOverlayPresetLabel,
  resolveCreatorReactiveOverlayFrame,
  resolveCreatorReactiveOverlayRect,
  type CreatorReactiveAudioAnalysisTrack,
  type CreatorReactiveOverlayFrame,
} from "@/lib/creator/reactive-overlays";
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
import {
  COMMON_TEXT_OVERLAY_STYLE_PRESETS,
  CREATOR_TEXT_OVERLAY_STYLE_LABELS,
  cssTextShadowFromTextOverlayStyle,
  getDefaultCreatorTextOverlayStyle,
  getCreatorTextOverlayMaxCharsPerLine,
  resolveCreatorTextOverlayStyle,
  wrapCreatorTextOverlayLines,
} from "@/lib/creator/text-overlay-style";
import { useCreatorAiSettings } from "@/hooks/useCreatorAiSettings";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";
import { useHistoryLibrary } from "@/hooks/useHistoryLibrary";
import { useCreatorShortRenderer } from "@/hooks/useCreatorShortRenderer";
import { useCreatorShortsGenerator } from "@/hooks/useCreatorShortsGenerator";
import { useCreatorLlmRuns } from "@/hooks/useCreatorLlmRuns";
import { useCreatorShortsLibrary } from "@/hooks/useCreatorShortsLibrary";
import { useCreatorTextFeatureConfig } from "@/hooks/useCreatorTextFeatureConfig";
import { useCreatorVideoInfoGenerator } from "@/hooks/useCreatorVideoInfoGenerator";
import { PROJECT_LIBRARY_UPDATED_EVENT } from "@/lib/projects/events";
import { getSelectableProjectVisualAssets } from "@/lib/projects/source-assets";
import type { ProjectAssetRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BackgroundTaskBanner } from "@/components/tasks/BackgroundTaskBanner";

function legacyCopyText(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }

  return copied;
}

const SHORT_EXPORT_LOG_LIMIT = 250;

function formatShortExportLogLine(message: string, startedAt: number, now: number) {
  const elapsedSeconds = ((now - startedAt) / 1000).toFixed(2);
  return `[${new Date(now).toISOString()} | +${elapsedSeconds}s] ${message}`;
}

function clampShortZoomForUi(value: number): number {
  if (!Number.isFinite(value)) return 1.15;
  return Math.min(4, Math.max(1, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function copyText(text: string, label: string) {
  const content = String(text ?? "");
  let copied = false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {}
  }

  if (!copied) {
    copied = legacyCopyText(content);
  }

  if (copied) {
    toast.success(`${label} copied`, {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
    return;
  }

  toast.error(`Couldn't copy ${label.toLowerCase()}`, {
    className: "bg-red-500/20 border-red-500/50 text-red-100",
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

function getAnalyzeErrorDetails(message: string | null): { title: string; body: string } | null {
  if (!message) return null;
  if (message.startsWith("OpenAI API Error: ")) {
    return {
      title: "Error en la API de OpenAI",
      body: message.replace("OpenAI API Error: ", ""),
    };
  }
  if (message.startsWith("Gemini API Error: ")) {
    return {
      title: "Error en la API de Gemini",
      body: message.replace("Gemini API Error: ", ""),
    };
  }
  if (/authentication failed|api key/i.test(message)) {
    return {
      title: "Falló la autenticación del provider",
      body: "La key configurada no ha sido aceptada por el provider activo. Revísala o pega una nueva.",
    };
  }
  if (/quota|rate limit/i.test(message)) {
    return {
      title: "El provider rechazó la petición",
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

function getCreatorApiKeySourceLabel(apiKeySource?: "header" | "env"): string {
  if (apiKeySource === "header") return "Browser key";
  if (apiKeySource === "env") return "Server env";
  return "Key missing";
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

function TextOverlayPreviewText({
  text,
  overlayStyle,
  fontSizePx,
  lineHeightPx,
  borderWidthPx,
  shadowScale = 1,
  className,
}: {
  text: string;
  overlayStyle: CreatorTextOverlayStyleSettings;
  fontSizePx: number;
  lineHeightPx: number;
  borderWidthPx: number;
  shadowScale?: number;
  className?: string;
}) {
  const hasBackground = overlayStyle.backgroundEnabled && overlayStyle.backgroundOpacity > 0;

  return (
    <span className={className} style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
      <span
        style={{
          display: "block",
          whiteSpace: "pre-line",
          textAlign: "center",
          fontSize: `${fontSizePx}px`,
          lineHeight: `${lineHeightPx}px`,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          fontFamily: "var(--font-inter), 'Inter', sans-serif",
          color: overlayStyle.textColor,
          WebkitTextStroke: `${borderWidthPx.toFixed(2)}px ${cssRgbaFromHex(overlayStyle.borderColor, 0.95)}`,
          textShadow: cssTextShadowFromTextOverlayStyle(overlayStyle, shadowScale),
          paintOrder: "stroke fill",
          background: hasBackground ? cssRgbaFromHex(overlayStyle.backgroundColor, overlayStyle.backgroundOpacity) : "transparent",
          borderRadius: hasBackground ? `${overlayStyle.backgroundRadius * shadowScale}px` : undefined,
          padding: hasBackground
            ? `${overlayStyle.backgroundPaddingY * shadowScale}px ${overlayStyle.backgroundPaddingX * shadowScale}px`
            : undefined,
        }}
      >
        {text}
      </span>
    </span>
  );
}

function TextOverlayEditorCard({
  title,
  slot,
  overlay,
  resolvedStyle,
  effectiveWindow,
  referenceText,
  onChange,
  onResetToSuggestion,
}: {
  title: string;
  slot: CreatorTextOverlaySlot;
  overlay: CreatorTextOverlayState;
  resolvedStyle: CreatorTextOverlayStyleSettings;
  effectiveWindow: CreatorResolvedTextOverlayWindow;
  referenceText?: string;
  onChange: (updater: (prev: CreatorTextOverlayState) => CreatorTextOverlayState) => void;
  onResetToSuggestion?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-white/92">{title}</div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">
            {slot === "intro" ? "Opening title overlay" : "Closing title overlay"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {referenceText?.trim() && onResetToSuggestion ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 bg-white/5 px-3 text-xs text-white/80 hover:bg-white/10"
              onClick={onResetToSuggestion}
            >
              Reset to AI suggestion
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/55">{overlay.enabled ? "On" : "Off"}</span>
            <Switch
              checked={overlay.enabled}
              onCheckedChange={(checked) => onChange((prev) => ({ ...prev, enabled: checked }))}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-[0.24em] text-white/45">Text</Label>
        <Textarea
          value={overlay.text}
          onChange={(event) => onChange((prev) => ({ ...prev, text: event.target.value }))}
          rows={3}
          placeholder={slot === "intro" ? "Type the hook viewers should read first." : "Type the final card text."}
          className="min-h-[88px] border-white/10 bg-white/[0.04] text-white placeholder:text-white/30"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-xs text-white/70 block">
          Start offset
          <Input
            type="number"
            min={0}
            step={0.1}
            value={overlay.startOffsetSeconds}
            onChange={(event) =>
              onChange((prev) => ({
                ...prev,
                startOffsetSeconds: Number(event.target.value),
              }))
            }
            className="mt-1 border-white/10 bg-white/[0.04] text-white"
          />
        </label>
        <label className="text-xs text-white/70 block">
          Duration
          <Input
            type="number"
            min={0}
            step={0.1}
            value={overlay.durationSeconds}
            onChange={(event) =>
              onChange((prev) => ({
                ...prev,
                durationSeconds: Number(event.target.value),
              }))
            }
            className="mt-1 border-white/10 bg-white/[0.04] text-white"
          />
        </label>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[11px] text-white/60">
        Effective timing: {effectiveWindow.enabled
          ? `${effectiveWindow.startOffsetSeconds.toFixed(1)}s → ${effectiveWindow.endOffsetSeconds.toFixed(1)}s`
          : "Disabled or empty"}
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium text-white/82">Quick styles</div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {COMMON_TEXT_OVERLAY_STYLE_PRESETS.map((quick) => (
            <button
              key={quick.id}
              type="button"
              onClick={() => onChange((prev) => ({ ...prev, style: { ...quick.style } }))}
              className="rounded-2xl border border-white/10 bg-black/35 p-3 text-left transition-colors hover:bg-white/[0.05] hover:border-white/20"
            >
              <div className="mb-3 rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(10,18,30,0.96),rgba(18,38,62,0.88)_52%,rgba(107,33,168,0.25))] px-4 py-7 text-center">
                <TextOverlayPreviewText
                  text="Title Goes Here"
                  overlayStyle={quick.style}
                  fontSizePx={20}
                  lineHeightPx={22}
                  borderWidthPx={Math.max(1, quick.style.borderWidth * 0.6)}
                  shadowScale={0.65}
                />
              </div>
              <div className="text-sm font-semibold text-white/90">{quick.name}</div>
              <div className="mt-1 text-xs leading-relaxed text-white/55">{quick.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-xs text-white/70 block">
          Style preset
          <Select
            value={resolvedStyle.preset}
            onValueChange={(value) => {
              if (value !== "headline_bold" && value !== "glass_card" && value !== "neon_punch") return;
              onChange((prev) => ({ ...prev, style: getDefaultCreatorTextOverlayStyle(value) }));
            }}
          >
            <SelectTrigger className="mt-1 border-white/10 bg-white/[0.04] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-zinc-950 text-white">
              {(["headline_bold", "glass_card", "neon_punch"] as const).map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {CREATOR_TEXT_OVERLAY_STYLE_LABELS[preset]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="text-xs text-white/70 block">
          Text case
          <Select
            value={resolvedStyle.textCase}
            onValueChange={(value) => {
              if (value !== "original" && value !== "uppercase") return;
              onChange((prev) => ({ ...prev, style: { ...prev.style, textCase: value } }));
            }}
          >
            <SelectTrigger className="mt-1 border-white/10 bg-white/[0.04] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-zinc-950 text-white">
              <SelectItem value="original">Original</SelectItem>
              <SelectItem value="uppercase">Uppercase</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <label className="text-xs text-white/70 block">Scale: {overlay.scale.toFixed(2)}x</label>
      <input
        type="range"
        min={0.5}
        max={2.5}
        step={0.01}
        value={overlay.scale}
        onChange={(event) => onChange((prev) => ({ ...prev, scale: Number(event.target.value) }))}
        className="w-full"
      />
      <label className="text-xs text-white/70 block">Horizontal position: {overlay.positionXPercent.toFixed(0)}%</label>
      <input
        type="range"
        min={5}
        max={95}
        step={1}
        value={overlay.positionXPercent}
        onChange={(event) => onChange((prev) => ({ ...prev, positionXPercent: Number(event.target.value) }))}
        className="w-full"
      />
      <label className="text-xs text-white/70 block">Vertical position: {overlay.positionYPercent.toFixed(0)}%</label>
      <input
        type="range"
        min={5}
        max={95}
        step={1}
        value={overlay.positionYPercent}
        onChange={(event) => onChange((prev) => ({ ...prev, positionYPercent: Number(event.target.value) }))}
        className="w-full"
      />
      <label className="text-xs text-white/70 block">Max width: {overlay.maxWidthPct.toFixed(0)}%</label>
      <input
        type="range"
        min={20}
        max={95}
        step={1}
        value={overlay.maxWidthPct}
        onChange={(event) => onChange((prev) => ({ ...prev, maxWidthPct: Number(event.target.value) }))}
        className="w-full"
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="text-xs text-white/70 block">
          Text color
          <input
            type="color"
            value={resolvedStyle.textColor}
            onChange={(event) =>
              onChange((prev) => ({ ...prev, style: { ...prev.style, textColor: event.target.value.toUpperCase() } }))
            }
            className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/[0.04]"
          />
        </label>
        <label className="text-xs text-white/70 block">
          Border color
          <input
            type="color"
            value={resolvedStyle.borderColor}
            onChange={(event) =>
              onChange((prev) => ({ ...prev, style: { ...prev.style, borderColor: event.target.value.toUpperCase() } }))
            }
            className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/[0.04]"
          />
        </label>
        <label className="text-xs text-white/70 block">
          Shadow color
          <input
            type="color"
            value={resolvedStyle.shadowColor}
            onChange={(event) =>
              onChange((prev) => ({ ...prev, style: { ...prev.style, shadowColor: event.target.value.toUpperCase() } }))
            }
            className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/[0.04]"
          />
        </label>
      </div>

      <label className="text-xs text-white/70 block">Border width: {resolvedStyle.borderWidth.toFixed(1)}px</label>
      <input
        type="range"
        min={0}
        max={8}
        step={0.1}
        value={resolvedStyle.borderWidth}
        onChange={(event) =>
          onChange((prev) => ({ ...prev, style: { ...prev.style, borderWidth: Number(event.target.value) } }))
        }
        className="w-full"
      />
      <label className="text-xs text-white/70 block">Shadow opacity: {Math.round(resolvedStyle.shadowOpacity * 100)}%</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={resolvedStyle.shadowOpacity}
        onChange={(event) =>
          onChange((prev) => ({ ...prev, style: { ...prev.style, shadowOpacity: Number(event.target.value) } }))
        }
        className="w-full"
      />
      <label className="text-xs text-white/70 block">Shadow distance: {resolvedStyle.shadowDistance.toFixed(1)}px</label>
      <input
        type="range"
        min={0}
        max={16}
        step={0.1}
        value={resolvedStyle.shadowDistance}
        onChange={(event) =>
          onChange((prev) => ({ ...prev, style: { ...prev.style, shadowDistance: Number(event.target.value) } }))
        }
        className="w-full"
      />

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-white/85">Background</div>
            <div className="text-[11px] text-white/50">Use a rounded card behind the text for legibility.</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/60">{resolvedStyle.backgroundEnabled ? "On" : "Off"}</span>
            <Switch
              checked={resolvedStyle.backgroundEnabled}
              onCheckedChange={(checked) =>
                onChange((prev) => ({ ...prev, style: { ...prev.style, backgroundEnabled: checked } }))
              }
            />
          </div>
        </div>

        {resolvedStyle.backgroundEnabled ? (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs text-white/70 block">
                Background color
                <input
                  type="color"
                  value={resolvedStyle.backgroundColor}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      style: { ...prev.style, backgroundColor: event.target.value.toUpperCase() },
                    }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/[0.04]"
                />
              </label>
              <label className="text-xs text-white/70 block">
                Background opacity: {Math.round(resolvedStyle.backgroundOpacity * 100)}%
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={resolvedStyle.backgroundOpacity}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      style: { ...prev.style, backgroundOpacity: Number(event.target.value) },
                    }))
                  }
                  className="mt-1 w-full"
                />
              </label>
            </div>
            <label className="text-xs text-white/70 block">Background radius: {resolvedStyle.backgroundRadius.toFixed(0)}px</label>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={resolvedStyle.backgroundRadius}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  style: { ...prev.style, backgroundRadius: Number(event.target.value) },
                }))
              }
              className="w-full"
            />
            <label className="text-xs text-white/70 block">Horizontal padding: {resolvedStyle.backgroundPaddingX.toFixed(0)}px</label>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={resolvedStyle.backgroundPaddingX}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  style: { ...prev.style, backgroundPaddingX: Number(event.target.value) },
                }))
              }
              className="w-full"
            />
            <label className="text-xs text-white/70 block">Vertical padding: {resolvedStyle.backgroundPaddingY.toFixed(0)}px</label>
            <input
              type="range"
              min={0}
              max={48}
              step={1}
              value={resolvedStyle.backgroundPaddingY}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  style: { ...prev.style, backgroundPaddingY: Number(event.target.value) },
                }))
              }
              className="w-full"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionDetailField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/82">
        {value.trim() || "None"}
      </div>
    </div>
  );
}

function AiSuggestionPreviewCard({
  project,
  transcriptPreview,
  onOpenEditor,
  onDelete,
  isPreviewActive,
  onTogglePreview,
  previewSourceUrl,
  previewSourceFilename,
  previewSourceIsVideo,
  isPreviewSourceLoading,
}: {
  project: CreatorShortProjectRecord;
  transcriptPreview: string;
  onOpenEditor: () => void;
  onDelete: () => void;
  isPreviewActive: boolean;
  onTogglePreview: (projectId: string) => void;
  previewSourceUrl: string | null;
  previewSourceFilename: string | null;
  previewSourceIsVideo: boolean;
  isPreviewSourceLoading: boolean;
}) {
  const [expandedItem, setExpandedItem] = useState<string>("");
  const [previewCurrentTime, setPreviewCurrentTime] = useState(project.clip.startSeconds);
  const [isPreviewMuted, setIsPreviewMuted] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const shouldAutoplayPreviewRef = useRef(false);
  const hasPrimedPreviewFrameRef = useRef(false);
  const displayCurrentTime = isPreviewActive ? previewCurrentTime : project.clip.startSeconds;
  const previewProgressPct = getShortPreviewProgressPct(displayCurrentTime, project.clip);
  const hasPreviewVideo = !!previewSourceUrl && previewSourceIsVideo;
  const inferredPreviewFilename = previewSourceFilename || project.sourceFilename;
  const previewStatus = isPreviewSourceLoading
    ? "loading"
    : hasPreviewVideo
      ? "ready"
      : isLikelyVideoSourceFilename(inferredPreviewFilename)
        ? "missing"
        : "audio_only";

  useEffect(() => {
    hasPrimedPreviewFrameRef.current = false;
  }, [previewSourceUrl, project.id]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    if (!isPreviewActive) {
      video.pause();
      return;
    }

    if (!hasPreviewVideo || !shouldAutoplayPreviewRef.current) return;
    if (video.readyState < 1) return;
    video.muted = isPreviewMuted;
    if (video.currentTime < project.clip.startSeconds || video.currentTime >= project.clip.endSeconds) {
      video.currentTime = project.clip.startSeconds;
    }
    shouldAutoplayPreviewRef.current = false;
    void video.play().catch((error) => {
      console.error("Failed to start AI suggestion preview", error);
    });
  }, [hasPreviewVideo, isPreviewActive, isPreviewMuted, project.clip.endSeconds, project.clip.startSeconds]);

  useEffect(() => {
    if (isPreviewActive && !hasPreviewVideo && !isPreviewSourceLoading) {
      onTogglePreview(project.id);
    }
  }, [hasPreviewVideo, isPreviewActive, isPreviewSourceLoading, onTogglePreview, project.id]);

  const handlePreviewToggle = useCallback(() => {
    if (!hasPreviewVideo) {
      return;
    }

    const video = previewVideoRef.current;
    if (isPreviewActive) {
      video?.pause();
      setPreviewCurrentTime(video?.currentTime ?? previewCurrentTime);
      onTogglePreview(project.id);
      return;
    }

    if (video && (video.currentTime < project.clip.startSeconds || video.currentTime >= project.clip.endSeconds)) {
      video.currentTime = project.clip.startSeconds;
      setPreviewCurrentTime(project.clip.startSeconds);
    }
    shouldAutoplayPreviewRef.current = true;
    onTogglePreview(project.id);
  }, [hasPreviewVideo, isPreviewActive, onTogglePreview, previewCurrentTime, project.clip.endSeconds, project.clip.startSeconds, project.id]);

  const handlePreviewMuteToggle = useCallback(() => {
    const video = previewVideoRef.current;
    setIsPreviewMuted((current) => {
      const next = !current;
      if (video) {
        video.muted = next;
      }
      return next;
    });
  }, []);

  const handlePreviewSeek = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!hasPreviewVideo) return;
      const video = previewVideoRef.current;
      if (!video) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const progressPct = ((event.clientX - rect.left) / rect.width) * 100;
      const seekTime = getShortPreviewSeekTime(progressPct, project.clip);
      video.currentTime = seekTime;
      setPreviewCurrentTime(seekTime);
    },
    [hasPreviewVideo, project.clip]
  );

  const handlePreviewTimeUpdate = useCallback(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    const boundary = resolveShortPreviewBoundary(video.currentTime, project.clip);
    if (boundary.shouldStop) {
      video.pause();
      video.currentTime = boundary.nextTimeSeconds;
      setPreviewCurrentTime(boundary.nextTimeSeconds);
      if (isPreviewActive) onTogglePreview(project.id);
      return;
    }
    setPreviewCurrentTime(boundary.nextTimeSeconds);
  }, [isPreviewActive, onTogglePreview, project.clip, project.id]);

  const previewStatusLabel =
    previewStatus === "loading"
      ? "Loading preview..."
      : previewStatus === "audio_only"
        ? "Audio-only source"
        : previewStatus === "missing"
          ? "Source video missing"
          : "Preview this recommended short";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-5 flex flex-col">
      <Accordion type="single" collapsible className="w-full" value={expandedItem} onValueChange={setExpandedItem}>
        <AccordionItem value={project.id} className="border-none">
        <AccordionTrigger className="py-5 text-left hover:no-underline">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-fuchsia-100">
                    AI
                  </div>
                  <div className="rounded-full border border-orange-400/20 bg-orange-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-orange-100">
                    Short
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-white/45">
                    Score {project.clip.score}
                  </div>
                </div>
                <div className="truncate text-base font-semibold text-white/92">{project.plan.title}</div>
              </div>
              <div className="text-right text-[11px] uppercase tracking-[0.24em] text-white/40">
                {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-white/72">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">Clip title</div>
                <div className="mt-1 leading-relaxed text-white/86">{project.clip.title}</div>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-white/72">
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">Hook preview</div>
                <div className="mt-1 line-clamp-2 leading-relaxed text-white/86">{project.clip.hook}</div>
              </div>
            </div>

            <div className="line-clamp-2 text-sm leading-relaxed text-white/58">
              {transcriptPreview || project.clip.reason}
            </div>
          </div>
        </AccordionTrigger>
        <div className="pb-5">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(14,14,20,0.98),rgba(8,8,12,0.98))]">
            <div className="relative aspect-video bg-black">
              {hasPreviewVideo && previewSourceUrl ? (
                <video
                  ref={previewVideoRef}
                  key={`${project.id}:${previewSourceUrl}`}
                  src={previewSourceUrl}
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-contain"
                  onLoadedData={() => {
                    const video = previewVideoRef.current;
                    if (!video) return;
                    video.muted = isPreviewMuted;
                    if (!hasPrimedPreviewFrameRef.current) {
                      hasPrimedPreviewFrameRef.current = true;
                      if (Math.abs(video.currentTime - project.clip.startSeconds) > 0.05) {
                        video.currentTime = project.clip.startSeconds;
                        return;
                      }
                    }
                    setPreviewCurrentTime(video.currentTime);
                    if (isPreviewActive && shouldAutoplayPreviewRef.current) {
                      shouldAutoplayPreviewRef.current = false;
                      void video.play().catch((error) => {
                        console.error("Failed to start AI suggestion preview", error);
                      });
                    }
                  }}
                  onSeeked={() => {
                    const video = previewVideoRef.current;
                    if (!video) return;
                    setPreviewCurrentTime(video.currentTime);
                    if (isPreviewActive && shouldAutoplayPreviewRef.current) {
                      shouldAutoplayPreviewRef.current = false;
                      void video.play().catch((error) => {
                        console.error("Failed to start AI suggestion preview", error);
                      });
                    }
                  }}
                  onTimeUpdate={handlePreviewTimeUpdate}
                />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(232,121,249,0.18),transparent_45%),linear-gradient(135deg,rgba(34,211,238,0.12),rgba(249,115,22,0.06)_45%,rgba(0,0,0,0.92))] px-5 py-4">
                  <div className="flex h-full flex-col justify-between">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-white/55">
                        {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-white/45">
                        {project.clip.durationSeconds.toFixed(1)}s
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="text-base font-semibold text-white/92">{project.plan.title}</div>
                      <div className="text-sm leading-relaxed text-white/62">
                        {previewStatus === "loading"
                          ? "Preparing the original source clip for inline playback."
                          : previewStatus === "audio_only"
                            ? "This source only has audio, so there is no inline video preview here."
                            : previewStatus === "missing"
                              ? "The local source file is no longer available in the browser storage."
                              : "Press play to watch and listen to the exact recommended moment before opening the editor."}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-4 pb-3 pt-8">
                <div className="flex items-center justify-between gap-3 text-[11px] text-white/65">
                  <span>{secondsToClock(Math.max(0, displayCurrentTime - project.clip.startSeconds))}</span>
                  <span>{secondsToClock(project.clip.durationSeconds)}</span>
                </div>
                <div
                  className={cn(
                    "mt-2 h-1.5 rounded-full",
                    hasPreviewVideo ? "cursor-pointer bg-white/20" : "bg-white/10"
                  )}
                  onClick={handlePreviewSeek}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-400 via-fuchsia-400 to-cyan-300 transition-[width] duration-100"
                    style={{ width: `${previewProgressPct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handlePreviewToggle}
                      disabled={!hasPreviewVideo || isPreviewSourceLoading}
                      className="rounded-full bg-white/10 p-1.5 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={isPreviewActive ? "Pause" : "Play"}
                    >
                      {isPreviewActive ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
                    </button>
                    <button
                      type="button"
                      onClick={handlePreviewMuteToggle}
                      disabled={!hasPreviewVideo || isPreviewSourceLoading}
                      className="rounded-full bg-white/10 p-1.5 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={isPreviewMuted ? "Unmute" : "Mute"}
                    >
                      {isPreviewMuted ? <VolumeX className="h-4 w-4 text-white/70" /> : <Volume2 className="h-4 w-4 text-white" />}
                    </button>
                  </div>
                  <div className="text-[11px] text-white/55">{previewStatusLabel}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <AccordionContent className="space-y-4 pb-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SuggestionDetailField label="Clip title" value={project.clip.title} />
            <SuggestionDetailField label="Clip hook" value={project.clip.hook} />
            <SuggestionDetailField label="Clip reason" value={project.clip.reason} />
            <SuggestionDetailField label="Clip punchline" value={project.clip.punchline} />
            <SuggestionDetailField label="Plan title" value={project.plan.title} />
            <SuggestionDetailField label="Plan caption" value={project.plan.caption} />
            <SuggestionDetailField label="Opening text" value={project.plan.openingText} />
            <SuggestionDetailField label="End card" value={project.plan.endCardText} />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">Clip stats</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/70">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                Start {secondsToClock(project.clip.startSeconds)}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                End {secondsToClock(project.clip.endSeconds)}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                Duration {project.clip.durationSeconds.toFixed(1)}s
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">
                Score {project.clip.score}
              </span>
            </div>
          </div>

        </AccordionContent>
        </AccordionItem>
      </Accordion>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/8 pb-5 pt-4">
        <Button
          type="button"
          variant="ghost"
          className="bg-white/5 text-white/75 hover:bg-red-500/15 hover:text-red-100"
          onClick={onDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
        <Button
          type="button"
          className="bg-gradient-to-r from-orange-500 to-fuchsia-400 font-semibold text-black hover:from-orange-400 hover:to-fuchsia-300"
          onClick={onOpenEditor}
        >
          <Clapperboard className="mr-2 h-4 w-4" />
          Open in Editor
        </Button>
      </div>
    </div>
  );
}

function AiSuggestionBatchGroups({
  groups,
  getTranscriptPreview,
  onOpenEditor,
  onDeleteProject,
  onDeleteGeneration,
  activePreviewProjectId,
  onTogglePreview,
  previewSourceUrl,
  previewSourceFilename,
  previewSourceIsVideo,
  isPreviewSourceLoading,
}: {
  groups: Array<{
    generationId: string;
    generatedAt: number;
    inputSummary?: {
      niche?: string;
      audience?: string;
      tone?: string;
      transcriptVersionLabel?: string;
      subtitleVersionLabel?: string;
    };
    projects: CreatorShortProjectRecord[];
  }>;
  getTranscriptPreview: (project: CreatorShortProjectRecord) => string;
  onOpenEditor: (project: CreatorShortProjectRecord) => void;
  onDeleteProject: (project: CreatorShortProjectRecord) => void;
  onDeleteGeneration: (generationId: string, generationLabel: string) => void;
  activePreviewProjectId: string;
  onTogglePreview: (projectId: string) => void;
  previewSourceUrl: string | null;
  previewSourceFilename: string | null;
  previewSourceIsVideo: boolean;
  isPreviewSourceLoading: boolean;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
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
              onClick={() => onDeleteGeneration(group.generationId, new Date(group.generatedAt).toLocaleString())}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete batch
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.projects.map((project) => (
              <AiSuggestionPreviewCard
                key={project.id}
                project={project}
                transcriptPreview={getTranscriptPreview(project)}
                onOpenEditor={() => onOpenEditor(project)}
                onDelete={() => onDeleteProject(project)}
                isPreviewActive={activePreviewProjectId === project.id}
                onTogglePreview={onTogglePreview}
                previewSourceUrl={previewSourceUrl}
                previewSourceFilename={previewSourceFilename}
                previewSourceIsVideo={previewSourceIsVideo}
                isPreviewSourceLoading={isPreviewSourceLoading}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
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

function ReactiveOverlayPreviewGraphic({
  frame,
}: {
  frame: CreatorReactiveOverlayFrame;
}) {
  if (frame.kind === "pulse_ring") {
    return (
      <svg
        width={frame.width}
        height={frame.height}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-full w-full overflow-visible"
      >
        <circle cx={frame.centerX} cy={frame.centerY} r={frame.glowRadius} fill={frame.glowFill} />
        <circle
          cx={frame.centerX}
          cy={frame.centerY}
          r={frame.radius}
          fill="none"
          stroke={frame.stroke}
          strokeWidth={frame.strokeWidth}
          opacity={frame.opacity}
        />
        <circle
          cx={frame.centerX}
          cy={frame.centerY}
          r={frame.innerRadius}
          fill={frame.glowFill}
          opacity={Math.min(0.42, frame.opacity * 0.7)}
        />
      </svg>
    );
  }

  if (frame.kind === "equalizer_bars") {
    return (
      <svg
        width={frame.width}
        height={frame.height}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="block h-full w-full overflow-visible"
      >
        {frame.bars.map((bar, index) => (
          <g key={`${index}_${bar.x}_${bar.height}`}>
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={bar.radius}
              fill={frame.glowFill}
              opacity={0.28}
            />
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={bar.radius}
              fill={frame.fill}
              opacity={frame.opacity}
            />
          </g>
        ))}
      </svg>
    );
  }

  return (
    <svg
      width={frame.width}
      height={frame.height}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      className="block h-full w-full overflow-visible"
    >
      <path
        d={frame.glowPath}
        fill="none"
        stroke={frame.stroke}
        strokeWidth={frame.strokeWidth * 2.4}
        strokeLinecap="round"
        opacity={0.22}
      />
      <path
        d={frame.path}
        fill="none"
        stroke={frame.stroke}
        strokeWidth={frame.strokeWidth}
        strokeLinecap="round"
        opacity={frame.opacity}
      />
    </svg>
  );
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
    value: "hashtags",
    label: "Hashtags",
    description: "Hashtag helpers.",
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
type HubView = "start" | "editor";

type CreatorHubProps = {
  initialTool?: CreatorToolMode;
  lockedTool?: CreatorToolMode;
  projectId?: string;
  initialSourceAssetId?: string;
  initialView?: HubView;
  onProjectAssetsChanged?: () => void | Promise<void>;
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
  onProjectAssetsChanged,
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
    geminiApiKey,
    hasOpenAIApiKey,
    hasGeminiApiKey,
    maskedOpenAIApiKey,
    maskedGeminiApiKey,
    saveOpenAIApiKey,
    saveGeminiApiKey,
    clearOpenAIApiKey,
    clearGeminiApiKey,
    shortsFeatureSettings,
    videoInfoFeatureSettings,
    saveFeatureModel,
    saveFeatureProvider,
  } = useCreatorAiSettings();
  const { activeTasks, startShortExport, cancelTask } = useBackgroundTasks();
  const creatorProviderHeaders = useMemo(
    () => buildCreatorTextProviderHeaders({ openAIApiKey, geminiApiKey }),
    [geminiApiKey, openAIApiKey]
  );
  const { config: shortsAiConfig } = useCreatorTextFeatureConfig("shorts", {
    headers: creatorProviderHeaders,
  });
  const { config: videoInfoAiConfig } = useCreatorTextFeatureConfig("video_info", {
    headers: creatorProviderHeaders,
    provider: videoInfoFeatureSettings?.provider,
  });

  const [hubView, setHubView] = useState<HubView>(initialView);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialSourceAssetId ?? "");
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string>("");
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("");
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [openAIApiKeyDraft, setOpenAIApiKeyDraft] = useState("");
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState("");
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
  const [subtitleScale, setSubtitleScale] = useState(1);
  const [subtitleXPositionPct, setSubtitleXPositionPct] = useState(50);
  const [subtitleYOffsetPct, setSubtitleYOffsetPct] = useState(78);
  const [subtitleTimingMode, setSubtitleTimingMode] = useState<CreatorSubtitleTimingMode>("pair");
  const [subtitleStyleOverrides, setSubtitleStyleOverrides] = useState<Partial<CreatorSubtitleStyleSettings>>({});
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [introOverlay, setIntroOverlay] = useState<CreatorTextOverlayState>(() =>
    getDefaultCreatorTextOverlayState("intro")
  );
  const [outroOverlay, setOutroOverlay] = useState<CreatorTextOverlayState>(() =>
    getDefaultCreatorTextOverlayState("outro")
  );
  const [reactiveOverlays, setReactiveOverlays] = useState<CreatorReactiveOverlayItem[]>([]);
  const [selectedReactiveOverlayId, setSelectedReactiveOverlayId] = useState("");
  const [activeSavedShortProjectId, setActiveSavedShortProjectId] = useState<string>("");
  const [detachedShortSelection, setDetachedShortSelection] = useState<{ clip: CreatorViralClip; plan: CreatorShortPlan } | null>(null);
  const [, setIsExportingShort] = useState(false);
  const [shortExportStage, setShortExportStage] = useState<BrowserRenderStage>("preparing");
  const [exportProgressPct, setExportProgressPct] = useState(0);
  const [localRenderError, setLocalRenderError] = useState<string | null>(null);
  const [localRenderDiagnostics, setLocalRenderDiagnostics] = useState<string | null>(null);
  const [shortExportLogLines, setShortExportLogLines] = useState<string[]>([]);
  const [shortProjectNameDraft, setShortProjectNameDraft] = useState("");

  const isToolLocked = !!lockedTool;
  const isVideoInfoPage = lockedTool === "video_info";
  const isShortsPage = lockedTool === "clip_lab";
  const sourceSelectorLabel = activeTool === "clip_lab" ? "Source file" : "Project";
  const sourceSelectorPlaceholder =
    activeTool === "clip_lab"
      ? (isLoadingHistory ? "Loading source files..." : "Select source file")
      : (isLoadingHistory ? "Loading projects..." : "Select project");

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFilename, setMediaFilename] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isMediaPreviewLoading, setIsMediaPreviewLoading] = useState(false);
  const [isVideoMedia, setIsVideoMedia] = useState(false);
  const [projectVisualAssets, setProjectVisualAssets] = useState<ProjectAssetRecord[]>([]);
  const [visualSourceMode, setVisualSourceMode] = useState<"original" | "asset">("original");
  const [visualSourceAssetId, setVisualSourceAssetId] = useState("");
  const [visualMediaUrl, setVisualMediaUrl] = useState<string | null>(null);
  const [visualMediaFilename, setVisualMediaFilename] = useState<string | null>(null);
  const [visualMediaFile, setVisualMediaFile] = useState<File | null>(null);
  const [visualMediaKind, setVisualMediaKind] = useState<"video" | "image" | null>(null);
  const [isVisualMediaPreviewLoading, setIsVisualMediaPreviewLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeSuggestionPreviewProjectId, setActiveSuggestionPreviewProjectId] = useState("");
  const [previewFrameSize, setPreviewFrameSize] = useState({ width: 0, height: 0 });
  const [previewSourceSize, setPreviewSourceSize] = useState({ width: 0, height: 0 });
  const [reactiveOverlayAnalysis, setReactiveOverlayAnalysis] = useState<CreatorReactiveAudioAnalysisTrack | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewFrameElRef = useRef<HTMLDivElement | null>(null);
  const reactiveOverlayDecodedAudioCacheRef = useRef(new Map<string, Float32Array>());
  const visualAssetInputRef = useRef<HTMLInputElement | null>(null);
  const shortExportSessionCounterRef = useRef(0);
  const shortExportSessionRef = useRef<ActiveBrowserRenderSession | null>(null);
  const shortExportRestoreSnapshotRef = useRef<Pick<CreatorShortProjectRecord, "status" | "lastExportId" | "lastError"> | null>(null);
  const shortExportLogStartedAtRef = useRef<number | null>(null);
  const shortExportLastLoggedProgressRef = useRef(-1);
  const shortExportHeartbeatStageRef = useRef<BrowserRenderStage>("preparing");
  const shortExportHeartbeatStatusRef = useRef("idle");
  const shortExportHeartbeatProgressRef = useRef(0);
  // useCallback ref: stores element in previewFrameElRef AND sets up ResizeObserver for preview frame size.
  const previewFrameRef = useCallback((el: HTMLDivElement | null) => {
    previewFrameElRef.current = el;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPreviewFrameSize({ width: rect.width, height: rect.height });
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]?.contentRect;
      const width = entry?.width ?? 0;
      const height = entry?.height ?? 0;
      if (width > 0 && height > 0) {
        setPreviewFrameSize({ width, height });
      }
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
  const projectVisualAssetsById = useMemo(
    () => new Map(projectVisualAssets.map((asset) => [asset.id, asset])),
    [projectVisualAssets]
  );
  const selectedVisualAsset = useMemo(() => {
    if (visualSourceMode !== "asset" || !visualSourceAssetId) return undefined;
    return projectVisualAssetsById.get(visualSourceAssetId);
  }, [projectVisualAssetsById, visualSourceAssetId, visualSourceMode]);

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
  } = useCreatorShortsLibrary(selectedProjectRootId, selectedSourceAssetId);
  const {
    runs: llmRuns,
    refresh: refreshLlmRuns,
  } = useCreatorLlmRuns(projectId);

  const beginShortExportSession = useCallback(() => {
    return createActiveBrowserRenderSession(++shortExportSessionCounterRef.current);
  }, []);
  const shortExportTaskLogSyncRef = useRef<{
    taskId: string;
    sync: (lines: string[]) => void;
  } | null>(null);

  const beginShortExportLogSession = useCallback((message: string) => {
    const startedAt = Date.now();
    shortExportLogStartedAtRef.current = startedAt;
    shortExportLastLoggedProgressRef.current = -1;
    const line = formatShortExportLogLine(message, startedAt, startedAt);
    const nextLines = [line];
    setShortExportLogLines(nextLines);
    shortExportTaskLogSyncRef.current?.sync(nextLines);
    console.info("[ShortExportLog]", line);
  }, []);

  const appendShortExportLog = useCallback((message: string) => {
    const now = Date.now();
    const startedAt = shortExportLogStartedAtRef.current ?? now;
    const line = formatShortExportLogLine(message, startedAt, now);
    setShortExportLogLines((prev) => {
      if (prev[prev.length - 1] === line) return prev;
      const next =
        prev.length >= SHORT_EXPORT_LOG_LIMIT
          ? [...prev.slice(prev.length - (SHORT_EXPORT_LOG_LIMIT - 1)), line]
          : [...prev, line];
      shortExportTaskLogSyncRef.current?.sync(next);
      return next;
    });
    console.info("[ShortExportLog]", line);
  }, []);

  const shortExportLogText = useMemo(() => shortExportLogLines.join("\n"), [shortExportLogLines]);

  const syncShortExportStage = useCallback((sessionId: number, stage: BrowserRenderStage) => {
    const session = shortExportSessionRef.current;
    if (!session || session.id !== sessionId) return;
    session.stage = stage;
    shortExportHeartbeatStageRef.current = stage;
    setShortExportStage(stage);
    appendShortExportLog(`Stage -> ${stage}.`);
  }, [appendShortExportLog]);

  useEffect(() => {
    shortExportHeartbeatStageRef.current = shortExportStage;
  }, [shortExportStage]);

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

  const aiRunsHref = projectId ? `/creator/runs?projectId=${projectId}` : "/creator/runs";

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
    if (!selectedProjectRootId) {
      setProjectVisualAssets([]);
      return;
    }

    let cancelled = false;

    const loadProjectVisualAssets = async () => {
      try {
        const assets = await db.projectAssets.where("projectId").equals(selectedProjectRootId).toArray();
        if (cancelled) return;
        const selectable = getSelectableProjectVisualAssets(assets as ProjectAssetRecord[])
          .filter((asset) => asset.id !== selectedSourceAssetId && !!asset.fileBlob)
          .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt));
        setProjectVisualAssets(selectable);
      } catch (error) {
        console.error("Failed to load visual assets for creator hub", error);
        if (!cancelled) {
          setProjectVisualAssets([]);
        }
      }
    };

    void loadProjectVisualAssets();
    const handleProjectLibraryUpdated = () => {
      void loadProjectVisualAssets();
    };
    window.addEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleProjectLibraryUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_LIBRARY_UPDATED_EVENT, handleProjectLibraryUpdated);
    };
  }, [selectedProjectRootId, selectedSourceAssetId]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadMedia() {
      if (!selectedProject) {
        setIsMediaPreviewLoading(false);
        setMediaUrl(null);
        setMediaFilename(null);
        setMediaFile(null);
        setIsVideoMedia(false);
        return;
      }

      try {
        setIsMediaPreviewLoading(true);
        const record = selectedSourceAssetId ? await db.projectAssets.get(selectedSourceAssetId) : undefined;
        if (cancelled) return;
        if (!record?.fileBlob) {
          setIsMediaPreviewLoading(false);
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
        setIsMediaPreviewLoading(false);
      } catch (error) {
        console.error("Failed to load media preview", error);
        if (!cancelled) {
          setIsMediaPreviewLoading(false);
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
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadVisualMedia() {
      if (!selectedVisualAsset?.fileBlob || visualSourceMode !== "asset") {
        setIsVisualMediaPreviewLoading(false);
        setVisualMediaUrl(null);
        setVisualMediaFilename(null);
        setVisualMediaFile(null);
        setVisualMediaKind(null);
        return;
      }

      try {
        setIsVisualMediaPreviewLoading(true);
        objectUrl = URL.createObjectURL(selectedVisualAsset.fileBlob);
        if (cancelled) return;
        setVisualMediaUrl(objectUrl);
        setVisualMediaFilename(selectedVisualAsset.fileBlob.name);
        setVisualMediaFile(selectedVisualAsset.fileBlob);
        setVisualMediaKind(selectedVisualAsset.kind === "image" ? "image" : "video");
        setIsVisualMediaPreviewLoading(false);
      } catch (error) {
        console.error("Failed to load visual override preview", error);
        if (!cancelled) {
          setIsVisualMediaPreviewLoading(false);
          setVisualMediaUrl(null);
          setVisualMediaFilename(null);
          setVisualMediaFile(null);
          setVisualMediaKind(null);
        }
      }
    }

    void loadVisualMedia();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedVisualAsset, visualSourceMode]);

  useEffect(() => {
    setActiveSavedShortProjectId("");
    setDetachedShortSelection(null);
    setLocalRenderError(null);
    setLocalRenderDiagnostics(null);
    setExportProgressPct(0);
    setIsPlaying(false);
    setShortProjectNameDraft("");
    setSubtitleTimingMode("pair");
    setSubtitleStyleOverrides({});
    setShowSubtitles(true);
    setShowSafeZones(true);
    setIntroOverlay(getDefaultCreatorTextOverlayState("intro"));
    setOutroOverlay(getDefaultCreatorTextOverlayState("outro"));
    setReactiveOverlays([]);
    setSelectedReactiveOverlayId("");
    setVisualSourceMode("original");
    setVisualSourceAssetId("");
    setActiveSuggestionPreviewProjectId("");
  }, [selectedProject?.id]);

  const selectedVisualAssetFile = selectedVisualAsset?.fileBlob ?? null;
  const selectedVisualAssetFilename = selectedVisualAsset?.filename || selectedVisualAssetFile?.name || null;
  const selectedVisualAssetKind = selectedVisualAsset
    ? selectedVisualAsset.kind === "image"
      ? "image"
      : "video"
    : null;
  const selectedVisualOverrideFile = selectedVisualAssetFile ?? visualMediaFile;
  const selectedVisualOverrideFilename = selectedVisualAssetFilename ?? visualMediaFilename;
  const selectedVisualOverrideKind = selectedVisualAssetKind ?? visualMediaKind;
  const hasVisualOverride =
    visualSourceMode === "asset" && !!visualSourceAssetId && !!selectedVisualOverrideFile && !!selectedVisualOverrideKind;
  const resolvedVisualSourceUrl = hasVisualOverride ? visualMediaUrl : isVideoMedia ? mediaUrl : null;
  const resolvedVisualSourceFilename = hasVisualOverride ? selectedVisualOverrideFilename : mediaFilename;
  const resolvedVisualSourceFile = hasVisualOverride ? selectedVisualOverrideFile : isVideoMedia ? mediaFile : null;
  const resolvedVisualSourceKind = hasVisualOverride ? selectedVisualOverrideKind : isVideoMedia ? "video" : null;
  const isResolvedVisualVideo = resolvedVisualSourceKind === "video";
  const isResolvedVisualImage = resolvedVisualSourceKind === "image";
  const isResolvedVisualPreviewLoading =
    visualSourceMode === "asset" ? isVisualMediaPreviewLoading || (hasVisualOverride && !visualMediaUrl) : isMediaPreviewLoading;

  useEffect(() => {
    if (hubView !== "start") {
      setActiveSuggestionPreviewProjectId("");
    }
  }, [hubView]);

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

  const syncPreviewVisualToCurrentTime = useCallback(
    (absoluteTimeSeconds: number) => {
      if (!isResolvedVisualVideo || !editedClip) return;
      const video = previewVideoRef.current;
      if (!video) return;
      const targetTime = hasVisualOverride ? Math.max(0, absoluteTimeSeconds - editedClip.startSeconds) : absoluteTimeSeconds;
      if (Math.abs(video.currentTime - targetTime) > 0.2) {
        video.currentTime = targetTime;
      }
    },
    [editedClip, hasVisualOverride, isResolvedVisualVideo]
  );

  // Preview playback is driven by the original source audio timeline so subtitles and trim stay authoritative.
  const handleAudioTimeUpdate = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    syncPreviewVisualToCurrentTime(audio.currentTime);
  }, [syncPreviewVisualToCurrentTime]);
  const handleVideoLoadedMetadata = useCallback(() => {
    const video = previewVideoRef.current;
    setPreviewSourceSize({
      width: video?.videoWidth ?? 0,
      height: video?.videoHeight ?? 0,
    });
    const audio = previewAudioRef.current;
    if (audio) {
      syncPreviewVisualToCurrentTime(audio.currentTime);
    } else if (editedClip) {
      syncPreviewVisualToCurrentTime(editedClip.startSeconds);
    }
  }, [editedClip, syncPreviewVisualToCurrentTime]);
  const handlePreviewImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    setPreviewSourceSize({
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight,
    });
  }, []);
  const handleAudioPlay = useCallback(() => setIsPlaying(true), []);
  const handleAudioPause = useCallback(() => {
    const audio = previewAudioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
    }
    previewVideoRef.current?.pause();
    setIsPlaying(false);
  }, []);
  const handleAudioEnded = useCallback(() => {
    previewVideoRef.current?.pause();
    setIsPlaying(false);
  }, []);

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

  useEffect(() => {
    setPreviewSourceSize({ width: 0, height: 0 });
  }, [resolvedVisualSourceUrl]);

  // Seek preview media to clip start when clip or visual source changes.
  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!editedClip) return;
    if (audio) {
      audio.currentTime = editedClip.startSeconds;
    }
    syncPreviewVisualToCurrentTime(editedClip.startSeconds);
    setCurrentTime(editedClip.startSeconds);
  }, [editedClip, resolvedVisualSourceUrl, syncPreviewVisualToCurrentTime]);

  // Enforce clip boundaries during playback
  useEffect(() => {
    if (!editedClip || !isPlaying) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (currentTime >= editedClip.endSeconds) {
      audio.currentTime = editedClip.startSeconds;
      syncPreviewVisualToCurrentTime(editedClip.startSeconds);
    }
  }, [currentTime, editedClip, isPlaying, syncPreviewVisualToCurrentTime]);

  const togglePlayPause = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (editedClip && audio.currentTime >= editedClip.endSeconds) {
        audio.currentTime = editedClip.startSeconds;
      }
      syncPreviewVisualToCurrentTime(audio.currentTime);
      void audio.play();
      if (isResolvedVisualVideo) {
        const video = previewVideoRef.current;
        video?.play().catch(() => {});
      }
    } else {
      audio.pause();
      previewVideoRef.current?.pause();
    }
  }, [editedClip, isResolvedVisualVideo, syncPreviewVisualToCurrentTime]);

  const toggleMute = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  }, []);

  const selectedWordLevelSubtitleChunks = useMemo(() => {
    if (!selectedTranscript || !selectedSubtitle) return [];
    if (subtitleTimingMode === "segment" || selectedSubtitle.kind === "translation") return [];

    const sourceLanguage = (selectedSubtitle.sourceLanguage ?? selectedSubtitle.language ?? "").toLowerCase();
    const transcriptLanguage = (
      selectedTranscript.detectedLanguage ??
      selectedTranscript.requestedLanguage ??
      ""
    ).toLowerCase();
    if (!selectedTranscript.wordChunks?.length || !sourceLanguage || sourceLanguage !== transcriptLanguage) {
      return [];
    }

    const shiftedWordChunks =
      selectedSubtitle.shiftSeconds !== 0
        ? shiftSubtitleChunks(selectedTranscript.wordChunks, selectedSubtitle.shiftSeconds)
        : selectedTranscript.wordChunks;

    return buildPopCaptionChunks(shiftedWordChunks, subtitleTimingMode);
  }, [selectedSubtitle, selectedTranscript, subtitleTimingMode]);

  const effectiveSubtitleTimingMode = useMemo<CreatorSubtitleTimingMode>(() => {
    if (subtitleTimingMode !== "segment" && selectedWordLevelSubtitleChunks.length === 0) {
      return "segment";
    }
    return subtitleTimingMode;
  }, [selectedWordLevelSubtitleChunks.length, subtitleTimingMode]);

  const selectedClipSubtitleChunks = useMemo(() => {
    if (!editedClip || !selectedSubtitle) return [];
    const sourceChunks =
      effectiveSubtitleTimingMode === "segment"
        ? selectedSubtitle.chunks
        : selectedWordLevelSubtitleChunks;
    return clipSubtitleChunks(editedClip, sourceChunks);
  }, [editedClip, effectiveSubtitleTimingMode, selectedSubtitle, selectedWordLevelSubtitleChunks]);

  const activePreviewSubtitleChunk = useMemo(
    () => findSubtitleChunkAtTime(selectedClipSubtitleChunks, currentTime),
    [currentTime, selectedClipSubtitleChunks]
  );

  const resolvedSubtitleStyle = useMemo(() => {
    const fallback = selectedPlan?.editorPreset.subtitleStyle ?? "clean_caption";
    return resolveCreatorSubtitleStyle(fallback, subtitleStyleOverrides);
  }, [selectedPlan?.editorPreset.subtitleStyle, subtitleStyleOverrides]);

  const resolvedIntroOverlayStyle = useMemo(() => {
    return resolveCreatorTextOverlayStyle(
      getCreatorTextOverlayFallbackPreset("intro"),
      introOverlay.style
    );
  }, [introOverlay.style]);

  const resolvedOutroOverlayStyle = useMemo(() => {
    return resolveCreatorTextOverlayStyle(
      getCreatorTextOverlayFallbackPreset("outro"),
      outroOverlay.style
    );
  }, [outroOverlay.style]);

  const currentEditorState = useMemo<CreatorShortEditorState>(
    () => ({
      zoom,
      panX,
      panY: 0,
      subtitleScale,
      subtitleXPositionPct,
      subtitleYOffsetPct,
      subtitleTimingMode,
      showSubtitles,
      subtitleStyle: subtitleStyleOverrides,
      showSafeZones,
      introOverlay,
      outroOverlay,
      reactiveOverlays,
      visualSource:
        hasVisualOverride && selectedVisualOverrideKind && visualSourceAssetId
          ? {
              mode: "asset",
              assetId: visualSourceAssetId,
              kind: selectedVisualOverrideKind,
            }
          : {
              mode: "original",
            },
    }),
    [
      hasVisualOverride,
      introOverlay,
      outroOverlay,
      panX,
      reactiveOverlays,
      showSafeZones,
      showSubtitles,
      subtitleScale,
      subtitleStyleOverrides,
      subtitleTimingMode,
      subtitleXPositionPct,
      subtitleYOffsetPct,
      selectedVisualOverrideKind,
      visualSourceAssetId,
      zoom,
    ]
  );
  const shortPanLimits = useMemo(() => {
    if (previewSourceSize.width <= 0 || previewSourceSize.height <= 0) {
      return { minPanX: -600, maxPanX: 600, minPanY: 0, maxPanY: 0 };
    }

    return resolveShortFramePanLimits({
      sourceWidth: previewSourceSize.width,
      sourceHeight: previewSourceSize.height,
      frameWidth: 1080,
      frameHeight: 1920,
      zoom,
      panX: 0,
      panY: 0,
    });
  }, [previewSourceSize.height, previewSourceSize.width, zoom]);

  useEffect(() => {
    setPanX((current) => clampNumber(current, shortPanLimits.minPanX, shortPanLimits.maxPanX));
  }, [shortPanLimits.maxPanX, shortPanLimits.minPanX]);

  const previewFrameScale = previewFrameSize.width > 0 ? previewFrameSize.width / 1080 : 1;
  const previewVideoLayout = useMemo(() => {
    if (
      !resolvedVisualSourceKind ||
      previewFrameSize.width <= 0 ||
      previewFrameSize.height <= 0 ||
      previewSourceSize.width <= 0 ||
      previewSourceSize.height <= 0
    ) {
      return null;
    }

    const scaledPan = scaleShortFramePanToViewport({
      panX,
      panY: 0,
      viewportWidth: previewFrameSize.width,
      viewportHeight: previewFrameSize.height,
    });

    return resolveShortFrameLayout({
      sourceWidth: previewSourceSize.width,
      sourceHeight: previewSourceSize.height,
      frameWidth: previewFrameSize.width,
      frameHeight: previewFrameSize.height,
      zoom,
      panX: scaledPan.panX,
      panY: 0,
    });
  }, [
    panX,
    previewFrameSize.height,
    previewFrameSize.width,
    previewSourceSize.height,
    previewSourceSize.width,
    resolvedVisualSourceKind,
    zoom,
  ]);
  const previewVideoStyle = useMemo(
    () => (previewVideoLayout ? buildShortPreviewStyle(previewVideoLayout) : null),
    [previewVideoLayout]
  );

  useEffect(() => {
    if (!activeSavedShortProject) return;
    setShortProjectNameDraft(activeSavedShortProject.origin === "ai_suggestion" ? "" : activeSavedShortProject.name || "");
  }, [activeSavedShortProject]);

  const autoGeneratedShortProjectName = useMemo(() => {
    if (!editedClip || !selectedPlan) return "";
    return `${secondsToClock(editedClip.startSeconds)} - ${secondsToClock(editedClip.endSeconds)}`;
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

  const updateTextOverlay = useCallback(
    (
      slot: CreatorTextOverlaySlot,
      updater: (prev: CreatorTextOverlayState) => CreatorTextOverlayState
    ) => {
      if (slot === "intro") {
        setIntroOverlay((prev) => updater(prev));
        return;
      }
      setOutroOverlay((prev) => updater(prev));
    },
    []
  );

  const resetTextOverlayToSuggestion = useCallback(
    (slot: CreatorTextOverlaySlot) => {
      if (!selectedPlan || !editedClip) return;
      const next = getDefaultCreatorTextOverlayState(slot, {
        origin: "ai_suggestion",
        plan: selectedPlan,
        clipDurationSeconds: editedClip.durationSeconds,
      });
      updateTextOverlay(slot, () => next);
    },
    [editedClip, selectedPlan, updateTextOverlay]
  );

  useEffect(() => {
    if (reactiveOverlays.length === 0) {
      if (selectedReactiveOverlayId) {
        setSelectedReactiveOverlayId("");
      }
      return;
    }
    if (!reactiveOverlays.some((overlay) => overlay.id === selectedReactiveOverlayId)) {
      setSelectedReactiveOverlayId(reactiveOverlays[0]?.id ?? "");
    }
  }, [reactiveOverlays, selectedReactiveOverlayId]);

  const selectedReactiveOverlay = useMemo(
    () => reactiveOverlays.find((overlay) => overlay.id === selectedReactiveOverlayId),
    [reactiveOverlays, selectedReactiveOverlayId]
  );

  const updateReactiveOverlay = useCallback(
    (overlayId: string, updater: (prev: CreatorReactiveOverlayItem) => CreatorReactiveOverlayItem) => {
      setReactiveOverlays((current) =>
        current.map((overlay) => (overlay.id === overlayId ? updater(overlay) : overlay))
      );
    },
    []
  );

  const addReactiveOverlay = useCallback(
    (presetId: CreatorReactiveOverlayPresetId) => {
      const clipDuration = editedClip?.durationSeconds ?? 3;
      const startOffsetSeconds = editedClip ? Math.max(0, currentTime - editedClip.startSeconds) : 0;
      const nextOverlay = createDefaultCreatorReactiveOverlay({
        id: makeId("rxov"),
        presetId,
        startOffsetSeconds,
        durationSeconds: Math.min(4, Math.max(1.4, clipDuration - startOffsetSeconds || clipDuration)),
      });
      setReactiveOverlays((current) => [...current, nextOverlay]);
      setSelectedReactiveOverlayId(nextOverlay.id);
    },
    [currentTime, editedClip]
  );

  const removeReactiveOverlay = useCallback((overlayId: string) => {
    setReactiveOverlays((current) => current.filter((overlay) => overlay.id !== overlayId));
    setSelectedReactiveOverlayId((current) => (current === overlayId ? "" : current));
  }, []);

  useEffect(() => {
    if (!mediaFile || !editedClip || reactiveOverlays.length === 0) {
      setReactiveOverlayAnalysis(null);
      return;
    }

    let canceled = false;
    const cacheKey = `${mediaFile.name}:${mediaFile.size}:${mediaFile.lastModified}`;

    const loadAnalysis = async () => {
      try {
        let decoded = reactiveOverlayDecodedAudioCacheRef.current.get(cacheKey);
        if (!decoded) {
          const { decodeAudio } = await import("@/lib/audio");
          decoded = await decodeAudio(mediaFile);
          reactiveOverlayDecodedAudioCacheRef.current.set(cacheKey, decoded);
        }
        if (canceled) return;
        setReactiveOverlayAnalysis(
          buildCreatorReactiveOverlayAudioAnalysis({
            clipStartSeconds: editedClip.startSeconds,
            clipDurationSeconds: editedClip.durationSeconds,
            decodedSamples: decoded,
          })
        );
      } catch (error) {
        if (canceled) return;
        console.error("Failed to prepare reactive overlay analysis", error);
        setReactiveOverlayAnalysis(null);
      }
    };

    void loadAnalysis();

    return () => {
      canceled = true;
    };
  }, [editedClip, mediaFile, reactiveOverlays]);

  const savedExportsForActiveShort = useMemo(
    () => (activeSavedShortProject ? exportsByProjectId.get(activeSavedShortProject.id) ?? [] : []),
    [activeSavedShortProject, exportsByProjectId]
  );

  const selectedVideoInfoBlocks = useMemo(() => new Set(videoInfoBlocks), [videoInfoBlocks]);
  const showTitleIdeas = selectedVideoInfoBlocks.has("titleIdeas");
  const showDescription = selectedVideoInfoBlocks.has("description");
  const showPinnedComment = selectedVideoInfoBlocks.has("pinnedComment");
  const showHashtags = selectedVideoInfoBlocks.has("hashtags");
  const showThumbnailHooks = selectedVideoInfoBlocks.has("thumbnailHooks");
  const showChapters = selectedVideoInfoBlocks.has("chapters");
  const showContentPack = selectedVideoInfoBlocks.has("contentPack");
  const showInsights = selectedVideoInfoBlocks.has("insights");
  const currentShortTaskProjectId = selectedProjectRootId || selectedProject?.id;
  const activeShortExportTask =
    currentShortTaskProjectId == null
      ? undefined
      : activeTasks.find(
          (task) => task.kind === "short-export" && task.scope.projectId === currentShortTaskProjectId
        );
  const isActiveShortExportTask = Boolean(activeShortExportTask && isBackgroundTaskActive(activeShortExportTask));
  shortExportHeartbeatStatusRef.current = activeShortExportTask?.status ?? "idle";
  shortExportHeartbeatProgressRef.current = Math.round(activeShortExportTask?.progress ?? exportProgressPct);

  const resolvedShortsProvider = shortsFeatureSettings?.provider ?? shortsAiConfig?.provider ?? "gemini";
  const resolvedShortsModel = useMemo(() => {
    const savedModel = shortsFeatureSettings?.model;
    if (savedModel && shortsAiConfig?.models.some((option) => option.value === savedModel)) {
      return savedModel;
    }
    return shortsAiConfig?.defaultModel ?? savedModel ?? "";
  }, [shortsAiConfig?.defaultModel, shortsAiConfig?.models, shortsFeatureSettings?.model]);
  const resolvedVideoInfoProvider = videoInfoFeatureSettings?.provider ?? videoInfoAiConfig?.provider ?? "gemini";
  const resolvedVideoInfoModel = useMemo(() => {
    const savedModel = videoInfoFeatureSettings?.model;
    if (savedModel && videoInfoAiConfig?.models.some((option) => option.value === savedModel)) {
      return savedModel;
    }
    return videoInfoAiConfig?.defaultModel ?? savedModel ?? "";
  }, [videoInfoAiConfig?.defaultModel, videoInfoAiConfig?.models, videoInfoFeatureSettings?.model]);
  useEffect(() => {
    if (!videoInfoAiConfig?.defaultModel) return;
    if (videoInfoFeatureSettings?.provider !== videoInfoAiConfig.provider) return;
    const savedModel = videoInfoFeatureSettings?.model;
    if (savedModel && videoInfoAiConfig.models.some((option) => option.value === savedModel)) return;
    saveFeatureModel("video_info", videoInfoAiConfig.defaultModel, videoInfoAiConfig.provider);
  }, [
    saveFeatureModel,
    videoInfoAiConfig?.defaultModel,
    videoInfoAiConfig?.models,
    videoInfoAiConfig?.provider,
    videoInfoFeatureSettings?.model,
    videoInfoFeatureSettings?.provider,
  ]);
  const activeToolProvider: CreatorLLMProvider =
    activeTool === "video_info" ? resolvedVideoInfoProvider : resolvedShortsProvider;
  const activeToolModel = activeTool === "video_info" ? resolvedVideoInfoModel : resolvedShortsModel;
  const videoInfoApiKeySource =
    videoInfoAiConfig?.provider === resolvedVideoInfoProvider && videoInfoAiConfig.hasApiKey
      ? videoInfoAiConfig.apiKeySource
      : undefined;
  const shortsApiKeySource =
    shortsAiConfig?.provider === resolvedShortsProvider && shortsAiConfig.hasApiKey ? shortsAiConfig.apiKeySource : undefined;
  const openAIApiKeySource =
    resolvedVideoInfoProvider === "openai"
      ? videoInfoApiKeySource
      : resolvedShortsProvider === "openai"
        ? shortsApiKeySource
        : undefined;
  const geminiApiKeySource =
    resolvedVideoInfoProvider === "gemini"
      ? videoInfoApiKeySource
      : resolvedShortsProvider === "gemini"
        ? shortsApiKeySource
        : undefined;
  const activeToolApiKeySource = activeTool === "video_info" ? videoInfoApiKeySource : shortsApiKeySource;
  const hasActiveProviderApiKey = Boolean(activeToolApiKeySource);
  const maskedActiveProviderApiKey =
    activeToolProvider === "openai" && activeToolApiKeySource === "header"
      ? maskedOpenAIApiKey
      : activeToolProvider === "gemini" && activeToolApiKeySource === "header"
        ? maskedGeminiApiKey
        : null;

  const canAnalyze = !!selectedProject && !!selectedTranscript && !!selectedSubtitle && !!selectedTranscript.transcript;
  const canAnalyzeWithAI = canAnalyze && hasActiveProviderApiKey;
  const canRender = !!selectedProject && !!selectedTranscript && !!selectedSubtitle && !!editedClip && !!selectedPlan;
  const canExportShort =
    canRender && !!mediaFile && !!resolvedVisualSourceFile && !!resolvedVisualSourceKind && !isActiveShortExportTask;
  const canCancelShortExport =
    Boolean(activeShortExportTask?.canCancel) &&
    (isActiveShortExportTask || isBrowserRenderCancelableStage(shortExportStage));

  useEffect(() => {
    if (!isActiveShortExportTask || !shortExportLogStartedAtRef.current) return;

    const timerId = window.setInterval(() => {
      appendShortExportLog(
        `Heartbeat: stage=${shortExportHeartbeatStageRef.current}, task=${shortExportHeartbeatStatusRef.current}, progress=${shortExportHeartbeatProgressRef.current}%.`
      );
    }, 4000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [appendShortExportLog, isActiveShortExportTask, activeShortExportTask?.id]);
  const activeAnalysisMeta = activeTool === "video_info" ? videoInfoAnalysis : shortsAnalysis;
  const isAnalyzing = activeTool === "video_info" ? isGeneratingVideoInfo : isGeneratingShorts;
  const analyzeError = activeTool === "video_info" ? videoInfoError : shortsError;
  const analyzeErrorDetails = getAnalyzeErrorDetails(analyzeError);
  const activeEditableShortProjectId = shouldReuseShortProjectId(activeSavedShortProject);
  const hasAiReferenceMetadata = activeSavedShortProject?.origin === "ai_suggestion";

  const creatorSourcePayload = useMemo<CreatorGenerationSourceInput | null>(() => {
    if (!selectedProject || !selectedTranscript || !selectedSubtitle || !selectedTranscript.transcript) return null;

    return {
      projectId: selectedProjectRootId || selectedProject.id,
      sourceAssetId: selectedSourceAssetId || selectedProject.id,
      transcriptId: selectedTranscript.id,
      subtitleId: selectedSubtitle.id,
      transcriptText: selectedTranscript.transcript,
      transcriptChunks: selectedTranscript.chunks ?? [],
      subtitleChunks: selectedSubtitle.chunks,
      transcriptVersionLabel: selectedTranscript.label,
      subtitleVersionLabel: selectedSubtitle.label,
    };
  }, [selectedProject, selectedProjectRootId, selectedSourceAssetId, selectedSubtitle, selectedTranscript]);

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

  const shortsRequestPayload = useMemo<CreatorShortsGenerateRequest | null>(() => {
    if (!creatorSourcePayload) return null;
    return {
      ...creatorSourcePayload,
      sourceSignature: aiSuggestionSourceSignature || undefined,
      niche,
      audience,
      tone,
      generationConfig: {
        provider: resolvedShortsProvider,
        model: resolvedShortsModel || undefined,
      },
    };
  }, [aiSuggestionSourceSignature, audience, creatorSourcePayload, niche, resolvedShortsModel, resolvedShortsProvider, tone]);

  const videoInfoRequestPayload = useMemo<CreatorVideoInfoGenerateRequest | null>(() => {
    if (!creatorSourcePayload) return null;
    return {
      ...creatorSourcePayload,
      videoInfoBlocks,
      generationConfig: {
        provider: resolvedVideoInfoProvider,
        model: resolvedVideoInfoModel || undefined,
      },
    };
  }, [creatorSourcePayload, resolvedVideoInfoModel, resolvedVideoInfoProvider, videoInfoBlocks]);

  const matchingAiSuggestionGenerations = useMemo(() => {
    if (!aiSuggestionSourceSignature) return [];
    return aiSuggestionsByGeneration.filter((group) => group.sourceSignature === aiSuggestionSourceSignature);
  }, [aiSuggestionSourceSignature, aiSuggestionsByGeneration]);

  const resolveAiSuggestionTranscriptPreview = useCallback(
    (project: CreatorShortProjectRecord) => {
      if (selectedSubtitle && project.subtitleId === selectedSubtitle.id) {
        return summarizeClipText(project.clip, selectedSubtitle.chunks, 200);
      }
      return project.clip.reason;
    },
    [selectedSubtitle]
  );

  const handleToggleAiSuggestionPreview = useCallback((projectId: string) => {
    setActiveSuggestionPreviewProjectId((currentId) => getNextActiveShortPreviewId(currentId, projectId));
  }, []);

  const defaultAiSuggestionEditorState = useMemo<CreatorShortEditorState>(
    () => ({
      zoom: 1.15,
      panX: 0,
      panY: 0,
      subtitleScale: 1,
      subtitleXPositionPct: 50,
      subtitleYOffsetPct: 78,
      subtitleTimingMode: "pair",
      showSubtitles: true,
      subtitleStyle: {},
      showSafeZones: true,
      visualSource: {
        mode: "original",
      },
    }),
    []
  );

  const openAiSettingsDialog = useCallback(() => {
    setOpenAIApiKeyDraft(openAIApiKey);
    setGeminiApiKeyDraft(geminiApiKey);
    setIsAiSettingsOpen(true);
  }, [geminiApiKey, openAIApiKey]);

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

  const handleSaveGeminiApiKey = useCallback(() => {
    const trimmed = geminiApiKeyDraft.trim();
    if (!trimmed) {
      toast.error("Paste a Gemini API key first.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }

    saveGeminiApiKey(trimmed);
    setIsAiSettingsOpen(false);
    toast.success("Gemini key saved in this browser.", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  }, [geminiApiKeyDraft, saveGeminiApiKey]);

  const handleClearOpenAIApiKey = useCallback(() => {
    clearOpenAIApiKey();
    setOpenAIApiKeyDraft("");
    toast.success("OpenAI key removed from this browser.", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  }, [clearOpenAIApiKey]);

  const handleClearGeminiApiKey = useCallback(() => {
    clearGeminiApiKey();
    setGeminiApiKeyDraft("");
    toast.success("Gemini key removed from this browser.", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  }, [clearGeminiApiKey]);

  const handleGenerateVideoInfo = async () => {
    if (!videoInfoRequestPayload) return;
    if (!hasActiveProviderApiKey && activeTool === "video_info") {
      openAiSettingsDialog();
      toast.error(`Add your ${getCreatorProviderLabel(resolvedVideoInfoProvider)} API key to generate video info.`, {
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
      const result = await generateVideoInfo(videoInfoRequestPayload, { headers: creatorProviderHeaders });
      toast.success(`Video info generated (${result.providerMode})`, {
        className: "bg-green-500/20 border-green-500/50 text-green-100",
      });
    } catch (error) {
      console.error(error);
    } finally {
      void refreshLlmRuns();
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
    if (!shortsAiConfig?.hasApiKey && resolvedShortsProvider === "gemini") {
      openAiSettingsDialog();
      toast.error("Add your Gemini API key or set GEMINI_API_KEY on the server.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    if (!shortsAiConfig?.hasApiKey && resolvedShortsProvider === "openai") {
      openAiSettingsDialog();
      toast.error("Add your OpenAI API key or set OPENAI_API_KEY on the server.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    try {
      const result = await generateShorts(shortsRequestPayload, { headers: creatorProviderHeaders });
      const savedCount = await persistAiSuggestionGeneration(result);
      toast.success(`Clip lab generated (${result.providerMode})`, {
        className: "bg-green-500/20 border-green-500/50 text-green-100",
        description: savedCount > 0 ? `${savedCount} AI suggestion${savedCount === 1 ? "" : "s"} saved locally.` : undefined,
      });
    } catch (error) {
      console.error(error);
    } finally {
      void refreshLlmRuns();
    }
  }, [
    creatorProviderHeaders,
    generateShorts,
    openAiSettingsDialog,
    persistAiSuggestionGeneration,
    refreshLlmRuns,
    resolvedShortsProvider,
    shortsAiConfig?.hasApiKey,
    shortsRequestPayload,
  ]);

  const handleGenerateClipLab = async () => {
    if (matchingAiSuggestionGenerations.length > 0 || hasAiSuggestionsForSignature(aiSuggestionSourceSignature)) {
      setIsRegenerateAiSuggestionsDialogOpen(true);
      return;
    }

    await runClipLabGeneration();
  };

  const handleOpenAiMagicClips = () => {
    if (isGeneratingShorts) return;
    void handleGenerateClipLab();
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
    if (!activeShortExportTask?.canCancel) return;
    cancelTask(activeShortExportTask.id);
  }, [activeShortExportTask, cancelTask]);

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

  const handleUploadVisualAsset = useCallback(
    async (file: File) => {
      if (!selectedProjectRootId) {
        toast.error("Select a project source before uploading replacement media.", {
          className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
        });
        return;
      }

      try {
        const metadata = await readMediaMetadata(file);
        if (metadata.kind !== "video" && metadata.kind !== "image") {
          throw new Error("Replacement media must be a video or image file.");
        }

        const now = Date.now();
        const asset = createEditorAssetRecord({
          projectId: selectedProjectRootId,
          role: "support",
          origin: "manual",
          kind: metadata.kind,
          filename: file.name,
          mimeType:
            file.type ||
            (metadata.kind === "video" ? "video/mp4" : "image/png"),
          sizeBytes: file.size,
          durationSeconds: metadata.durationSeconds,
          width: metadata.width,
          height: metadata.height,
          hasAudio: metadata.hasAudio,
          sourceType: "upload",
          captionSource: { kind: "none" },
          fileBlob: file,
          now,
        }) as ProjectAssetRecord;

        await db.transaction("rw", db.projects, db.projectAssets, async () => {
          await db.projectAssets.put(asset);
          const projectRecord = await db.projects.get(selectedProjectRootId);
          if (projectRecord) {
            await db.projects.put({
              ...projectRecord,
              assetIds: projectRecord.assetIds.includes(asset.id) ? projectRecord.assetIds : [...projectRecord.assetIds, asset.id],
              updatedAt: now,
            });
          }
        });

        setProjectVisualAssets((prev) => [asset, ...prev.filter((item) => item.id !== asset.id)]);
        setVisualSourceMode("asset");
        setVisualSourceAssetId(asset.id);
        await onProjectAssetsChanged?.();
        toast.success(`${metadata.kind === "image" ? "Image" : "Video"} added as visual source`, {
          className: "bg-green-500/20 border-green-500/50 text-green-100",
        });
      } catch (error) {
        console.error(error);
        toast.error(error instanceof Error ? error.message : "Failed to upload replacement media.", {
          className: "bg-red-500/20 border-red-500/50 text-red-100",
        });
      }
    },
    [onProjectAssetsChanged, selectedProjectRootId]
  );

  const handleVisualAssetFileChange = useCallback(
    async (event: SyntheticEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      await handleUploadVisualAsset(file);
    },
    [handleUploadVisualAsset]
  );

  const applySavedShortProject = useCallback((project: CreatorShortProjectRecord) => {
    const hydratedEditor = hydrateCreatorShortEditorState(project.editor, {
      origin: project.origin,
      plan: project.plan,
      clipDurationSeconds: project.clip.durationSeconds,
    });
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
    setZoom(clampShortZoomForUi(hydratedEditor.zoom));
    setPanX(hydratedEditor.panX);
    setSubtitleScale(hydratedEditor.subtitleScale);
    setSubtitleXPositionPct(hydratedEditor.subtitleXPositionPct ?? 50);
    setSubtitleYOffsetPct(hydratedEditor.subtitleYOffsetPct);
    setSubtitleTimingMode(hydratedEditor.subtitleTimingMode ?? "pair");
    setSubtitleStyleOverrides(resolveCreatorSubtitleStyle(project.plan.editorPreset.subtitleStyle, hydratedEditor.subtitleStyle));
    setShowSubtitles(hydratedEditor.showSubtitles ?? true);
    setShowSafeZones(hydratedEditor.showSafeZones ?? true);
    setIntroOverlay(hydratedEditor.introOverlay ?? getDefaultCreatorTextOverlayState("intro"));
    setOutroOverlay(hydratedEditor.outroOverlay ?? getDefaultCreatorTextOverlayState("outro"));
    setReactiveOverlays(hydratedEditor.reactiveOverlays ?? []);
    setSelectedReactiveOverlayId(hydratedEditor.reactiveOverlays?.[0]?.id ?? "");
    setVisualSourceMode(hydratedEditor.visualSource?.mode === "asset" ? "asset" : "original");
    setVisualSourceAssetId(hydratedEditor.visualSource?.mode === "asset" ? hydratedEditor.visualSource.assetId ?? "" : "");
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
    if (!resolvedVisualSourceFile || !resolvedVisualSourceKind) {
      toast.error("Short export requires a visual source. Use the original video or add a replacement image/video.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    if (activeShortExportTask) {
      toast("A short export is already running for this project.");
      return;
    }

    startShortExport({
      projectId: currentShortTaskProjectId || selectedProject.id,
      title: `Exporting ${selectedPlan.title}`,
      message: `${secondsToClock(editedClip.startSeconds)} → ${secondsToClock(editedClip.endSeconds)}`,
      run: async (task) => {
        shortExportTaskLogSyncRef.current = {
          taskId: task.taskId,
          sync: (lines) => {
            task.update({ logLines: lines });
          },
        };
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
        beginShortExportLogSession(
          `Export started for ${mediaFilename || selectedProject.filename} with ${resolvedVisualSourceFilename || "original visual"}: ${secondsToClock(editedClip.startSeconds)} -> ${secondsToClock(editedClip.endSeconds)}.`
        );
        shortExportHeartbeatStageRef.current = session.stage;
        task.update({
          status: "preparing",
          progress: 1,
          message: "Preparing short export",
        });
        task.setCancel(() => {
          if (!isBrowserRenderCancelableStage(session.stage)) return;
          appendShortExportLog("Cancel requested by user.");
          session.controller.abort();
          shortExportSessionRef.current = null;
          setIsExportingShort(false);
          setShortExportStage("preparing");
          setExportProgressPct(0);
          persistCanceledShortExportRestore();
          shortExportRestoreSnapshotRef.current = null;
          toast("Export canceled");
        });

        const bumpExportProgress = (nextPct: number) => {
          setExportProgressPct((prev) => {
            const next = Math.round(clampNumber(nextPct, 0, 100));
            if (next <= prev) return prev;
            shortExportHeartbeatProgressRef.current = next;
            task.update({
              status: next >= 96 ? "finalizing" : "running",
              progress: next,
              message: next >= 96 ? "Finalizing short export" : "Rendering short export",
            });
            const minDelta = next >= 80 ? 2 : 5;
            if (
              next === 100 ||
              shortExportLastLoggedProgressRef.current < 0 ||
              next >= shortExportLastLoggedProgressRef.current + minDelta
            ) {
              appendShortExportLog(`Progress ${next}%.`);
              shortExportLastLoggedProgressRef.current = next;
            }
            return next;
          });
        };

        let visualSourceMeta: { width: number; height: number; durationSeconds?: number } | null = null;
        let exportClip = editedClip;
        let exportSubtitleChunks = selectedClipSubtitleChunks;
        const buildDiagnosticsSnapshot = (errorMessage?: string) =>
          buildShortExportDiagnostics({
            sourceFilename:
              `${mediaFilename || selectedProject.filename}` +
              (resolvedVisualSourceFilename ? ` [visual:${resolvedVisualSourceFilename}]` : ""),
            requestedClip: editedClip,
            exportClip,
            sourceMeta: visualSourceMeta,
            selectedSubtitleChunkCount: selectedClipSubtitleChunks.length,
            exportSubtitleChunkCount: exportSubtitleChunks.length,
            stylePreset: resolvedSubtitleStyle.preset,
            errorMessage,
          });

        try {
          appendShortExportLog("Reading visual source metadata.");
          const visualMetadata = await readMediaMetadata(resolvedVisualSourceFile);
          if ((visualMetadata.kind !== "video" && visualMetadata.kind !== "image") || !visualMetadata.width || !visualMetadata.height) {
            throw new Error("Visual source is missing dimensions.");
          }
          visualSourceMeta = {
            width: visualMetadata.width,
            height: visualMetadata.height,
            durationSeconds: visualMetadata.durationSeconds,
          };
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;
          appendShortExportLog(
            `Visual metadata ready: ${visualSourceMeta.width}x${visualSourceMeta.height}, duration=${visualSourceMeta.durationSeconds?.toFixed(2) ?? "unknown"}s (${resolvedVisualSourceKind}).`
          );
          const prepared = prepareShortExport({
            requestedClip: editedClip,
            allSubtitleChunks:
              effectiveSubtitleTimingMode === "segment"
                ? selectedSubtitle.chunks
                : selectedWordLevelSubtitleChunks,
            sourceDurationSeconds,
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

          task.update({
            status: "preparing",
            progress: 8,
            message: "Preparing short export",
          });
          appendShortExportLog(
            `Prepared clip ${exportClip.startSeconds.toFixed(2)}s -> ${exportClip.endSeconds.toFixed(2)}s with ${exportSubtitleChunks.length} subtitle chunk(s).`
          );
          console.info("[ShortExport] diagnostics pre-render\n" + buildDiagnosticsSnapshot());
        } catch (metadataError) {
          if (isBrowserRenderCanceledError(metadataError) || session.controller.signal.aborted || task.isCanceled()) {
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
          appendShortExportLog(`Metadata preparation failed: ${message}.`);
          setLocalRenderError(message);
          setLocalRenderDiagnostics(buildDiagnosticsSnapshot(message));
          toast.error(message, {
            className: "bg-red-500/20 border-red-500/50 text-red-100",
          });
          throw new Error(message);
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
          throw new Error("Short export could not be prepared.");
        }

        try {
          await upsertProject(shortProjectRecord);
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;
          appendShortExportLog(`Saved export snapshot for short project ${shortProjectRecord.id}.`);
          setActiveSavedShortProjectId(shortProjectRecord.id);
          setDetachedShortSelection({ clip: shortProjectRecord.clip, plan: shortProjectRecord.plan });
          setShortProjectNameDraft(shortProjectRecord.name);

          const sourceVideoSize = visualSourceMeta
            ? { width: visualSourceMeta.width, height: visualSourceMeta.height }
            : (() => {
                throw new Error("Visual source metadata is unavailable.");
              })();
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;
          appendShortExportLog(
            `Starting system export request with canonical short framing ${sourceVideoSize.width}x${sourceVideoSize.height} -> 1080x1920.`
          );

          const systemExport = await requestSystemCreatorShortExport({
            sourceFile: mediaFile,
            sourceFilename: mediaFilename || selectedProject.filename,
            visualSourceFile: hasVisualOverride ? resolvedVisualSourceFile : null,
            visualSourceKind: hasVisualOverride ? resolvedVisualSourceKind ?? undefined : undefined,
            shortName: shortProjectRecord.name,
            clip: exportClip,
            plan: selectedPlan,
            subtitleChunks: exportSubtitleChunks,
            editor: currentEditorState,
            sourceVideoSize,
            onProgress: bumpExportProgress,
            onDebugLog: appendShortExportLog,
            renderLifecycle: {
              signal: session.controller.signal,
              onStageChange: (stage) => {
                syncShortExportStage(session.id, stage);
                task.update({
                  status:
                    stage === "preparing"
                      ? "preparing"
                      : stage === "rendering"
                        ? "running"
                        : "finalizing",
                  progress: stage === "handoff" ? 96 : undefined,
                  message:
                    stage === "handoff" || stage === "complete"
                      ? "Finalizing short export"
                      : "Rendering short export",
                });
              },
            },
          });
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;
          appendShortExportLog(
            `Render complete: mode=${systemExport.renderModeUsed}, encoder=${systemExport.encoderUsed}, size=${formatBytes(systemExport.file.size)}.`
          );
          if (systemExport.timingsMs) {
            appendShortExportLog(
              `Timing summary: client=${systemExport.timingsMs.client?.total ?? 0}ms, server=${systemExport.timingsMs.server?.total ?? 0}ms, ffmpeg=${systemExport.timingsMs.server?.ffmpeg ?? 0}ms.`
            );
          }
          bumpExportProgress(97);
          const now = Date.now();
          const outputAsset = createEditorAssetRecord({
            projectId: currentShortTaskProjectId || selectedProject.id,
            role: "derived",
            origin: "short-export",
            derivedFromAssetId: selectedSourceAssetId || selectedProject.id,
            kind: "video",
            filename: systemExport.file.name,
            mimeType: systemExport.file.type || "video/mp4",
            sizeBytes: systemExport.file.size,
            durationSeconds: systemExport.durationSeconds || exportClip.durationSeconds,
            width: systemExport.width,
            height: systemExport.height,
            hasAudio: true,
            sourceType: "upload",
            captionSource: { kind: "none" },
            fileBlob: systemExport.file,
            now,
          });

          await db.transaction("rw", db.projects, db.projectAssets, async () => {
            await db.projectAssets.put(outputAsset);
            const rootProject = await db.projects.get(currentShortTaskProjectId || selectedProject.id);
            if (rootProject) {
              await db.projects.put({
                ...rootProject,
                assetIds: [...rootProject.assetIds, outputAsset.id],
                updatedAt: now,
                lastOpenedAt: now,
              });
            }
          });
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;

          const exportRecord = buildCompletedShortExportRecord({
            id: makeId("shortexport"),
            shortProjectId: shortProjectRecord.id,
            shortProjectName: shortProjectRecord.name,
            projectId: currentShortTaskProjectId || selectedProject.id,
            sourceAssetId: selectedSourceAssetId || selectedProject.id,
            outputAssetId: outputAsset.id,
            sourceFilename: mediaFilename || selectedProject.filename,
            plan: selectedPlan,
            clip: exportClip,
            editor: currentEditorState,
            createdAt: now,
            filename: systemExport.file.name,
            mimeType: systemExport.file.type || "video/mp4",
            sizeBytes: systemExport.file.size,
            fileBlob: systemExport.file,
            debugFfmpegCommand: systemExport.ffmpegCommandPreview,
            debugNotes: systemExport.notes,
            renderModeUsed: systemExport.renderModeUsed,
            encoderUsed: systemExport.encoderUsed,
            timingsMs: systemExport.timingsMs,
            counts: systemExport.counts,
          });

          await upsertExport(exportRecord);
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;
          bumpExportProgress(98);

          shortProjectRecord = markShortProjectExported(shortProjectRecord, {
            now: Date.now(),
            exportId: exportRecord.id,
          });
          await upsertProject(shortProjectRecord);
          if (shortExportSessionRef.current?.id !== session.id || task.isCanceled()) return;
          bumpExportProgress(99);

          const renderResult = buildCompletedCreatorShortRenderResponse({
            providerMode: "system",
            jobId: exportRecord.id,
            createdAt: exportRecord.createdAt,
            filename: exportRecord.filename,
            subtitleBurnedIn: systemExport.subtitleBurnedIn,
            ffmpegCommandPreview: systemExport.ffmpegCommandPreview,
            notes: systemExport.notes,
            durationSeconds: systemExport.durationSeconds,
            renderModeUsed: systemExport.renderModeUsed,
            encoderUsed: systemExport.encoderUsed,
            timingsMs: systemExport.timingsMs,
            counts: systemExport.counts,
          });
          syncShortExportStage(session.id, "complete");
          setLastRender(renderResult);
          appendShortExportLog("Export saved to the library and download started.");

          handleDownloadSavedExport(exportRecord);
          bumpExportProgress(100);
          task.update({
            status: "finalizing",
            progress: 100,
            message: "Saving short export",
          });
          toast.success(`Short exported and saved (${formatBytes(exportRecord.sizeBytes)})`, {
            className: "bg-green-500/20 border-green-500/50 text-green-100",
          });
        } catch (error) {
          if (isBrowserRenderCanceledError(error) || session.controller.signal.aborted || task.isCanceled()) {
            return;
          }

          console.error(error);
          const rawMessage = error instanceof Error ? error.message : "Short export failed";
          const toastMessage = rawMessage.split("\n")[0] || "Short export failed";
          appendShortExportLog(`Export failed: ${toastMessage}.`);
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
          throw error instanceof Error ? error : new Error(toastMessage);
        } finally {
          if (shortExportTaskLogSyncRef.current?.taskId === task.taskId) {
            shortExportTaskLogSyncRef.current = null;
          }
          if (shortExportSessionRef.current?.id === session.id) {
            shortExportSessionRef.current = null;
            shortExportRestoreSnapshotRef.current = null;
            setIsExportingShort(false);
            setShortExportStage("preparing");
          }
        }
      },
    });
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

  const clipRelativeTime = useMemo(() => {
    if (!editedClip) return 0;
    return Math.max(0, currentTime - editedClip.startSeconds);
  }, [currentTime, editedClip]);

  const resolvedIntroOverlayWindow = useMemo(() => {
    if (!editedClip) return resolveCreatorTextOverlayWindow(introOverlay, 0);
    return resolveCreatorTextOverlayWindow(introOverlay, editedClip.durationSeconds);
  }, [editedClip, introOverlay]);

  const resolvedOutroOverlayWindow = useMemo(() => {
    if (!editedClip) return resolveCreatorTextOverlayWindow(outroOverlay, 0);
    return resolveCreatorTextOverlayWindow(outroOverlay, editedClip.durationSeconds);
  }, [editedClip, outroOverlay]);

  const activePreviewTextOverlays = useMemo(() => {
    if (!editedClip) return [];

    const overlayEntries: Array<{
      slot: CreatorTextOverlaySlot;
      overlay: CreatorTextOverlayState;
      window: ReturnType<typeof resolveCreatorTextOverlayWindow>;
      style: CreatorTextOverlayStyleSettings;
    }> = [
      {
        slot: "intro",
        overlay: introOverlay,
        window: resolvedIntroOverlayWindow,
        style: resolvedIntroOverlayStyle,
      },
      {
        slot: "outro",
        overlay: outroOverlay,
        window: resolvedOutroOverlayWindow,
        style: resolvedOutroOverlayStyle,
      },
    ];

    return overlayEntries
      .filter(({ window }) => window.enabled && clipRelativeTime >= window.startOffsetSeconds && clipRelativeTime <= window.endOffsetSeconds)
      .map(({ slot, overlay, window, style }) => {
        const fontSize = getCreatorTextOverlayFontSize(slot, overlay.scale);
        const maxChars = getCreatorTextOverlayMaxCharsPerLine(fontSize, overlay.maxWidthPct, 1080);
        const displayText = style.textCase === "uppercase" ? window.text.toUpperCase() : window.text;
        return {
          slot,
          overlay,
          style,
          wrappedText: wrapCreatorTextOverlayLines(displayText, maxChars).join("\n"),
          fontSize,
        };
      })
      .filter((entry) => entry.wrappedText);
  }, [
    clipRelativeTime,
    editedClip,
    introOverlay,
    outroOverlay,
    resolvedIntroOverlayStyle,
    resolvedIntroOverlayWindow,
    resolvedOutroOverlayStyle,
    resolvedOutroOverlayWindow,
  ]);

  const activePreviewReactiveOverlays = useMemo(() => {
    if (!editedClip || !reactiveOverlayAnalysis || previewFrameSize.width <= 0 || previewFrameSize.height <= 0) {
      return [];
    }

    return reactiveOverlays
      .filter((overlay) => {
        const overlayStart = Math.max(0, overlay.startOffsetSeconds);
        const overlayEnd = overlayStart + Math.max(0.1, overlay.durationSeconds);
        return clipRelativeTime >= overlayStart && clipRelativeTime <= overlayEnd;
      })
      .map((overlay) => {
        const rect = resolveCreatorReactiveOverlayRect({
          overlay,
          frameWidth: 1080,
          frameHeight: 1920,
        });
        const frame = resolveCreatorReactiveOverlayFrame({
          overlay,
          rect,
          analysis: reactiveOverlayAnalysis,
          projectTimeSeconds: clipRelativeTime,
          localTimeSeconds: Math.max(0, clipRelativeTime - overlay.startOffsetSeconds),
        });
        return { overlay, rect, frame };
      });
  }, [
    clipRelativeTime,
    editedClip,
    previewFrameSize.height,
    previewFrameSize.width,
    reactiveOverlayAnalysis,
    reactiveOverlays,
  ]);

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
          {/* Navigation buttons removed */}
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
                      <div className="text-xs uppercase tracking-wider text-white/50">AI Runtime</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-100">
                          {getCreatorProviderLabel(activeToolProvider)}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-1",
                            hasActiveProviderApiKey
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                              : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                          )}
                        >
                          {hasActiveProviderApiKey
                            ? maskedActiveProviderApiKey
                              ? `Key ${maskedActiveProviderApiKey}`
                              : getCreatorApiKeySourceLabel(activeToolApiKeySource)
                            : "Key missing"}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
                          {activeToolModel || "Model pending"}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
                          {activeTool === "video_info" ? "Video info" : "Shorts"}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-white/70">
                          {llmRuns.length} run{llmRuns.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="text-xs text-white/45">Puedes usar una key guardada en este navegador o una variable de entorno del servidor.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        asChild
                        className="bg-white/5 text-white/85 hover:bg-white/10"
                      >
                        <Link href={aiRunsHref}>
                          <CalendarClock className="mr-2 h-4 w-4" />
                          AI Runs
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="bg-white/5 text-white/85 hover:bg-white/10"
                        onClick={openAiSettingsDialog}
                      >
                        <KeyRound className="mr-2 h-4 w-4" />
                        Edit API Keys
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">{sourceSelectorLabel}</label>
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
                      <SelectValue placeholder={sourceSelectorPlaceholder} />
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

                {activeTool === "clip_lab" && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Provider</label>
                      <div className="flex h-10 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white/85">
                        {getCreatorProviderLabel(resolvedShortsProvider)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Model</label>
                      <Select
                        value={resolvedShortsModel}
                        onValueChange={(value) => saveFeatureModel("shorts", value, resolvedShortsProvider)}
                        disabled={!shortsAiConfig || shortsAiConfig.models.length === 0}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                          {(shortsAiConfig?.models ?? []).map((option) => (
                            <SelectItem key={`${option.provider}:${option.value}`} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {activeTool === "video_info" && (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Provider</label>
                      <Select
                        value={resolvedVideoInfoProvider}
                        onValueChange={(value) => saveFeatureProvider("video_info", value as CreatorLLMProvider)}
                        disabled={!videoInfoAiConfig || videoInfoAiConfig.allowedProviders.length === 0}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                          {(videoInfoAiConfig?.allowedProviders ?? [resolvedVideoInfoProvider]).map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {getCreatorProviderLabel(provider)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-white/50 mb-2">Model</label>
                      <Select
                        value={resolvedVideoInfoModel}
                        onValueChange={(value) => saveFeatureModel("video_info", value, resolvedVideoInfoProvider)}
                        disabled={!videoInfoAiConfig || videoInfoAiConfig.models.length === 0}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                          {(videoInfoAiConfig?.models ?? []).map((option) => (
                            <SelectItem key={`${option.provider}:${option.value}`} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

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
                              {!canAnalyzeWithAI
                                ? `Please configure your ${getCreatorProviderLabel(resolvedVideoInfoProvider)} API key in settings`
                                : videoInfoBlocks.length === 0
                                  ? "Select at least one info block"
                                  : "Generating..."}
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
                </CardHeader>
                <CardContent className="space-y-5">
                  {!showTitleIdeas && !showDescription && !showHashtags && !showPinnedComment && !showThumbnailHooks && (
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

                  {(showHashtags || showPinnedComment || showThumbnailHooks) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {showHashtags && (
                        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                          <div className="text-xs uppercase tracking-wider text-white/50">Hashtags</div>
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
                        toast.error("Select a source file first.");
                        return;
                      }
                      setActiveSavedShortProjectId("");
                      setDetachedShortSelection(null);
                      setSelectedClipId(manualFallbackClip.id);
                      setSelectedPlanId(manualFallbackPlan.id);
                      setShortProjectNameDraft("");
                      setTrimStartNudge(0);
                      setTrimEndNudge(0);
                      setZoom(1.15);
                      setPanX(0);
                      setSubtitleScale(1);
                      setSubtitleXPositionPct(50);
                      setSubtitleYOffsetPct(78);
                      setSubtitleStyleOverrides({});
                      setShowSubtitles(true);
                      setShowSafeZones(true);
                      setReactiveOverlays([]);
                      setSelectedReactiveOverlayId("");
                      setVisualSourceMode("original");
                      setVisualSourceAssetId("");
                      setIntroOverlay(
                        getDefaultCreatorTextOverlayState("intro", {
                          origin: "manual",
                          plan: manualFallbackPlan,
                          clipDurationSeconds: manualFallbackClip.durationSeconds,
                        })
                      );
                      setOutroOverlay(
                        getDefaultCreatorTextOverlayState("outro", {
                          origin: "manual",
                          plan: manualFallbackPlan,
                          clipDurationSeconds: manualFallbackClip.durationSeconds,
                        })
                      );
                      setHubView("editor");
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader>
                      <CardTitle className="text-2xl font-bold flex items-center gap-2">
                        ✂️ Manual Edit
                      </CardTitle>
                    </CardHeader>
                  </Card>

                  <Card 
                    className="bg-white/[0.03] border-white/10 text-white shadow-xl backdrop-blur-xl cursor-pointer hover:bg-white/5 transition-colors group relative overflow-hidden"
                    onClick={handleOpenAiMagicClips}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/10 to-orange-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader>
                      <CardTitle className="text-2xl font-bold flex items-center gap-2">
                        ✨ AI Magic Clips
                      </CardTitle>
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

                    <AiSuggestionBatchGroups
                      groups={aiSuggestionsByGeneration}
                      getTranscriptPreview={resolveAiSuggestionTranscriptPreview}
                      onOpenEditor={(project) => {
                        applySavedShortProject(project);
                        setHubView("editor");
                      }}
                      onDeleteProject={(project) => void handleDeleteShortProject(project)}
                      onDeleteGeneration={(generationId, generationLabel) =>
                        void handleDeleteAiSuggestionGeneration(generationId, generationLabel)
                      }
                      activePreviewProjectId={activeSuggestionPreviewProjectId}
                      onTogglePreview={handleToggleAiSuggestionPreview}
                      previewSourceUrl={mediaUrl}
                      previewSourceFilename={mediaFilename}
                      previewSourceIsVideo={isVideoMedia}
                      isPreviewSourceLoading={isMediaPreviewLoading}
                    />
                  </div>
                )}
              </div>
            )}

            {activeTool === "clip_lab" && hubView === "editor" && (
              <div className="space-y-6">
                <div>
                  <Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10 -ml-3" onClick={() => setHubView("start")}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                </div>
                {activeShortExportTask ? (
                  <BackgroundTaskBanner
                    task={activeShortExportTask}
                    onCancel={activeShortExportTask.canCancel ? handleCancelShortExport : undefined}
                  />
                ) : null}
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
                                      {secondsToClock(project.clip.startSeconds)} → {secondsToClock(project.clip.endSeconds)}
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
                        <input
                          ref={visualAssetInputRef}
                          type="file"
                          accept="image/*,video/*,.mkv"
                          className="hidden"
                          onChange={(event) => void handleVisualAssetFileChange(event)}
                        />
                        <audio
                          ref={previewAudioRef}
                          src={mediaUrl ?? undefined}
                          preload="metadata"
                          hidden
                          playsInline
                          muted={isMuted}
                          onTimeUpdate={handleAudioTimeUpdate}
                          onPlay={handleAudioPlay}
                          onPause={handleAudioPause}
                          onEnded={handleAudioEnded}
                        />
                        <div
                          ref={previewFrameRef}
                          className="relative mx-auto w-full max-w-[420px] aspect-[9/16] rounded-[1.6rem] border border-white/15 overflow-hidden bg-black shadow-2xl"
                        >
                          {isResolvedVisualVideo && resolvedVisualSourceUrl ? (
                            <video
                              key={resolvedVisualSourceUrl}
                              ref={previewVideoRef}
                              src={resolvedVisualSourceUrl}
                              muted
                              playsInline
                              onLoadedMetadata={handleVideoLoadedMetadata}
                              className="absolute"
                              style={{
                                width: previewVideoStyle?.width ?? "100%",
                                height: previewVideoStyle?.height ?? "100%",
                                objectFit: "cover",
                                objectPosition: previewVideoStyle?.objectPosition ?? "50% 50%",
                                left: "50%",
                                top: "50%",
                                transform: "translate(-50%, -50%)",
                              }}
                            />
                          ) : isResolvedVisualImage && resolvedVisualSourceUrl ? (
                            <img
                              key={resolvedVisualSourceUrl}
                              src={resolvedVisualSourceUrl}
                              alt={resolvedVisualSourceFilename || "Replacement visual"}
                              onLoad={handlePreviewImageLoad}
                              className="absolute"
                              style={{
                                width: previewVideoStyle?.width ?? "100%",
                                height: previewVideoStyle?.height ?? "100%",
                                objectFit: "cover",
                                objectPosition: previewVideoStyle?.objectPosition ?? "50% 50%",
                                left: "50%",
                                top: "50%",
                                transform: "translate(-50%, -50%)",
                              }}
                            />
                          ) : (
                            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-black to-orange-500/10 flex items-center justify-center p-6 text-center">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-white/40 mb-2">Preview Placeholder</div>
                                <div className="text-sm text-white/70 leading-relaxed">
                                  {isResolvedVisualPreviewLoading
                                    ? "Loading visual source…"
                                    : mediaFilename
                                      ? "Current source is audio-only. Add a replacement image or video to render this short."
                                      : "No video preview available. You can still save editor presets for later."}
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

                          {activePreviewReactiveOverlays.map(({ overlay, rect, frame }) => {
                            const previewScale = previewFrameScale;
                            return (
                              <div
                                key={overlay.id}
                                className="absolute pointer-events-none"
                                style={{
                                  left: `${rect.x * previewScale}px`,
                                  top: `${rect.y * previewScale}px`,
                                  width: `${rect.width * previewScale}px`,
                                  height: `${rect.height * previewScale}px`,
                                  opacity: overlay.opacity,
                                }}
                              >
                                <ReactiveOverlayPreviewGraphic frame={frame} />
                              </div>
                            );
                          })}

                          {activePreviewTextOverlays.map((entry) => {
                            const previewScale = previewFrameScale;
                            const cssFontSize = entry.fontSize * previewScale;
                            const cssLineHeight = entry.fontSize * 1.02 * previewScale;
                            const cssBorder = entry.style.borderWidth * previewScale;
                            const cssMaxWidth = 1080 * (entry.overlay.maxWidthPct / 100) * previewScale;
                            return (
                              <div
                                key={entry.slot}
                                className="absolute text-center transition-opacity duration-150"
                                style={{
                                  left: `${entry.overlay.positionXPercent}%`,
                                  top: `${entry.overlay.positionYPercent}%`,
                                  transform: "translate(-50%, -50%)",
                                  maxWidth: `${cssMaxWidth}px`,
                                  width: "max-content",
                                }}
                              >
                                <TextOverlayPreviewText
                                  text={entry.wrappedText}
                                  overlayStyle={entry.style}
                                  fontSizePx={cssFontSize}
                                  lineHeightPx={cssLineHeight}
                                  borderWidthPx={cssBorder}
                                  shadowScale={previewScale}
                                />
                              </div>
                            );
                          })}

                          {showSubtitles && previewWrappedSubtitleLine && (() => {
                            // Render the preview subtitle in the same coordinate space as the FFmpeg export.
                            // previewScale maps the 1080 px export canvas onto the preview frame pixels.
                            const previewScale = previewFrameScale;
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
                          {!!mediaFile && editedClip && (isResolvedVisualVideo || isResolvedVisualImage) && (
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-8 pb-3 px-3">
                              {/* Seek bar */}
                              <div
                                className="h-1 rounded-full bg-white/20 mb-2.5 cursor-pointer"
                                onClick={(e) => {
                                  if (!editedClip) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                  const seekTime = editedClip.startSeconds + pct * editedClip.durationSeconds;
                                  const audio = previewAudioRef.current;
                                  if (audio) {
                                    audio.currentTime = seekTime;
                                    syncPreviewVisualToCurrentTime(seekTime);
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
                            <div>Score: {selectedClip?.score ?? "n/a"}</div>
                            <div>Subtitle source: {selectedSubtitle ? subtitleVersionLabel(selectedSubtitle) : "None"}</div>
                            <div>Subtitle style: {CREATOR_SUBTITLE_STYLE_LABELS[resolvedSubtitleStyle.preset]}</div>
                            <div>
                              Subtitle timing: {effectiveSubtitleTimingMode === "segment"
                                ? "standard chunks"
                                : effectiveSubtitleTimingMode === "word"
                                  ? "1 word pop"
                                  : effectiveSubtitleTimingMode === "pair"
                                    ? "2 word pop"
                                    : "3 word pop"}
                            </div>
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

                        {selectedPlan ? (
                          <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold text-white/90">
                                {hasAiReferenceMetadata ? "AI suggestion summary" : "Selected short summary"}
                              </div>
                              <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">
                                Always visible
                              </div>
                            </div>
                            <div className="space-y-2 text-sm">
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">AI Title</div>
                                <div className="mt-1 text-white/88">{selectedPlan.title}</div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">AI Caption</div>
                                <div className="mt-1 whitespace-pre-wrap text-white/78">{selectedPlan.caption || "None"}</div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">AI Opening Text</div>
                                <div className="mt-1 text-white/78">{selectedPlan.openingText || "None"}</div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/38">AI End Card</div>
                                <div className="mt-1 text-white/78">{selectedPlan.endCardText || "None"}</div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-4 min-w-0">
                        <Tabs defaultValue="subtitles" className="w-full">
                          <TabsList className="flex w-full mb-6 bg-black/40 border border-white/10 p-1.5 rounded-2xl h-auto gap-1 shadow-2xl relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500/5 via-cyan-500/5 to-transparent pointer-events-none" />
                            <TabsTrigger value="framing" className="flex-1 py-3 rounded-xl data-[state=active]:bg-[linear-gradient(135deg,rgba(52,211,153,0.15),rgba(255,255,255,0.01))] data-[state=active]:border-emerald-400/30 data-[state=active]:text-emerald-50 text-white/50 hover:text-white/80 transition-all border border-transparent data-[state=active]:shadow-[0_0_15px_rgba(52,211,153,0.15)] font-medium tracking-wide relative">
                              <span className="relative z-10">Framing & Trim</span>
                            </TabsTrigger>
                            <TabsTrigger value="copy" className="flex-1 py-3 rounded-xl data-[state=active]:bg-[linear-gradient(135deg,rgba(251,191,36,0.15),rgba(255,255,255,0.01))] data-[state=active]:border-amber-400/30 data-[state=active]:text-amber-50 text-white/50 hover:text-white/80 transition-all border border-transparent data-[state=active]:shadow-[0_0_15px_rgba(251,191,36,0.15)] font-medium tracking-wide relative">
                              <span className="relative z-10">Copy & Titles</span>
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
                              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-4">
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <div className="text-sm font-semibold text-white/92">Visual source</div>
                                    <div className="text-[11px] leading-relaxed text-white/55">
                                      Audio, transcript and subtitles stay on the original source. This only changes the visual layer.
                                    </div>
                                  </div>
                                  {hasVisualOverride ? (
                                    <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-cyan-100">
                                      Override active
                                    </div>
                                  ) : (
                                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/50">
                                      Original visual
                                    </div>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                                  <label className="text-xs text-white/70 block">
                                    Mode
                                    <Select
                                      value={visualSourceMode}
                                      onValueChange={(value) => {
                                        if (value !== "original" && value !== "asset") return;
                                        setVisualSourceMode(value);
                                        if (value === "original") {
                                          setVisualSourceAssetId("");
                                        } else if (!visualSourceAssetId && projectVisualAssets[0]) {
                                          setVisualSourceAssetId(projectVisualAssets[0].id);
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="mt-1 h-9 w-full bg-white/5 border-white/10 text-white/90">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                                        <SelectItem value="original" className="focus:bg-emerald-500/20 cursor-pointer">Original</SelectItem>
                                        <SelectItem value="asset" className="focus:bg-cyan-500/20 cursor-pointer">Replace Visual</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </label>

                                  <label className="text-xs text-white/70 block">
                                    Replacement asset
                                    <Select
                                      value={visualSourceAssetId}
                                      onValueChange={(value) => {
                                        setVisualSourceMode("asset");
                                        setVisualSourceAssetId(value);
                                      }}
                                      disabled={visualSourceMode !== "asset" || projectVisualAssets.length === 0}
                                    >
                                      <SelectTrigger className="mt-1 h-9 w-full bg-white/5 border-white/10 text-white/90">
                                        <SelectValue placeholder={projectVisualAssets.length > 0 ? "Select project image or video" : "No visual assets yet"} />
                                      </SelectTrigger>
                                      <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                                        {projectVisualAssets.map((asset) => (
                                          <SelectItem key={asset.id} value={asset.id} className="focus:bg-cyan-500/20 cursor-pointer">
                                            {asset.filename} ({asset.kind})
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </label>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="bg-white/5 hover:bg-white/10 text-white/85"
                                    onClick={() => visualAssetInputRef.current?.click()}
                                  >
                                    <FileVideo className="mr-2 h-4 w-4" />
                                    Upload Image / Video
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="bg-white/5 hover:bg-white/10 text-white/80"
                                    onClick={() => {
                                      setVisualSourceMode("original");
                                      setVisualSourceAssetId("");
                                    }}
                                    disabled={!hasVisualOverride}
                                  >
                                    Reset To Original
                                  </Button>
                                </div>

                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-[11px] leading-relaxed text-white/60">
                                  {hasVisualOverride
                                    ? `Rendering visuals from ${resolvedVisualSourceFilename || "selected asset"} (${resolvedVisualSourceKind}).`
                                    : isVideoMedia
                                      ? `Using the original video as the visual source: ${mediaFilename}.`
                                      : mediaFilename
                                        ? `Original source is audio-only: ${mediaFilename}. Add a replacement image or video to export a visual short.`
                                        : "Select a project source first."}
                                </div>
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
                            <input type="range" min={1.0} max={4.0} step={0.01} value={zoom} onChange={(e) => setZoom(clampShortZoomForUi(Number(e.target.value)))} className="w-full" />
                            <label className="text-xs text-white/70 block">Pan X: {Math.round(panX)}px</label>
                            <input
                              type="range"
                              min={shortPanLimits.minPanX}
                              max={shortPanLimits.maxPanX}
                              step={1}
                              value={clampNumber(panX, shortPanLimits.minPanX, shortPanLimits.maxPanX)}
                              onChange={(e) => {
                                setPanX(clampNumber(Number(e.target.value), shortPanLimits.minPanX, shortPanLimits.maxPanX));
                              }}
                              className="w-full"
                            />
                            </div>
                          </TabsContent>

                          <TabsContent value="copy" className="mt-0 outline-none">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-5 space-y-5">
                              <div className="text-sm font-semibold text-white/90 flex items-center gap-2">
                                Copy Metadata & Titles
                              </div>

                              <div
                                className={cn(
                                  "rounded-2xl border p-4 space-y-4",
                                  hasAiReferenceMetadata
                                    ? "border-amber-300/25 bg-amber-400/10"
                                    : "border-white/10 bg-white/[0.03]"
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-semibold text-white/92">
                                      {hasAiReferenceMetadata ? "AI suggestion metadata" : "Source copy metadata"}
                                    </div>
                                    <div className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                                      Visible for reference only
                                    </div>
                                  </div>
                                  {hasAiReferenceMetadata ? (
                                    <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-amber-100">
                                      AI
                                    </div>
                                  ) : null}
                                </div>

                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                  {[
                                    ["AI Title", selectedPlan?.title ?? ""],
                                    ["AI Caption", selectedPlan?.caption ?? ""],
                                    ["AI Opening Text", selectedPlan?.openingText ?? ""],
                                    ["AI End Card", selectedPlan?.endCardText ?? ""],
                                  ].map(([label, value]) => (
                                    <div key={label} className="rounded-xl border border-white/10 bg-black/20 p-3">
                                      <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">{label}</div>
                                      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/82">
                                        {value || "None"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <TextOverlayEditorCard
                                  title="Intro Title"
                                  slot="intro"
                                  overlay={introOverlay}
                                  resolvedStyle={resolvedIntroOverlayStyle}
                                  effectiveWindow={resolvedIntroOverlayWindow}
                                  referenceText={hasAiReferenceMetadata ? selectedPlan?.title : undefined}
                                  onChange={(updater) => updateTextOverlay("intro", updater)}
                                  onResetToSuggestion={
                                    hasAiReferenceMetadata ? () => resetTextOverlayToSuggestion("intro") : undefined
                                  }
                                />
                                <TextOverlayEditorCard
                                  title="Outro Card"
                                  slot="outro"
                                  overlay={outroOverlay}
                                  resolvedStyle={resolvedOutroOverlayStyle}
                                  effectiveWindow={resolvedOutroOverlayWindow}
                                  referenceText={hasAiReferenceMetadata ? selectedPlan?.endCardText : undefined}
                                  onChange={(updater) => updateTextOverlay("outro", updater)}
                                  onResetToSuggestion={
                                    hasAiReferenceMetadata ? () => resetTextOverlayToSuggestion("outro") : undefined
                                  }
                                />
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2 text-sm font-semibold text-white/92">
                                      <Layers className="h-4 w-4 text-cyan-200" />
                                      Reactive Motion Overlays
                                    </div>
                                    <div className="mt-1 text-[11px] leading-relaxed text-white/50">
                                      Add small audio-reactive assets over static video or images. They render above the visual layer and below title/subtitle text.
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {CREATOR_REACTIVE_OVERLAY_PRESETS.map((preset) => (
                                      <Button
                                        key={preset.id}
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="bg-white/5 px-3 text-xs text-white/85 hover:bg-white/10"
                                        onClick={() => addReactiveOverlay(preset.id)}
                                      >
                                        {preset.label}
                                      </Button>
                                    ))}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                                  <div className="space-y-2">
                                    {reactiveOverlays.length > 0 ? (
                                      reactiveOverlays.map((overlay, index) => {
                                        const isActive = selectedReactiveOverlayId === overlay.id;
                                        return (
                                          <button
                                            key={overlay.id}
                                            type="button"
                                            onClick={() => setSelectedReactiveOverlayId(overlay.id)}
                                            className={cn(
                                              "w-full rounded-2xl border px-4 py-3 text-left transition-colors",
                                              isActive
                                                ? "border-cyan-300/35 bg-cyan-400/10"
                                                : "border-white/10 bg-black/25 hover:bg-white/[0.05]"
                                            )}
                                          >
                                            <div className="flex items-start justify-between gap-3">
                                              <div>
                                                <div className="text-sm font-semibold text-white/90">
                                                  {index + 1}. {getCreatorReactiveOverlayPresetLabel(overlay.presetId)}
                                                </div>
                                                <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-white/38">
                                                  {overlay.startOffsetSeconds.toFixed(1)}s to {(overlay.startOffsetSeconds + overlay.durationSeconds).toFixed(1)}s
                                                </div>
                                              </div>
                                              <Button
                                                type="button"
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 shrink-0 bg-white/5 text-white/55 hover:bg-red-500/15 hover:text-red-100"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  removeReactiveOverlay(overlay.id);
                                                }}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          </button>
                                        );
                                      })
                                    ) : (
                                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-white/55">
                                        No reactive overlays yet. Add one of the presets to bring movement into static shots.
                                      </div>
                                    )}
                                  </div>

                                  {selectedReactiveOverlay ? (
                                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 space-y-4">
                                      <div className="flex items-start justify-between gap-4">
                                        <div>
                                          <div className="text-sm font-semibold text-white/92">
                                            {getCreatorReactiveOverlayPresetLabel(selectedReactiveOverlay.presetId)}
                                          </div>
                                          <div className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                                            Audio-reactive overlay
                                          </div>
                                        </div>
                                        <div className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-cyan-100">
                                          O1
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <label className="text-xs text-white/70 block">
                                          Preset
                                          <Select
                                            value={selectedReactiveOverlay.presetId}
                                            onValueChange={(value) => {
                                              if (value !== "waveform_line" && value !== "equalizer_bars" && value !== "pulse_ring") return;
                                              updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                                ...createDefaultCreatorReactiveOverlay({
                                                  id: prev.id,
                                                  presetId: value,
                                                  startOffsetSeconds: prev.startOffsetSeconds,
                                                  durationSeconds: prev.durationSeconds,
                                                }),
                                                startOffsetSeconds: prev.startOffsetSeconds,
                                                durationSeconds: prev.durationSeconds,
                                              }));
                                            }}
                                          >
                                            <SelectTrigger className="mt-1 border-white/10 bg-white/[0.04] text-white">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="border-white/10 bg-zinc-950 text-white">
                                              {CREATOR_REACTIVE_OVERLAY_PRESETS.map((preset) => (
                                                <SelectItem key={preset.id} value={preset.id}>
                                                  {preset.label}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </label>
                                        <label className="text-xs text-white/70 block">
                                          Tint
                                          <input
                                            type="color"
                                            value={selectedReactiveOverlay.tintHex}
                                            onChange={(event) =>
                                              updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                                ...prev,
                                                tintHex: event.target.value.toUpperCase(),
                                              }))
                                            }
                                            className="mt-1 h-9 w-full rounded-md border border-white/10 bg-white/[0.04]"
                                          />
                                        </label>
                                      </div>

                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <label className="text-xs text-white/70 block">
                                          Start offset
                                          <Input
                                            type="number"
                                            min={0}
                                            step={0.1}
                                            value={selectedReactiveOverlay.startOffsetSeconds}
                                            onChange={(event) =>
                                              updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                                ...prev,
                                                startOffsetSeconds: Number(event.target.value),
                                              }))
                                            }
                                            className="mt-1 border-white/10 bg-white/[0.04] text-white"
                                          />
                                        </label>
                                        <label className="text-xs text-white/70 block">
                                          Duration
                                          <Input
                                            type="number"
                                            min={0.2}
                                            step={0.1}
                                            value={selectedReactiveOverlay.durationSeconds}
                                            onChange={(event) =>
                                              updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                                ...prev,
                                                durationSeconds: Number(event.target.value),
                                              }))
                                            }
                                            className="mt-1 border-white/10 bg-white/[0.04] text-white"
                                          />
                                        </label>
                                      </div>

                                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <label className="text-xs text-white/70 block">Position X: {selectedReactiveOverlay.positionXPercent.toFixed(0)}%</label>
                                        <input
                                          type="range"
                                          min={5}
                                          max={95}
                                          step={1}
                                          value={selectedReactiveOverlay.positionXPercent}
                                          onChange={(event) =>
                                            updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                              ...prev,
                                              positionXPercent: Number(event.target.value),
                                            }))
                                          }
                                          className="w-full"
                                        />
                                        <label className="text-xs text-white/70 block">Position Y: {selectedReactiveOverlay.positionYPercent.toFixed(0)}%</label>
                                        <input
                                          type="range"
                                          min={5}
                                          max={95}
                                          step={1}
                                          value={selectedReactiveOverlay.positionYPercent}
                                          onChange={(event) =>
                                            updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                              ...prev,
                                              positionYPercent: Number(event.target.value),
                                            }))
                                          }
                                          className="w-full"
                                        />
                                        <label className="text-xs text-white/70 block">Width: {selectedReactiveOverlay.widthPercent.toFixed(0)}%</label>
                                        <input
                                          type="range"
                                          min={8}
                                          max={100}
                                          step={1}
                                          value={selectedReactiveOverlay.widthPercent}
                                          onChange={(event) =>
                                            updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                              ...prev,
                                              widthPercent: Number(event.target.value),
                                            }))
                                          }
                                          className="w-full"
                                        />
                                        <label className="text-xs text-white/70 block">Height: {selectedReactiveOverlay.heightPercent.toFixed(0)}%</label>
                                        <input
                                          type="range"
                                          min={6}
                                          max={100}
                                          step={1}
                                          value={selectedReactiveOverlay.heightPercent}
                                          onChange={(event) =>
                                            updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                              ...prev,
                                              heightPercent: Number(event.target.value),
                                            }))
                                          }
                                          className="w-full"
                                        />
                                      </div>

                                      <label className="text-xs text-white/70 block">Scale: {selectedReactiveOverlay.scale.toFixed(2)}x</label>
                                      <input
                                        type="range"
                                        min={0.2}
                                        max={3}
                                        step={0.01}
                                        value={selectedReactiveOverlay.scale}
                                        onChange={(event) =>
                                          updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                            ...prev,
                                            scale: Number(event.target.value),
                                          }))
                                        }
                                        className="w-full"
                                      />
                                      <label className="text-xs text-white/70 block">Opacity: {Math.round(selectedReactiveOverlay.opacity * 100)}%</label>
                                      <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={selectedReactiveOverlay.opacity}
                                        onChange={(event) =>
                                          updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                            ...prev,
                                            opacity: Number(event.target.value),
                                          }))
                                        }
                                        className="w-full"
                                      />
                                      <label className="text-xs text-white/70 block">Sensitivity: {selectedReactiveOverlay.sensitivity.toFixed(2)}</label>
                                      <input
                                        type="range"
                                        min={0.2}
                                        max={3}
                                        step={0.01}
                                        value={selectedReactiveOverlay.sensitivity}
                                        onChange={(event) =>
                                          updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                            ...prev,
                                            sensitivity: Number(event.target.value),
                                          }))
                                        }
                                        className="w-full"
                                      />
                                      <label className="text-xs text-white/70 block">Smoothing: {selectedReactiveOverlay.smoothing.toFixed(2)}</label>
                                      <input
                                        type="range"
                                        min={0}
                                        max={0.95}
                                        step={0.01}
                                        value={selectedReactiveOverlay.smoothing}
                                        onChange={(event) =>
                                          updateReactiveOverlay(selectedReactiveOverlay.id, (prev) => ({
                                            ...prev,
                                            smoothing: Number(event.target.value),
                                          }))
                                        }
                                        className="w-full"
                                      />

                                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-[11px] text-white/58">
                                        {reactiveOverlayAnalysis
                                          ? "Preview is driven by decoded source audio from the selected clip."
                                          : "Preview analysis will appear once the source audio is decoded."}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm leading-relaxed text-white/55">
                                      Select an overlay to edit its timing, placement and motion controls.
                                    </div>
                                  )}
                                </div>
                              </div>
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
                                <div className="space-y-2">
                                  <label className="text-xs text-white/70 block">Subtitle display</label>
                                  <Select
                                    value={subtitleTimingMode}
                                    onValueChange={(value) => setSubtitleTimingMode(value as CreatorSubtitleTimingMode)}
                                  >
                                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white/90">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-zinc-950 border-white/10 text-white/90">
                                      <SelectItem value="segment" className="focus:bg-cyan-500/20 cursor-pointer">
                                        Normal subtitles
                                      </SelectItem>
                                      <SelectItem value="word" className="focus:bg-cyan-500/20 cursor-pointer">
                                        1 word
                                      </SelectItem>
                                      <SelectItem value="pair" className="focus:bg-cyan-500/20 cursor-pointer">
                                        2 words
                                      </SelectItem>
                                      <SelectItem value="triple" className="focus:bg-cyan-500/20 cursor-pointer">
                                        3 words
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {effectiveSubtitleTimingMode !== subtitleTimingMode && (
                                    <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
                                      Word-timed pop captions are only available for source-language subtitles with saved word timestamps. Preview/export is using standard subtitle chunks for this selection.
                                    </div>
                                  )}
                                </div>
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
                            {!resolvedVisualSourceFile && mediaFilename && (
                              <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 flex items-start gap-2">
                                <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                                Current source has no visual media. Add a replacement video or image to export this short.
                              </div>
                            )}
                            {!canRender && !isActiveShortExportTask && (
                              <div className="text-xs text-white/50 bg-white/5 border border-white/10 rounded-lg p-2">
                                {selectedProject && (!selectedTranscript || !selectedSubtitle)
                                  ? "Select a transcript + subtitle source to enable save/export."
                                  : "Pick a source file to start editing and saving shorts."}
                              </div>
                            )}
                            <div className="pt-2 flex flex-wrap gap-2">
                              <Button
                                onClick={handleSaveShortProject}
                                disabled={!canRender || isActiveShortExportTask}
                                variant="ghost"
                                className="bg-white/5 hover:bg-white/10 text-white/90"
                              >
                                <Save className="w-4 h-4 mr-2" />
                                {activeSavedShortProject?.origin === "ai_suggestion" ? "Save As Manual Short" : "Save Short Config"}
                              </Button>
                              <Button
                                onClick={handleRenderShort}
                                disabled={!canExportShort}
                                className="bg-gradient-to-r from-fuchsia-500 to-cyan-400 text-black font-semibold hover:from-fuchsia-400 hover:to-cyan-300"
                              >
                                {isActiveShortExportTask ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <HardDriveDownload className="w-4 h-4 mr-2" />}
                                {isActiveShortExportTask
                                  ? activeShortExportTask?.status === "finalizing"
                                    ? `Finalizing ${Math.round(activeShortExportTask.progress ?? exportProgressPct)}%`
                                    : `Exporting ${Math.round(activeShortExportTask?.progress ?? exportProgressPct)}%`
                                  : "Export Short"}
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
                                  disabled={isActiveShortExportTask}
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
                                  setSubtitleScale(1);
                                  setSubtitleXPositionPct(50);
                                  setSubtitleYOffsetPct(78);
                                  setSubtitleStyleOverrides({});
                                  setShowSafeZones(true);
                                  setShowSubtitles(true);
                                  setReactiveOverlays([]);
                                  setSelectedReactiveOverlayId("");
                                  setVisualSourceMode("original");
                                  setVisualSourceAssetId("");
                                  setIntroOverlay(
                                    getDefaultCreatorTextOverlayState("intro", {
                                      origin: activeSavedShortProject?.origin ?? "manual",
                                      plan: selectedPlan,
                                      clipDurationSeconds: editedClip?.durationSeconds,
                                    })
                                  );
                                  setOutroOverlay(
                                    getDefaultCreatorTextOverlayState("outro", {
                                      origin: activeSavedShortProject?.origin ?? "manual",
                                      plan: selectedPlan,
                                      clipDurationSeconds: editedClip?.durationSeconds,
                                    })
                                  );
                                }}
                              >
                                Reset Editor
                              </Button>
                            </div>
                            {isActiveShortExportTask && (
                              <div className="space-y-2">
                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-fuchsia-400 to-cyan-300 transition-[width] duration-150"
                                    style={{ width: `${Math.max(4, Math.round(activeShortExportTask?.progress ?? exportProgressPct))}%` }}
                                  />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs text-white/55">
                                    {activeShortExportTask?.message || "System short render in progress... keep this tab open."}
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
                                  {activeShortExportTask?.status ?? "Running"}
                                </div>
                              </div>
                            )}
                            {shortExportLogText && (
                              <div className="rounded-lg border border-white/10 bg-black/40 p-2 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] uppercase tracking-wider text-white/45">Export logs</div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[11px] bg-white/5 hover:bg-white/10 text-white/75"
                                    onClick={() => copyText(shortExportLogText, "Export logs")}
                                  >
                                    <Copy className="w-3 h-3 mr-1" /> Copy
                                  </Button>
                                </div>
                                <pre className="max-h-56 overflow-auto text-[11px] text-white/70 whitespace-pre-wrap break-words">{shortExportLogText}</pre>
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
            <DialogTitle>Creator AI Keys</DialogTitle>
            <DialogDescription className="text-white/55">
              Optional browser overrides. If left blank, Creator will use the server env when available.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="creator-openai-key" className="text-white/80">
                OpenAI API key
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

            {hasOpenAIApiKey ? (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
                OpenAI: {maskedOpenAIApiKey}
              </div>
            ) : openAIApiKeySource === "env" ? (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
                OpenAI: available from server env
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="creator-gemini-key" className="text-white/80">
                Gemini API key
              </Label>
              <Input
                id="creator-gemini-key"
                type="password"
                value={geminiApiKeyDraft}
                onChange={(event) => setGeminiApiKeyDraft(event.target.value)}
                placeholder="AIza..."
                autoComplete="off"
              />
            </div>

            {hasGeminiApiKey ? (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
                Gemini: {maskedGeminiApiKey}
              </div>
            ) : geminiApiKeySource === "env" ? (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/65">
                Gemini: available from server env
              </div>
            ) : null}
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
                  Remove OpenAI
                </Button>
              )}
              {hasGeminiApiKey && (
                <Button
                  type="button"
                  variant="ghost"
                  className="bg-white/5 text-white/80 hover:bg-white/10"
                  onClick={handleClearGeminiApiKey}
                >
                  Remove Gemini
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
                onClick={() => {
                  const hasOpenAIInput = openAIApiKeyDraft.trim().length > 0;
                  const hasGeminiInput = geminiApiKeyDraft.trim().length > 0;
                  if (hasOpenAIInput) {
                    handleSaveOpenAIApiKey();
                  }
                  if (hasGeminiInput) {
                    handleSaveGeminiApiKey();
                  }
                }}
              >
                Save keys
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
