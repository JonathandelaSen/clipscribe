export type ProcessingStatus = "transcribing" | "completed" | "error" | "stopped";

export type SubtitleChunk = {
  text: string;
  timestamp: [number | null, number | null];
  [key: string]: unknown;
};

export type SubtitleVersionKind = "original" | "translation" | "shifted";

export interface SubtitleVersion {
  id: string;
  versionNumber: number;
  label: string;
  language: string;
  sourceLanguage?: string;
  kind: SubtitleVersionKind;
  createdAt: number;
  updatedAt: number;
  shiftSeconds: number;
  derivedFromSubtitleVersionId?: string;
  chunks: SubtitleChunk[];
}

export interface TranscriptVersion {
  id: string;
  versionNumber: number;
  label: string;
  status: ProcessingStatus;
  createdAt: number;
  updatedAt: number;
  requestedLanguage: string;
  detectedLanguage?: string;
  transcript?: string;
  chunks?: SubtitleChunk[];
  wordChunks?: SubtitleChunk[];
  error?: string;
  subtitles: SubtitleVersion[];
}

export interface HistoryItem {
  id: string;
  mediaId: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  timestamp: number;
  activeTranscriptVersionId?: string;
  transcripts: TranscriptVersion[];
}

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

export function makeId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sortHistoryItems(items: HistoryItem[]): HistoryItem[] {
  return [...items].sort((a, b) => (b.timestamp ?? b.updatedAt) - (a.timestamp ?? a.updatedAt));
}

export function sortTranscriptVersions(versions: TranscriptVersion[]): TranscriptVersion[] {
  return [...versions].sort((a, b) => {
    if ((a.versionNumber ?? 0) !== (b.versionNumber ?? 0)) {
      return (a.versionNumber ?? 0) - (b.versionNumber ?? 0);
    }
    return a.createdAt - b.createdAt;
  });
}

export function sortSubtitleVersions(versions: SubtitleVersion[]): SubtitleVersion[] {
  return [...versions].sort((a, b) => {
    if ((a.versionNumber ?? 0) !== (b.versionNumber ?? 0)) {
      return (a.versionNumber ?? 0) - (b.versionNumber ?? 0);
    }
    return a.createdAt - b.createdAt;
  });
}

export function getLatestTranscript(item?: HistoryItem | null): TranscriptVersion | undefined {
  if (!item?.transcripts?.length) return undefined;
  return sortTranscriptVersions(item.transcripts)[item.transcripts.length - 1];
}

export function getTranscriptById(item: HistoryItem, transcriptVersionId?: string | null): TranscriptVersion | undefined {
  if (!item.transcripts.length) return undefined;
  if (transcriptVersionId) {
    const found = item.transcripts.find((t) => t.id === transcriptVersionId);
    if (found) return found;
  }
  if (item.activeTranscriptVersionId) {
    const active = item.transcripts.find((t) => t.id === item.activeTranscriptVersionId);
    if (active) return active;
  }
  return getLatestTranscript(item);
}

export function getLatestSubtitleForLanguage(
  transcript: TranscriptVersion,
  language: string
): SubtitleVersion | undefined {
  const matches = transcript.subtitles.filter((s) => s.language === language);
  if (!matches.length) return undefined;
  return sortSubtitleVersions(matches)[matches.length - 1];
}

export function getSubtitleById(
  transcript: TranscriptVersion,
  subtitleVersionId?: string | null
): SubtitleVersion | undefined {
  if (!transcript.subtitles.length) return undefined;
  if (subtitleVersionId) {
    const found = transcript.subtitles.find((s) => s.id === subtitleVersionId);
    if (found) return found;
  }
  const original = transcript.subtitles.find((s) => s.kind === "original");
  return original ?? sortSubtitleVersions(transcript.subtitles)[transcript.subtitles.length - 1];
}

export function shiftSubtitleChunks(chunks: SubtitleChunk[], shiftSeconds: number): SubtitleChunk[] {
  return (chunks || []).map((chunk) => ({
    ...chunk,
    timestamp: [
      chunk.timestamp?.[0] == null ? null : Math.max(0, chunk.timestamp[0] + shiftSeconds),
      chunk.timestamp?.[1] == null ? null : Math.max(0, chunk.timestamp[1] + shiftSeconds),
    ],
  }));
}

export function syncOriginalSubtitleVersion(
  transcript: TranscriptVersion,
  options: { chunks?: SubtitleChunk[]; language?: string; now?: number }
): TranscriptVersion {
  const now = options.now ?? Date.now();
  const chunks = options.chunks ?? transcript.chunks ?? [];
  const language = options.language ?? transcript.detectedLanguage ?? transcript.requestedLanguage ?? "unknown";
  const subtitles = sortSubtitleVersions(transcript.subtitles || []);
  const originalIdx = subtitles.findIndex((s) => s.kind === "original");

  if (originalIdx >= 0) {
    const current = subtitles[originalIdx];
    subtitles[originalIdx] = {
      ...current,
      language,
      sourceLanguage: language,
      updatedAt: now,
      chunks,
    };
  } else if (chunks.length > 0) {
    subtitles.push({
      id: makeId("sub"),
      versionNumber: 1,
      label: "Original subtitles",
      language,
      sourceLanguage: language,
      kind: "original",
      createdAt: now,
      updatedAt: now,
      shiftSeconds: 0,
      chunks,
    });
  }

  return {
    ...transcript,
    subtitles: sortSubtitleVersions(subtitles),
    updatedAt: now,
  };
}

function normalizeSubtitleChunkArray(input: unknown): SubtitleChunk[] {
  if (!Array.isArray(input)) return [];
  return input.map((chunk) => {
    const chunkRecord = isRecord(chunk) ? chunk : {};
    const rawTimestamp = Array.isArray(chunkRecord.timestamp) ? chunkRecord.timestamp : [];

    return {
      ...chunkRecord,
      text: String(chunkRecord.text ?? ""),
      timestamp: [
        rawTimestamp[0] == null ? null : Number(rawTimestamp[0]),
        rawTimestamp[1] == null ? null : Number(rawTimestamp[1]),
      ] as [number | null, number | null],
    };
  });
}

function normalizeSubtitleVersion(raw: unknown, index: number, fallbackLanguage = "unknown"): SubtitleVersion {
  const record = isRecord(raw) ? raw : {};
  const createdAt = Number(record.createdAt ?? record.updatedAt ?? Date.now());
  const updatedAt = Number(record.updatedAt ?? createdAt);
  const rawKind = record.kind;
  return {
    id: String(record.id ?? makeId("sub")),
    versionNumber: Number(record.versionNumber ?? index + 1),
    label: String(record.label ?? `Subtitle v${index + 1}`),
    language: String(record.language ?? fallbackLanguage),
    sourceLanguage: record.sourceLanguage ? String(record.sourceLanguage) : undefined,
    kind: rawKind === "translation" || rawKind === "shifted" || rawKind === "original" ? rawKind : "translation",
    createdAt,
    updatedAt,
    shiftSeconds: Number(record.shiftSeconds ?? 0),
    derivedFromSubtitleVersionId: record.derivedFromSubtitleVersionId ? String(record.derivedFromSubtitleVersionId) : undefined,
    chunks: normalizeSubtitleChunkArray(record.chunks),
  };
}

function normalizeTranscriptVersion(raw: unknown, index: number): TranscriptVersion {
  const record = isRecord(raw) ? raw : {};
  const createdAt = Number(record.createdAt ?? record.updatedAt ?? record.timestamp ?? Date.now());
  const updatedAt = Number(record.updatedAt ?? createdAt);
  const requestedLanguage = String(record.requestedLanguage ?? record.originalLanguage ?? "unknown");
  const detectedLanguage = record.detectedLanguage ?? record.originalLanguage;
  const statusValue = record.status;
  const subtitlesRaw = Array.isArray(record.subtitles) ? record.subtitles : [];

  let transcript: TranscriptVersion = {
    id: String(record.id ?? makeId("tx")),
    versionNumber: Number(record.versionNumber ?? index + 1),
    label: String(record.label ?? `Transcript v${index + 1}`),
    status:
      statusValue === "transcribing" || statusValue === "completed" || statusValue === "error" || statusValue === "stopped"
        ? statusValue
        : "completed",
    createdAt,
    updatedAt,
    requestedLanguage,
    detectedLanguage: detectedLanguage ? String(detectedLanguage) : undefined,
    transcript: record.transcript ? String(record.transcript) : undefined,
    chunks: normalizeSubtitleChunkArray(record.chunks),
    wordChunks: normalizeSubtitleChunkArray(record.wordChunks),
    error: record.error ? String(record.error) : undefined,
    subtitles: subtitlesRaw.map((sub, subIdx) =>
      normalizeSubtitleVersion(sub, subIdx, String(record.detectedLanguage ?? record.requestedLanguage ?? "unknown"))
    ),
  };

  if ((!transcript.subtitles || transcript.subtitles.length === 0) && transcript.chunks && transcript.chunks.length > 0) {
    transcript = syncOriginalSubtitleVersion(transcript, {
      chunks: transcript.chunks,
      language: transcript.detectedLanguage ?? transcript.requestedLanguage,
      now: transcript.updatedAt,
    });
  }

  return {
    ...transcript,
    subtitles: sortSubtitleVersions(transcript.subtitles || []),
  };
}

function migrateLegacyHistoryItem(raw: unknown): HistoryItem {
  const record = isRecord(raw) ? raw : {};
  const baseTs = Number(record.timestamp ?? Date.now());
  const requestedLanguage = String(record.originalLanguage ?? "unknown");
  const detectedLanguage = record.originalLanguage ? String(record.originalLanguage) : undefined;
  const chunks = normalizeSubtitleChunkArray(record.chunks);
  const now = baseTs;

  const subtitles: SubtitleVersion[] = [];
  if (chunks.length > 0) {
    subtitles.push({
      id: makeId("sub"),
      versionNumber: 1,
      label: record.isEdited ? "Original subtitles (edited)" : "Original subtitles",
      language: detectedLanguage ?? requestedLanguage,
      sourceLanguage: detectedLanguage ?? requestedLanguage,
      kind: "original",
      createdAt: now,
      updatedAt: now,
      shiftSeconds: 0,
      chunks,
    });
  }

  const translations = isRecord(record.translations) ? record.translations : {};
  Object.entries(translations).forEach(([language, translatedChunks], idx) => {
    subtitles.push({
      id: makeId("sub"),
      versionNumber: subtitles.length + 1,
      label: `${String(language).toUpperCase()} translation v${idx + 1}`,
      language: String(language),
      sourceLanguage: detectedLanguage ?? requestedLanguage,
      kind: "translation",
      createdAt: now + idx + 1,
      updatedAt: now + idx + 1,
      shiftSeconds: 0,
      chunks: normalizeSubtitleChunkArray(translatedChunks),
    });
  });

  const transcriptVersion: TranscriptVersion = {
    id: makeId("tx"),
    versionNumber: 1,
    label: "Transcript v1",
    status:
      record.status === "transcribing" || record.status === "completed" || record.status === "error" || record.status === "stopped"
        ? record.status
        : "completed",
    createdAt: now,
    updatedAt: now,
    requestedLanguage,
    detectedLanguage,
    transcript: record.transcript ? String(record.transcript) : undefined,
    chunks,
    error: record.error ? String(record.error) : undefined,
    subtitles: sortSubtitleVersions(subtitles),
  };

  return {
    id: String(record.id ?? makeId("proj")),
    mediaId: String(record.mediaId ?? record.id ?? makeId("media")),
    filename: String(record.filename ?? "Untitled media"),
    createdAt: Number(record.createdAt ?? now),
    updatedAt: Number(record.updatedAt ?? now),
    timestamp: Number(record.timestamp ?? now),
    activeTranscriptVersionId: transcriptVersion.id,
    transcripts: [transcriptVersion],
  };
}

export function normalizeHistoryItem(raw: unknown): HistoryItem {
  if (!isRecord(raw)) {
    return {
      id: makeId("proj"),
      mediaId: makeId("media"),
      filename: "Untitled media",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      timestamp: Date.now(),
      transcripts: [],
    };
  }

  if (!Array.isArray(raw.transcripts)) {
    return migrateLegacyHistoryItem(raw);
  }

  const normalizedTranscripts = sortTranscriptVersions(
    raw.transcripts.map((tx, index) => normalizeTranscriptVersion(tx, index))
  );
  const latest = normalizedTranscripts[normalizedTranscripts.length - 1];
  const createdAt = Number(raw.createdAt ?? raw.timestamp ?? latest?.createdAt ?? Date.now());
  const updatedAt = Number(raw.updatedAt ?? raw.timestamp ?? latest?.updatedAt ?? createdAt);
  const activeTranscriptVersionId =
    (raw.activeTranscriptVersionId && normalizedTranscripts.some((t) => t.id === raw.activeTranscriptVersionId)
      ? String(raw.activeTranscriptVersionId)
      : latest?.id) || undefined;

  return {
    id: String(raw.id ?? makeId("proj")),
    mediaId: String(raw.mediaId ?? raw.id ?? makeId("media")),
    filename: String(raw.filename ?? "Untitled media"),
    createdAt,
    updatedAt,
    timestamp: Number(raw.timestamp ?? updatedAt),
    activeTranscriptVersionId,
    transcripts: normalizedTranscripts,
  };
}
