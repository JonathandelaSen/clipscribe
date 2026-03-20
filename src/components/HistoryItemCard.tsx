import { useState, useEffect, useMemo, useRef } from "react";
import { db } from "@/lib/db";
import { formatTime, generateSrt } from "@/lib/srt";
import {
  getLatestTranscript,
  getSubtitleById,
  getTranscriptById,
  sortSubtitleVersions,
  sortTranscriptVersions,
  type HistoryItem,
  type SubtitleChunk,
  type SubtitleVersion,
  type TranscriptVersion,
} from "@/lib/history";
import { useTranslator } from "@/hooks/useTranslator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  FileText,
  Download,
  Clock,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Loader2,
  Copy,
  Check,
  Globe,
  FastForward,
  RotateCcw,
  Layers,
  Languages,
} from "lucide-react";
import { toast } from "sonner";
import { ProgressIndicator } from "./ProgressIndicator";
import { TRANSCRIPTION_LANGUAGES, getTranscriptionLanguageLabel } from "@/lib/languages";

const TRANSLATION_LANGUAGES = [
  { value: "es", label: "Spanish" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "ru", label: "Russian" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];

const TRANSLATION_LANG_SET = new Set(TRANSLATION_LANGUAGES.map((lang) => lang.value));

function languageLabel(code?: string) {
  if (!code) return "Unknown";
  const normalized = code.toLowerCase();
  if (normalized === "unknown") return "Unknown";
  const found = TRANSLATION_LANGUAGES.find((lang) => lang.value === normalized);
  if (found) return found.label;
  return getTranscriptionLanguageLabel(code);
}

function statusBadge(status: TranscriptVersion["status"], audioProgress?: number, audioProgressLabel?: string) {
  if (status === "completed") {
    return (
      <span className="flex items-center text-emerald-400">
        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Completed
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span className="flex items-center text-amber-400">
        <AlertCircle className="w-4 h-4 mr-1.5" /> Stopped
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center text-red-400">
        <AlertCircle className="w-4 h-4 mr-1.5" /> Error
      </span>
    );
  }
  return (
    <span className="flex items-center text-violet-400">
      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
      {audioProgressLabel ?? `Processing${audioProgress !== undefined ? ` ${audioProgress}%` : ""}`}
    </span>
  );
}

function subtitleKindLabel(kind: SubtitleVersion["kind"]) {
  if (kind === "original") return "Original";
  if (kind === "translation") return "Translation";
  return "Shifted";
}

function formatShiftSeconds(value: number) {
  const rounded = Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  if (rounded === 0) return "0s";
  return `${rounded > 0 ? "+" : ""}${rounded}s`;
}

function transcriptOptionLabel(tx: TranscriptVersion) {
  const created = new Date(tx.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${tx.label} • ${tx.status} • ${created}`;
}

function subtitleOptionLabel(sub: SubtitleVersion) {
  const created = new Date(sub.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `S${sub.versionNumber} • ${sub.language.toUpperCase()} • ${subtitleKindLabel(sub.kind)} • ${formatShiftSeconds(sub.shiftSeconds)} • ${created}`;
}

export interface HistoryItemCardProps {
  item: HistoryItem;
  onDelete?: (id: string) => void;
  audioProgress?: number;
  audioProgressLabel?: string;
  autoExpand?: boolean;
  onCreateShiftedSubtitleVersion?: (
    projectId: string,
    transcriptVersionId: string,
    subtitleVersionId: string,
    shiftSeconds: number
  ) => string | null | void;
  onRename?: (id: string, newName: string) => void;
  onRetranscribe?: (id: string, language: string) => void;
  isRetranscribing?: boolean;
  retranscribeStatusLabel?: string;
  onSaveTranslation?: (
    projectId: string,
    transcriptVersionId: string,
    sourceSubtitleVersionId: string,
    targetLanguage: string,
    sourceLanguage: string,
    chunks: SubtitleChunk[]
  ) => string | null | void;
  onDeleteTranscriptVersion?: (itemId: string, transcriptVersionId: string) => void;
}

export function HistoryItemCard({
  item,
  onDelete,
  audioProgress,
  audioProgressLabel,
  autoExpand = false,
  onCreateShiftedSubtitleVersion,
  onRename,
  onRetranscribe,
  isRetranscribing = false,
  retranscribeStatusLabel,
  onSaveTranslation,
  onDeleteTranscriptVersion,
}: HistoryItemCardProps) {
  const sortedTranscripts = useMemo(() => sortTranscriptVersions(item.transcripts || []), [item.transcripts]);
  const latestTranscript = useMemo(() => getLatestTranscript(item), [item]);

  const [expandedText, setExpandedText] = useState(autoExpand);
  const [expandedChunks, setExpandedChunks] = useState(autoExpand);
  const [copiedTxt, setCopiedTxt] = useState(false);
  const [copiedSrt, setCopiedSrt] = useState(false);

  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string>(
    item.activeTranscriptVersionId || latestTranscript?.id || ""
  );
  const [subtitleLanguageFilter, setSubtitleLanguageFilter] = useState<string>("all");
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>("");

  const [translationSourceLang, setTranslationSourceLang] = useState<string>("en");
  const [targetLang, setTargetLang] = useState("es");

  const [shiftSeconds, setShiftSeconds] = useState<string>("0");

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(item.filename);
  const [retranscribeLanguage, setRetranscribeLanguage] = useState<string>("");
  const [retranscribeTouched, setRetranscribeTouched] = useState(false);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const playerRef = useRef<HTMLAudioElement | HTMLVideoElement>(null);
  const pendingTranslationRef = useRef<{
    transcriptVersionId: string;
    subtitleVersionId: string;
    targetLanguage: string;
    sourceLanguage: string;
  } | null>(null);

  const activeTranscriptId = item.activeTranscriptVersionId || latestTranscript?.id || "";
  const effectiveSelectedTranscriptId =
    (autoExpand && activeTranscriptId) ||
    (selectedTranscriptId && sortedTranscripts.some((tx) => tx.id === selectedTranscriptId) ? selectedTranscriptId : activeTranscriptId);

  const selectedTranscript = useMemo(
    () => getTranscriptById(item, effectiveSelectedTranscriptId) || latestTranscript,
    [effectiveSelectedTranscriptId, item, latestTranscript]
  );

  const transcriptSubtitles = useMemo(
    () => sortSubtitleVersions(selectedTranscript?.subtitles || []),
    [selectedTranscript?.subtitles]
  );

  const subtitleLanguages = useMemo(() => {
    return Array.from(new Set(transcriptSubtitles.map((sub) => sub.language))).sort((a, b) => a.localeCompare(b));
  }, [transcriptSubtitles]);

  const fallbackSubtitleLanguage =
    transcriptSubtitles.find((sub) => sub.kind === "original")?.language || subtitleLanguages[0] || "all";
  const effectiveSubtitleLanguageFilter =
    subtitleLanguageFilter === "all" || subtitleLanguages.includes(subtitleLanguageFilter)
      ? subtitleLanguageFilter
      : fallbackSubtitleLanguage;

  const filteredSubtitles = useMemo(() => {
    if (effectiveSubtitleLanguageFilter === "all") return transcriptSubtitles;
    return transcriptSubtitles.filter((sub) => sub.language === effectiveSubtitleLanguageFilter);
  }, [effectiveSubtitleLanguageFilter, transcriptSubtitles]);

  const subtitlePool = filteredSubtitles.length ? filteredSubtitles : transcriptSubtitles;
  const effectiveSelectedSubtitleId =
    selectedSubtitleId && subtitlePool.some((sub) => sub.id === selectedSubtitleId)
      ? selectedSubtitleId
      : (subtitlePool.find((sub) => sub.kind === "original") || subtitlePool[subtitlePool.length - 1])?.id || "";

  const selectedSubtitle = useMemo(() => {
    if (!selectedTranscript) return undefined;
    return getSubtitleById(selectedTranscript, effectiveSelectedSubtitleId) || subtitlePool[subtitlePool.length - 1];
  }, [effectiveSelectedSubtitleId, selectedTranscript, subtitlePool]);

  const inferredTranslationSourceLang = selectedSubtitle?.language?.toLowerCase();
  const effectiveTranslationSourceLang =
    TRANSLATION_LANG_SET.has(translationSourceLang)
      ? translationSourceLang
      : inferredTranslationSourceLang && TRANSLATION_LANG_SET.has(inferredTranslationSourceLang)
        ? inferredTranslationSourceLang
        : "en";

  useEffect(() => {
    let activeUrl: string | null = null;

    db.projectAssets
      .get(item.mediaId || item.id)
      .then((record) => {
        if (record?.fileBlob) {
          activeUrl = URL.createObjectURL(record.fileBlob);
          setMediaUrl(activeUrl);
          setIsVideo(record.fileBlob.type.includes("video") || /\.(mp4|webm|mov|mkv)$/i.test(record.fileBlob.name));
        } else {
          setMediaUrl(null);
          setIsVideo(false);
        }
      })
      .catch((e) => {
        console.error("Failed to load media file", e);
        setMediaUrl(null);
        setIsVideo(false);
      });

    return () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [item.id, item.mediaId]);

  const handleSeek = (timestamp: number) => {
    if (playerRef.current) {
      playerRef.current.currentTime = timestamp;
      playerRef.current.play().catch(() => {});
    }
  };

  const {
    isTranslating,
    isModelLoading,
    modelProgressItems,
    translationProgress,
    translatedChunks,
    translateChunks,
    error: translatorError,
  } = useTranslator();

  useEffect(() => {
    if (!translatedChunks || !pendingTranslationRef.current || !selectedTranscript || !onSaveTranslation) return;

    const pending = pendingTranslationRef.current;
    if (pending.transcriptVersionId !== selectedTranscript.id) {
      // Transcript selection changed while translation was running; still save against original target transcript.
    }

    const createdId = onSaveTranslation(
      item.id,
      pending.transcriptVersionId,
      pending.subtitleVersionId,
      pending.targetLanguage,
      pending.sourceLanguage,
      translatedChunks
    );

    setSubtitleLanguageFilter(pending.targetLanguage);
    if (createdId) {
      setSelectedSubtitleId(createdId);
    }
    setExpandedChunks(true);
    pendingTranslationRef.current = null;

    toast.success("Translation version created", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  }, [item.id, onSaveTranslation, selectedTranscript, translatedChunks]);

  useEffect(() => {
    if (!translatorError) return;
    const cleanError = translatorError.includes("404")
      ? "Translation model for this language pair is unavailable."
      : translatorError;
    toast.error(`Translation failed: ${cleanError}`, {
      className: "bg-red-500/20 border-red-500/50 text-red-100",
    });
    pendingTranslationRef.current = null;
  }, [translatorError]);

  const selectedTranscriptText = selectedTranscript?.transcript || "";
  const selectedTranscriptChunks = selectedTranscript?.chunks || [];

  const canTranslate = !!selectedSubtitle && !!selectedTranscript && TRANSLATION_LANG_SET.has(effectiveTranslationSourceLang);
  const translationWouldBeNoop = selectedSubtitle
    ? targetLang.toLowerCase() === (selectedSubtitle.language || "").toLowerCase()
    : true;

  const totalSubtitleVersions = selectedTranscript?.subtitles.length || 0;
  const totalSubtitleLanguages = subtitleLanguages.length;

  const handleTranslate = () => {
    if (!selectedSubtitle || !selectedTranscript) return;
    if (!canTranslate) return;
    if (translationWouldBeNoop) {
      toast("Target language matches selected subtitle language", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }

    pendingTranslationRef.current = {
      transcriptVersionId: selectedTranscript.id,
      subtitleVersionId: selectedSubtitle.id,
      targetLanguage: targetLang,
      sourceLanguage: effectiveTranslationSourceLang,
    };

    translateChunks(selectedSubtitle.chunks, targetLang, effectiveTranslationSourceLang);
  };

  const handleTitleSave = () => {
    const nextValue = editTitleValue.trim();
    if (nextValue && nextValue !== item.filename && onRename) {
      onRename(item.id, nextValue);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") {
      setEditTitleValue(item.filename);
      setIsEditingTitle(false);
    }
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadText = () => {
    if (!selectedTranscriptText || !selectedTranscript) return;
    const baseName = item.filename.replace(/\.[^/.]+$/, "");
    downloadFile(selectedTranscriptText, `${baseName}__t${selectedTranscript.versionNumber}.txt`);
  };

  const handleDownloadSrt = () => {
    if (!selectedSubtitle || !selectedTranscript) return;
    const baseName = item.filename.replace(/\.[^/.]+$/, "");
    downloadFile(
      generateSrt(selectedSubtitle.chunks),
      `${baseName}__t${selectedTranscript.versionNumber}__${selectedSubtitle.language}__s${selectedSubtitle.versionNumber}.srt`
    );
  };

  const copyText = () => {
    if (!selectedTranscriptText) return;
    navigator.clipboard.writeText(selectedTranscriptText);
    setCopiedTxt(true);
    toast("Copied transcript text", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
    setTimeout(() => setCopiedTxt(false), 1500);
  };

  const copySrt = () => {
    if (!selectedSubtitle) return;
    navigator.clipboard.writeText(generateSrt(selectedSubtitle.chunks));
    setCopiedSrt(true);
    toast("Copied subtitles", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
    setTimeout(() => setCopiedSrt(false), 1500);
  };

  const handleCreateShiftedVersion = () => {
    if (!selectedTranscript || !selectedSubtitle || !onCreateShiftedSubtitleVersion) return;
    const shift = parseFloat(shiftSeconds);
    if (Number.isNaN(shift)) return;

    const createdId = onCreateShiftedSubtitleVersion(item.id, selectedTranscript.id, selectedSubtitle.id, shift);
    if (createdId) setSelectedSubtitleId(createdId);
    setExpandedChunks(true);
    toast.success("Shifted subtitle version created", {
      className: "bg-green-500/20 border-green-500/50 text-green-100",
    });
  };

  const handleRetranscribeClick = () => {
    if (!onRetranscribe) return;
    if (!retranscribeLanguage) {
      setRetranscribeTouched(true);
      toast.error("Choose a language before creating a new transcript version.", {
        className: "bg-amber-500/20 border-amber-500/50 text-amber-100",
      });
      return;
    }
    onRetranscribe(item.id, retranscribeLanguage);
  };

  if (!sortedTranscripts.length) {
    return (
      <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 md:p-8 backdrop-blur-md">
        <div className="text-white/60">No transcript versions available for this item.</div>
      </div>
    );
  }

  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 md:p-8 backdrop-blur-md transition-colors hover:bg-white/[0.04]">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-6">
        <div className="space-y-3 flex-1 min-w-0">
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              autoFocus
              className="w-full text-2xl font-semibold text-white/90 bg-white/10 border border-violet-500/50 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-violet-500/50"
            />
          ) : (
            <h3
              className="text-2xl font-semibold text-white/90 break-all cursor-pointer hover:text-white transition-colors"
              onClick={() => {
                setEditTitleValue(item.filename);
                setIsEditingTitle(true);
              }}
              title="Click to rename"
            >
              {item.filename}
            </h3>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center text-white/50">
              <Clock className="w-4 h-4 mr-1.5" />
              {new Date(item.createdAt || item.timestamp).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            {latestTranscript &&
              statusBadge(
                latestTranscript.status,
                latestTranscript.status === "transcribing" ? audioProgress : undefined,
                latestTranscript.status === "transcribing" ? audioProgressLabel : undefined
              )}
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70 text-xs">
              <Layers className="w-3.5 h-3.5 mr-1.5" />
              {item.transcripts.length} transcript version{item.transcripts.length === 1 ? "" : "s"}
            </span>
            {selectedTranscript && (
              <span className="inline-flex items-center px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70 text-xs">
                <Languages className="w-3.5 h-3.5 mr-1.5" />
                {totalSubtitleVersions} subtitle version{totalSubtitleVersions === 1 ? "" : "s"} / {totalSubtitleLanguages} language
                {totalSubtitleLanguages === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 shrink-0 min-w-[260px]">
          {onRetranscribe && (
            <>
              <div className="flex items-center gap-2">
                <Select
                  value={retranscribeLanguage}
                  onValueChange={(value) => {
                    setRetranscribeLanguage(value);
                    if (value) setRetranscribeTouched(false);
                  }}
                  disabled={isRetranscribing}
                >
                  <SelectTrigger
                    className={`h-9 min-w-[118px] bg-white/5 text-white/85 ${
                      retranscribeTouched && !retranscribeLanguage ? "border-amber-400/50 bg-amber-500/10" : "border-white/10"
                    }`}
                  >
                    <SelectValue placeholder="Language" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white/90">
                    {TRANSCRIPTION_LANGUAGES.map((lang) => (
                      <SelectItem key={`re-${lang.value}`} value={lang.value} className="focus:bg-violet-500/20 cursor-pointer">
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  onClick={handleRetranscribeClick}
                  className="text-violet-300 hover:text-violet-200 hover:bg-violet-500/10 border border-violet-400/15"
                  title={isRetranscribing ? "A transcript is already being generated for this source." : "Create a new transcript version from the same media"}
                  disabled={isRetranscribing}
                >
                  {isRetranscribing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                  {isRetranscribing ? retranscribeStatusLabel ?? "Transcribing..." : "New Transcript Version"}
                </Button>
              </div>
              {retranscribeTouched && !retranscribeLanguage && (
                <div className="text-xs text-amber-200/90">
                  Select the spoken language first.
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-end gap-2">
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(item.id)}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                title="Delete project (all transcript and subtitle versions)"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {mediaUrl && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-2xl animate-in fade-in slide-in-from-top-4">
          {isVideo ? (
            <video ref={playerRef as React.RefObject<HTMLVideoElement>} src={mediaUrl} controls className="w-full max-h-[400px]" />
          ) : (
            <audio ref={playerRef as React.RefObject<HTMLAudioElement>} src={mediaUrl} controls className="w-full h-14 bg-black/50" />
          )}
        </div>
      )}

      <div className="space-y-4 mb-6">
        <div className="p-4 rounded-2xl border border-white/10 bg-black/20">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs uppercase tracking-wider text-white/40">Transcript Version</span>
              <Select value={effectiveSelectedTranscriptId} onValueChange={setSelectedTranscriptId}>
                <SelectTrigger className="w-full lg:w-[440px] bg-white/5 border-white/10 text-white/80">
                  <SelectValue placeholder="Select transcript version" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10 text-white/90">
                  {[...sortedTranscripts]
                    .slice()
                    .reverse()
                    .map((tx) => (
                      <SelectItem key={tx.id} value={tx.id} className="focus:bg-violet-500/20 cursor-pointer">
                        {transcriptOptionLabel(tx)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {onDeleteTranscriptVersion && effectiveSelectedTranscriptId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl text-white/60 hover:bg-red-500/10 hover:text-red-100 flex-shrink-0"
                  title="Delete transcript version"
                  onClick={() => {
                    if (window.confirm("Delete this transcript version?")) {
                      onDeleteTranscriptVersion(item.id, effectiveSelectedTranscriptId);
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                className="bg-white/5 hover:bg-white/10 text-white/80"
                onClick={() => setExpandedText((v) => !v)}
                disabled={!selectedTranscriptText}
              >
                <FileText className="w-4 h-4 mr-2" />
                {expandedText ? "Hide Text" : "View Text"}
              </Button>
              <div className="flex items-center bg-white/[0.03] rounded-lg p-1 border border-white/5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-violet-300 hover:bg-violet-500/20 hover:text-violet-200"
                  onClick={handleDownloadText}
                  disabled={!selectedTranscriptText}
                  title="Download transcript text"
                >
                  <Download className="w-4 h-4 mr-2" /> .txt
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/60 hover:bg-white/10"
                  onClick={copyText}
                  disabled={!selectedTranscriptText}
                  title="Copy transcript text"
                >
                  {copiedTxt ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          {selectedTranscript && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                {selectedTranscript.label}
              </span>
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                Requested: {languageLabel(selectedTranscript.requestedLanguage)}
              </span>
              {selectedTranscript.detectedLanguage && (
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                  Detected: {languageLabel(selectedTranscript.detectedLanguage)}
                </span>
              )}
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                {new Date(selectedTranscript.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              {statusBadge(
                selectedTranscript.status,
                selectedTranscript.status === "transcribing" ? audioProgress : undefined,
                selectedTranscript.status === "transcribing" ? audioProgressLabel : undefined
              )}
            </div>
          )}

          {selectedTranscript?.error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 text-red-400/90 p-4 rounded-xl text-sm">
              {selectedTranscript.error}
            </div>
          )}
        </div>

        {expandedText && selectedTranscriptText && (
          <div className="bg-black/40 border border-white/5 rounded-2xl p-6 text-white/70 leading-relaxed whitespace-pre-wrap animate-in fade-in slide-in-from-top-4">
            {selectedTranscriptText}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-2xl border border-white/10 bg-black/20 space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center gap-4 justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs uppercase tracking-wider text-white/40">Subtitle Version</span>
              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <Select
                  value={effectiveSubtitleLanguageFilter}
                  onValueChange={(value) => {
                    setSubtitleLanguageFilter(value);
                    setSelectedSubtitleId("");
                  }}
                >
                  <SelectTrigger className="w-full sm:w-[170px] bg-white/5 border-white/10 text-white/80">
                    <SelectValue placeholder="Language" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white/90">
                    <SelectItem value="all" className="focus:bg-fuchsia-500/20 cursor-pointer">
                      All languages
                    </SelectItem>
                    {subtitleLanguages.map((language) => (
                      <SelectItem key={language} value={language} className="focus:bg-fuchsia-500/20 cursor-pointer">
                        {languageLabel(language)} ({language.toUpperCase()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={effectiveSelectedSubtitleId}
                  onValueChange={setSelectedSubtitleId}
                  disabled={transcriptSubtitles.length === 0}
                >
                  <SelectTrigger className="w-full sm:w-[500px] bg-white/5 border-white/10 text-white/80">
                    <SelectValue placeholder="Select subtitle version" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10 text-white/90">
                    {(filteredSubtitles.length ? filteredSubtitles : transcriptSubtitles)
                      .slice()
                      .reverse()
                      .map((sub) => (
                        <SelectItem key={sub.id} value={sub.id} className="focus:bg-fuchsia-500/20 cursor-pointer">
                          {subtitleOptionLabel(sub)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="bg-white/5 hover:bg-white/10 text-white/80"
                onClick={() => setExpandedChunks((v) => !v)}
                disabled={!selectedSubtitle}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {expandedChunks ? "Hide Subtitles" : "View Subtitles"}
              </Button>
              <div className="flex items-center bg-white/[0.03] rounded-lg p-1 border border-white/5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-fuchsia-300 hover:bg-fuchsia-500/20 hover:text-fuchsia-200"
                  onClick={handleDownloadSrt}
                  disabled={!selectedSubtitle}
                >
                  <Download className="w-4 h-4 mr-2" /> SRT
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/60 hover:bg-white/10 px-2"
                  onClick={copySrt}
                  disabled={!selectedSubtitle}
                  title="Copy subtitles"
                >
                  {copiedSrt ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          {selectedSubtitle ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                S{selectedSubtitle.versionNumber}
              </span>
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                {subtitleKindLabel(selectedSubtitle.kind)}
              </span>
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                {languageLabel(selectedSubtitle.language)} ({selectedSubtitle.language.toUpperCase()})
              </span>
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                Shift: {formatShiftSeconds(selectedSubtitle.shiftSeconds)}
              </span>
              {selectedSubtitle.sourceLanguage && (
                <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                  Source: {selectedSubtitle.sourceLanguage.toUpperCase()}
                </span>
              )}
              <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white/70">
                {new Date(selectedSubtitle.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          ) : (
            <div className="text-sm text-white/50">No subtitle versions yet. They will appear when transcript chunks are available.</div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
              <div className="flex items-center gap-2 text-white/70 text-sm">
                <Globe className="w-4 h-4 text-fuchsia-300" /> Create translation subtitle version
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-white/40 mb-1">Source language (for model)</div>
                  <Select
                    value={effectiveTranslationSourceLang}
                    onValueChange={setTranslationSourceLang}
                    disabled={isTranslating || isModelLoading}
                  >
                    <SelectTrigger className="w-full bg-black/20 border-white/10 text-white/80">
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-white/10 text-white/90">
                      {TRANSLATION_LANGUAGES.map((lang) => (
                        <SelectItem key={`src-${lang.value}`} value={lang.value} className="focus:bg-fuchsia-500/20 cursor-pointer">
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-xs text-white/40 mb-1">Target language</div>
                  <Select value={targetLang} onValueChange={setTargetLang} disabled={isTranslating || isModelLoading}>
                    <SelectTrigger className="w-full bg-black/20 border-white/10 text-white/80">
                      <SelectValue placeholder="Target" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-white/10 text-white/90">
                      {TRANSLATION_LANGUAGES.map((lang) => (
                        <SelectItem key={`tgt-${lang.value}`} value={lang.value} className="focus:bg-fuchsia-500/20 cursor-pointer">
                          {lang.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedSubtitle && !TRANSLATION_LANG_SET.has((selectedSubtitle.language || "").toLowerCase()) && (
                <div className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                  Selected subtitle metadata language is &quot;{selectedSubtitle.language}&quot;. Choose the actual source
                  language above.
                </div>
              )}

              {isModelLoading && modelProgressItems?.length > 0 && <ProgressIndicator progressItems={modelProgressItems} />}

              <Button
                variant="ghost"
                size="sm"
                className="text-fuchsia-300 hover:bg-fuchsia-500/20 hover:text-fuchsia-200 disabled:opacity-50"
                onClick={handleTranslate}
                disabled={!selectedSubtitle || !selectedTranscript || !canTranslate || isTranslating || isModelLoading}
              >
                {isModelLoading || isTranslating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="w-4 h-4 mr-2" />
                )}
                {isModelLoading
                  ? "Loading Model..."
                  : isTranslating
                    ? `Translating ${translationProgress}%`
                    : `Create ${targetLang.toUpperCase()} Translation Version`}
              </Button>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
              <div className="flex items-center gap-2 text-white/70 text-sm">
                <FastForward className="w-4 h-4 text-violet-300" /> Create shifted subtitle version
              </div>
              <div className="text-xs text-white/40">
                Shift is applied to the selected subtitle version. A new version is created and the original is preserved.
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  placeholder="0"
                  value={shiftSeconds}
                  onChange={(e) => setShiftSeconds(e.target.value)}
                  className="w-24 bg-black/20 border border-white/10 rounded-lg px-2 py-1 text-sm text-white/90 focus:outline-none focus:border-fuchsia-500/50"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-white/5 hover:bg-white/10 text-white/80"
                  disabled={
                    !selectedSubtitle ||
                    !selectedTranscript ||
                    !onCreateShiftedSubtitleVersion ||
                    !shiftSeconds ||
                    Number.isNaN(parseFloat(shiftSeconds))
                  }
                  onClick={handleCreateShiftedVersion}
                >
                  Create Shift Version
                </Button>
              </div>
            </div>
          </div>
        </div>

        {expandedChunks && selectedSubtitle && (
          <div className="space-y-3 bg-black/20 border border-white/5 rounded-2xl p-6 animate-in fade-in slide-in-from-top-4 max-h-[28rem] overflow-auto">
            {selectedSubtitle.chunks.map((chunk, i) => (
              <div
                key={`${selectedSubtitle.id}-${i}`}
                className="flex gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors cursor-pointer group"
                onClick={() => chunk.timestamp?.[0] != null && handleSeek(chunk.timestamp[0])}
              >
                <span className="text-violet-400/60 font-mono text-sm shrink-0 mt-0.5 group-hover:text-violet-300 transition-colors">
                  {chunk.timestamp?.[0] != null ? formatTime(chunk.timestamp[0]) : "--:--:--,---"}
                </span>
                <span className="text-white/80 text-sm">{chunk.text}</span>
              </div>
            ))}
          </div>
        )}

        {expandedChunks && !selectedSubtitle && selectedTranscriptChunks.length > 0 && (
          <div className="text-sm text-white/50">Subtitle versions are still being prepared from transcript chunks.</div>
        )}
      </div>
    </div>
  );
}
