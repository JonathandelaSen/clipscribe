import { makeId } from "@/lib/history";

import type {
  VoiceoverApiKeySource,
  VoiceoverGeminiGenerationConfig,
  VoiceoverLanguageOption,
  ProjectVoiceoverConfigResponse,
  ProjectVoiceoverDraft,
  ProjectVoiceoverRecord,
  VoiceoverGenerateRequest,
  VoiceoverModelOption,
  VoiceoverOutputFormat,
  VoiceoverProviderId,
  VoiceoverSpeakerConfig,
  VoiceoverUsageSummary,
  VoiceoverVoiceOption,
} from "./types";

export const DEFAULT_VOICEOVER_PROVIDER: VoiceoverProviderId = "elevenlabs";
export const DEFAULT_VOICEOVER_OUTPUT_FORMAT: VoiceoverOutputFormat = "mp3";
export const SUPPORTED_VOICEOVER_SCRIPT_EXTENSIONS = [".txt", ".md", ".srt", ".vtt"] as const;
export const ELEVENLABS_MODEL_OPTIONS: VoiceoverModelOption[] = [
  { value: "eleven_multilingual_v2", label: "Eleven Multilingual v2" },
  { value: "eleven_flash_v2_5", label: "Eleven Flash v2.5" },
  { value: "eleven_turbo_v2_5", label: "Eleven Turbo v2.5" },
  { value: "eleven_v3", label: "Eleven v3" },
];
export const GEMINI_TTS_MODEL_OPTIONS: VoiceoverModelOption[] = [
  { value: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS Preview" },
  { value: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash Preview TTS" },
  { value: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro Preview TTS" },
];
export const GEMINI_TTS_VOICE_OPTIONS: VoiceoverVoiceOption[] = [
  { value: "Zephyr", label: "Zephyr", tone: "Bright" },
  { value: "Puck", label: "Puck", tone: "Upbeat" },
  { value: "Charon", label: "Charon", tone: "Informative" },
  { value: "Kore", label: "Kore", tone: "Firm" },
  { value: "Fenrir", label: "Fenrir", tone: "Excitable" },
  { value: "Leda", label: "Leda", tone: "Youthful" },
  { value: "Orus", label: "Orus", tone: "Firm" },
  { value: "Aoede", label: "Aoede", tone: "Breezy" },
  { value: "Callirrhoe", label: "Callirrhoe", tone: "Easy-going" },
  { value: "Autonoe", label: "Autonoe", tone: "Bright" },
  { value: "Enceladus", label: "Enceladus", tone: "Breathy" },
  { value: "Iapetus", label: "Iapetus", tone: "Clear" },
  { value: "Umbriel", label: "Umbriel", tone: "Easy-going" },
  { value: "Algieba", label: "Algieba", tone: "Smooth" },
  { value: "Despina", label: "Despina", tone: "Smooth" },
  { value: "Erinome", label: "Erinome", tone: "Clear" },
  { value: "Algenib", label: "Algenib", tone: "Gravelly" },
  { value: "Rasalgethi", label: "Rasalgethi", tone: "Informative" },
  { value: "Laomedeia", label: "Laomedeia", tone: "Upbeat" },
  { value: "Achernar", label: "Achernar", tone: "Soft" },
  { value: "Alnilam", label: "Alnilam", tone: "Firm" },
  { value: "Schedar", label: "Schedar", tone: "Even" },
  { value: "Gacrux", label: "Gacrux", tone: "Mature" },
  { value: "Pulcherrima", label: "Pulcherrima", tone: "Forward" },
  { value: "Achird", label: "Achird", tone: "Friendly" },
  { value: "Zubenelgenubi", label: "Zubenelgenubi", tone: "Casual" },
  { value: "Vindemiatrix", label: "Vindemiatrix", tone: "Gentle" },
  { value: "Sadachbia", label: "Sadachbia", tone: "Lively" },
  { value: "Sadaltager", label: "Sadaltager", tone: "Knowledgeable" },
  { value: "Sulafat", label: "Sulafat", tone: "Warm" },
];
export const GEMINI_TTS_LANGUAGE_OPTIONS: VoiceoverLanguageOption[] = [
  { value: "de-DE", label: "German (Germany)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-US", label: "English (United States)" },
  { value: "es-US", label: "Spanish (United States)" },
  { value: "fr-FR", label: "French (France)" },
  { value: "hi-IN", label: "Hindi (India)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ar-XA", label: "Arabic" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "fr-CA", label: "French (Canada)" },
  { value: "id-ID", label: "Indonesian" },
  { value: "it-IT", label: "Italian" },
  { value: "ja-JP", label: "Japanese" },
  { value: "tr-TR", label: "Turkish" },
  { value: "vi-VN", label: "Vietnamese" },
  { value: "bn-IN", label: "Bangla (India)" },
  { value: "gu-IN", label: "Gujarati (India)" },
  { value: "kn-IN", label: "Kannada (India)" },
  { value: "ml-IN", label: "Malayalam (India)" },
  { value: "mr-IN", label: "Marathi (India)" },
  { value: "ta-IN", label: "Tamil (India)" },
  { value: "te-IN", label: "Telugu (India)" },
  { value: "nl-NL", label: "Dutch (Netherlands)" },
  { value: "ko-KR", label: "Korean" },
  { value: "cmn-CN", label: "Chinese, Mandarin" },
  { value: "pl-PL", label: "Polish" },
  { value: "ru-RU", label: "Russian" },
  { value: "th-TH", label: "Thai" },
];
export const DEFAULT_GEMINI_TTS_MODEL = GEMINI_TTS_MODEL_OPTIONS[0]!.value;
export const DEFAULT_GEMINI_TTS_VOICE = "Kore";
export const DEFAULT_VOICEOVER_MODEL = ELEVENLABS_MODEL_OPTIONS[0]!.value;
const VOICEOVER_MODEL_USD_PER_1K_CHARS: Record<string, number> = {
  eleven_flash_v2_5: 0.06,
  eleven_turbo_v2_5: 0.06,
  eleven_multilingual_v2: 0.12,
  eleven_v3: 0.12,
};
const GEMINI_TTS_INPUT_USD_PER_1M_TOKENS = 1;
const GEMINI_TTS_OUTPUT_USD_PER_1M_TOKENS = 20;
const VOICEOVER_MODEL_CREDIT_MULTIPLIER_RANGE: Record<string, readonly [number, number]> = {
  eleven_flash_v2_5: [0.5, 1],
  eleven_turbo_v2_5: [0.5, 1],
  eleven_multilingual_v2: [1, 1],
  eleven_v3: [1, 1],
};

const SRT_VTT_TIMESTAMP_RE =
  /^\s*(\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(\d{2}:)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function collapseBlankLines(lines: string[]): string {
  const result: string[] = [];
  let previousWasBlank = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!previousWasBlank) {
        result.push("");
      }
      previousWasBlank = true;
      continue;
    }

    result.push(trimmed);
    previousWasBlank = false;
  }

  return result.join("\n").trim();
}

export function maskVoiceoverSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function createDefaultProjectVoiceoverDraft(now = Date.now()): ProjectVoiceoverDraft {
  return {
    text: "",
    updatedAt: now,
    provider: DEFAULT_VOICEOVER_PROVIDER,
    model: DEFAULT_VOICEOVER_MODEL,
    voiceId: "",
    useDefaultVoiceId: false,
    outputFormat: DEFAULT_VOICEOVER_OUTPUT_FORMAT,
  };
}

function normalizeGeminiVoiceName(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  return GEMINI_TTS_VOICE_OPTIONS.some((option) => option.value === trimmed)
    ? trimmed
    : DEFAULT_GEMINI_TTS_VOICE;
}

function normalizeGeminiLanguageCode(value?: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return GEMINI_TTS_LANGUAGE_OPTIONS.some((option) => option.value === trimmed) ? trimmed : undefined;
}

function normalizeGeminiSpeakers(value: unknown, fallbackVoiceName: string): VoiceoverSpeakerConfig[] {
  const defaults: VoiceoverSpeakerConfig[] = [
    { speaker: "Speaker1", voiceName: fallbackVoiceName },
    { speaker: "Speaker2", voiceName: "Puck" },
  ];
  if (!Array.isArray(value)) return defaults;

  const normalized = value.slice(0, 2).map((entry, index) => {
    const record = entry && typeof entry === "object" ? (entry as Partial<VoiceoverSpeakerConfig>) : {};
    const speaker = typeof record.speaker === "string" && record.speaker.trim() ? record.speaker.trim() : defaults[index]!.speaker;
    const voiceName = normalizeGeminiVoiceName(record.voiceName ?? defaults[index]!.voiceName);
    return { speaker, voiceName };
  });

  return normalized.length === 2 ? normalized : defaults;
}

function normalizeFiniteNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === "" || value == null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = normalizeFiniteNumber(value, min, max);
  return parsed == null ? undefined : Math.round(parsed);
}

export function normalizeGeminiGenerationConfig(value?: Partial<VoiceoverGeminiGenerationConfig> | null): VoiceoverGeminiGenerationConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stopSequences = Array.isArray(value.stopSequences)
    ? value.stopSequences
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 5)
    : undefined;
  const config: VoiceoverGeminiGenerationConfig = {
    temperature: normalizeFiniteNumber(value.temperature, 0, 2),
    topP: normalizeFiniteNumber(value.topP, 0, 1),
    topK: normalizeInteger(value.topK, 1, 100),
    seed: normalizeInteger(value.seed, -2147483648, 2147483647),
    candidateCount: normalizeInteger(value.candidateCount, 1, 4),
    maxOutputTokens: normalizeInteger(value.maxOutputTokens, 1, 32768),
    stopSequences: stopSequences && stopSequences.length > 0 ? stopSequences : undefined,
  };
  return Object.values(config).some((item) => item !== undefined) ? config : undefined;
}

export function normalizeProjectVoiceoverDraft(
  draft?: Partial<ProjectVoiceoverDraft> | null,
  defaults?: Partial<Pick<ProjectVoiceoverDraft, "model" | "voiceId" | "useDefaultVoiceId">>
): ProjectVoiceoverDraft {
  const baseDefaults = createDefaultProjectVoiceoverDraft(typeof draft?.updatedAt === "number" ? draft.updatedAt : Date.now());
  const defaultModel = resolveVoiceoverModelSelection(defaults?.model);
  const defaultVoiceId = typeof defaults?.voiceId === "string" ? defaults.voiceId.trim() : "";
  const defaultUseDefaultVoiceId = typeof defaults?.useDefaultVoiceId === "boolean" ? defaults.useDefaultVoiceId : false;
  const provider =
    draft?.provider === "elevenlabs" || draft?.provider === "openai" || draft?.provider === "gemini"
      ? draft.provider
      : baseDefaults.provider;
  const voiceName = normalizeGeminiVoiceName(draft?.voiceName);
  return {
    text: typeof draft?.text === "string" ? draft.text : baseDefaults.text,
    updatedAt: typeof draft?.updatedAt === "number" ? draft.updatedAt : baseDefaults.updatedAt,
    sourceFilename:
      typeof draft?.sourceFilename === "string" && draft.sourceFilename.trim() ? draft.sourceFilename.trim() : undefined,
    provider,
    model: resolveVoiceoverModelSelection(typeof draft?.model === "string" && draft.model.trim() ? draft.model.trim() : defaultModel, provider),
    voiceId:
      typeof draft?.voiceId === "string" && draft.voiceId.trim()
        ? draft.voiceId.trim()
        : defaultVoiceId,
    voiceName,
    languageCode: normalizeGeminiLanguageCode(draft?.languageCode),
    speakerMode: draft?.speakerMode === "multi" ? "multi" : "single",
    speakers: normalizeGeminiSpeakers(draft?.speakers, voiceName),
    stylePrompt: typeof draft?.stylePrompt === "string" && draft.stylePrompt.trim() ? draft.stylePrompt.trim() : undefined,
    generationConfig: normalizeGeminiGenerationConfig(draft?.generationConfig),
    useDefaultVoiceId: typeof draft?.useDefaultVoiceId === "boolean" ? draft.useDefaultVoiceId : defaultUseDefaultVoiceId,
    outputFormat: draft?.outputFormat === "wav" ? "wav" : baseDefaults.outputFormat,
  };
}

export function areProjectVoiceoverDraftsEqual(
  left: ProjectVoiceoverDraft | null | undefined,
  right: ProjectVoiceoverDraft | null | undefined
): boolean {
  const normalizedLeft = normalizeProjectVoiceoverDraft(left);
  const normalizedRight = normalizeProjectVoiceoverDraft(right);
  return (
    normalizedLeft.text === normalizedRight.text &&
    normalizedLeft.sourceFilename === normalizedRight.sourceFilename &&
    normalizedLeft.provider === normalizedRight.provider &&
    normalizedLeft.model === normalizedRight.model &&
    normalizedLeft.voiceId === normalizedRight.voiceId &&
    normalizedLeft.voiceName === normalizedRight.voiceName &&
    normalizedLeft.languageCode === normalizedRight.languageCode &&
    normalizedLeft.speakerMode === normalizedRight.speakerMode &&
    JSON.stringify(normalizedLeft.speakers ?? []) === JSON.stringify(normalizedRight.speakers ?? []) &&
    normalizedLeft.stylePrompt === normalizedRight.stylePrompt &&
    JSON.stringify(normalizedLeft.generationConfig ?? {}) === JSON.stringify(normalizedRight.generationConfig ?? {}) &&
    normalizedLeft.useDefaultVoiceId === normalizedRight.useDefaultVoiceId &&
    normalizedLeft.outputFormat === normalizedRight.outputFormat
  );
}

export function sortProjectVoiceovers(records: ProjectVoiceoverRecord[]): ProjectVoiceoverRecord[] {
  return [...records].sort((left, right) => right.createdAt - left.createdAt);
}

export function resolveVoiceoverModelSelection(value?: string | null, provider: VoiceoverProviderId = DEFAULT_VOICEOVER_PROVIDER): string {
  const trimmed = value?.trim() ?? "";
  const options = provider === "gemini" ? GEMINI_TTS_MODEL_OPTIONS : ELEVENLABS_MODEL_OPTIONS;
  if (options.some((option) => option.value === trimmed)) {
    return trimmed;
  }
  return options[0]!.value;
}

export function buildDefaultProjectVoiceoverConfig(input?: {
  defaultModel?: string | null;
  defaultVoiceId?: string | null;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
  hasDefaultVoiceId?: boolean;
  maskedDefaultVoiceId?: string | null;
  geminiDefaultModel?: string | null;
  geminiHasApiKey?: boolean;
  geminiMaskedApiKey?: string | null;
}): ProjectVoiceoverConfigResponse {
  const elevenLabsDefaultModel = resolveVoiceoverModelSelection(input?.defaultModel, "elevenlabs");
  const geminiDefaultModel = resolveVoiceoverModelSelection(input?.geminiDefaultModel, "gemini");
  return {
    provider: DEFAULT_VOICEOVER_PROVIDER,
    models: ELEVENLABS_MODEL_OPTIONS,
    defaultModel: elevenLabsDefaultModel,
    defaultVoiceId: input?.defaultVoiceId?.trim() ?? "",
    hasApiKey: Boolean(input?.hasApiKey),
    maskedApiKey: input?.maskedApiKey?.trim() ?? "",
    hasDefaultVoiceId: Boolean(input?.hasDefaultVoiceId ?? input?.defaultVoiceId?.trim()),
    maskedDefaultVoiceId: input?.maskedDefaultVoiceId?.trim() ?? "",
    providers: {
      elevenlabs: {
        provider: "elevenlabs",
        label: "ElevenLabs",
        models: ELEVENLABS_MODEL_OPTIONS,
        defaultModel: elevenLabsDefaultModel,
        hasApiKey: Boolean(input?.hasApiKey),
        maskedApiKey: input?.maskedApiKey?.trim() ?? "",
        defaultVoiceId: input?.defaultVoiceId?.trim() ?? "",
        hasDefaultVoiceId: Boolean(input?.hasDefaultVoiceId ?? input?.defaultVoiceId?.trim()),
        maskedDefaultVoiceId: input?.maskedDefaultVoiceId?.trim() ?? "",
      },
      gemini: {
        provider: "gemini",
        label: "Google Gemini",
        models: GEMINI_TTS_MODEL_OPTIONS,
        defaultModel: geminiDefaultModel,
        hasApiKey: Boolean(input?.geminiHasApiKey),
        maskedApiKey: input?.geminiMaskedApiKey?.trim() ?? "",
        voices: GEMINI_TTS_VOICE_OPTIONS,
        defaultVoiceName: DEFAULT_GEMINI_TTS_VOICE,
        languages: GEMINI_TTS_LANGUAGE_OPTIONS,
      },
    },
  };
}

export function resolveVoiceoverModelUsdPer1kChars(model: string): number | null {
  return VOICEOVER_MODEL_USD_PER_1K_CHARS[model] ?? null;
}

export function estimateVoiceoverCostUsd(model: string, billedCharacters: number): number | null {
  const usdPer1kChars = resolveVoiceoverModelUsdPer1kChars(model);
  if (usdPer1kChars == null || !Number.isFinite(billedCharacters) || billedCharacters < 0) {
    return null;
  }

  return (billedCharacters / 1000) * usdPer1kChars;
}

export function estimateGeminiTtsCostUsd(input: {
  promptTokens?: number;
  completionTokens?: number;
}): number | null {
  const promptTokens = Math.max(0, Math.round(input.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.round(input.completionTokens ?? 0));
  if (!promptTokens && !completionTokens) return null;

  return Number(
    (
      (promptTokens / 1_000_000) * GEMINI_TTS_INPUT_USD_PER_1M_TOKENS +
      (completionTokens / 1_000_000) * GEMINI_TTS_OUTPUT_USD_PER_1M_TOKENS
    ).toFixed(6)
  );
}

export function estimateVoiceoverCredits(model: string, billedCharacters: number): {
  min: number;
  max: number;
} {
  const [minMultiplier, maxMultiplier] = VOICEOVER_MODEL_CREDIT_MULTIPLIER_RANGE[model] ?? [1, 1];
  const normalizedChars = Math.max(0, Math.round(billedCharacters));

  return {
    min: Math.round(normalizedChars * minMultiplier),
    max: Math.round(normalizedChars * maxMultiplier),
  };
}

export function estimateVoiceoverUsage(input: {
  model: string;
  scriptText: string;
  source?: VoiceoverUsageSummary["source"];
  billedCharacters?: number;
}): VoiceoverUsageSummary {
  const billedCharacters = Math.max(
    0,
    Math.round(
      typeof input.billedCharacters === "number" && Number.isFinite(input.billedCharacters)
        ? input.billedCharacters
        : input.scriptText.length
    )
  );
  const estimatedCredits = estimateVoiceoverCredits(input.model, billedCharacters);

  return {
    billedCharacters,
    source: input.source ?? "estimated",
    estimatedCostUsd: estimateVoiceoverCostUsd(input.model, billedCharacters),
    estimatedCreditsMin: estimatedCredits.min,
    estimatedCreditsMax: estimatedCredits.max,
  };
}

export function resolveVoiceoverOutputFileInfo(outputFormat: VoiceoverOutputFormat): {
  extension: string;
  mimeType: string;
} {
  if (outputFormat === "wav") {
    return {
      extension: "wav",
      mimeType: "audio/wav",
    };
  }

  return {
    extension: "mp3",
    mimeType: "audio/mpeg",
  };
}

export function buildProjectVoiceoverFilename(input: {
  projectName?: string;
  provider: VoiceoverProviderId;
  outputFormat: VoiceoverOutputFormat;
  createdAt?: number;
}): string {
  const { extension } = resolveVoiceoverOutputFileInfo(input.outputFormat);
  const timestamp = new Date(input.createdAt ?? Date.now())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const projectSlug = (input.projectName ?? "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

  return `${projectSlug || "project"}-voiceover-${input.provider}-${timestamp}.${extension}`;
}

export function buildProjectVoiceoverRecord(input: {
  projectId: string;
  assetId: string;
  request: VoiceoverGenerateRequest;
  scriptText: string;
  sourceFilename?: string;
  apiKeySource?: VoiceoverApiKeySource;
  maskedApiKey?: string;
  usage?: VoiceoverUsageSummary;
  createdAt?: number;
}): ProjectVoiceoverRecord {
  return {
    id: makeId("voiceover"),
    projectId: input.projectId,
    assetId: input.assetId,
    createdAt: input.createdAt ?? Date.now(),
    scriptText: input.scriptText,
    provider: input.request.provider,
    model: input.request.model,
    voiceId: input.request.voiceId,
    voiceName: input.request.voiceName,
    languageCode: input.request.languageCode,
    speakerMode: input.request.speakerMode,
    speakers: input.request.speakers,
    stylePrompt: input.request.stylePrompt,
    generationConfig: input.request.generationConfig,
    outputFormat: input.request.outputFormat,
    sourceFilename: input.sourceFilename,
    apiKeySource: input.apiKeySource,
    maskedApiKey: input.maskedApiKey?.trim() || undefined,
    usage: input.usage,
  };
}

export function buildProjectVoiceoverDraftFromRecord(
  record: Pick<
    ProjectVoiceoverRecord,
    "scriptText" | "provider" | "model" | "voiceId" | "outputFormat" | "sourceFilename" | "createdAt"
    | "voiceName" | "languageCode" | "speakerMode" | "speakers" | "stylePrompt" | "generationConfig"
  >,
  now = Date.now()
): ProjectVoiceoverDraft {
  return normalizeProjectVoiceoverDraft({
    text: record.scriptText,
    provider: record.provider,
    model: record.model,
    voiceId: record.voiceId,
    voiceName: record.voiceName,
    languageCode: record.languageCode,
    speakerMode: record.speakerMode,
    speakers: record.speakers,
    stylePrompt: record.stylePrompt,
    generationConfig: record.generationConfig,
    outputFormat: record.outputFormat,
    sourceFilename: record.sourceFilename,
    updatedAt: typeof now === "number" && Number.isFinite(now) ? now : record.createdAt,
  });
}

export function getProjectVoiceoverApiKeyLabel(source?: VoiceoverApiKeySource): string {
  if (source === "voiceover_settings") return "Voiceover settings";
  if (source === "env") return ".env";
  return "Unknown";
}

export function getProjectVoiceoverReplayStatus(
  record: Pick<ProjectVoiceoverRecord, "apiKeySource" | "maskedApiKey">,
  options: {
    hasLocalApiKey: boolean;
  }
): {
  sourceLabel: string;
  maskedApiKey?: string;
  needsLocalApiKey: boolean;
  readyToReplay: boolean;
  message: string;
} {
  const sourceLabel = getProjectVoiceoverApiKeyLabel(record.apiKeySource);
  const maskedApiKey = record.maskedApiKey?.trim() || undefined;
  const needsLocalApiKey = record.apiKeySource === "voiceover_settings" && !options.hasLocalApiKey;

  if (record.apiKeySource === "voiceover_settings") {
    return {
      sourceLabel,
      maskedApiKey,
      needsLocalApiKey,
      readyToReplay: !needsLocalApiKey,
      message: needsLocalApiKey
        ? "This run used a saved local API key. Paste a key again to reproduce it."
        : "This run used the API key currently saved in Voiceover settings.",
    };
  }

  if (record.apiKeySource === "env") {
    return {
      sourceLabel,
      maskedApiKey,
      needsLocalApiKey: false,
      readyToReplay: true,
      message: "This run used the server-side .env key.",
    };
  }

  return {
    sourceLabel,
    maskedApiKey,
    needsLocalApiKey: false,
    readyToReplay: options.hasLocalApiKey,
    message: "This older run has no stored API key metadata.",
  };
}

export function isSupportedVoiceoverScriptFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return SUPPORTED_VOICEOVER_SCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function extractVoiceoverTextFromFileContents(filename: string, rawText: string): string {
  const normalized = normalizeWhitespace(rawText);
  const lower = filename.trim().toLowerCase();
  if (!lower.endsWith(".srt") && !lower.endsWith(".vtt")) {
    return normalized.trim();
  }

  const sourceLines = normalized.split("\n");
  const filtered: string[] = [];
  let skipNoteBlock = false;

  for (const line of sourceLines) {
    const trimmed = line.trim();

    if (!trimmed) {
      skipNoteBlock = false;
      filtered.push("");
      continue;
    }

    if (lower.endsWith(".vtt") && /^WEBVTT$/i.test(trimmed)) {
      continue;
    }

    if (/^NOTE(?:\s|$)/i.test(trimmed)) {
      skipNoteBlock = true;
      continue;
    }

    if (skipNoteBlock) {
      continue;
    }

    if (SRT_VTT_TIMESTAMP_RE.test(trimmed)) {
      continue;
    }

    if (/^\d+$/.test(trimmed)) {
      continue;
    }

    filtered.push(trimmed);
  }

  return collapseBlankLines(filtered);
}
