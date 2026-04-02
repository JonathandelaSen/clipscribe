import { makeId } from "@/lib/history";

import type {
  ProjectVoiceoverConfigResponse,
  ProjectVoiceoverDraft,
  ProjectVoiceoverRecord,
  VoiceoverGenerateRequest,
  VoiceoverModelOption,
  VoiceoverOutputFormat,
  VoiceoverProviderId,
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
export const DEFAULT_VOICEOVER_MODEL = ELEVENLABS_MODEL_OPTIONS[0]!.value;

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

export function normalizeProjectVoiceoverDraft(
  draft?: Partial<ProjectVoiceoverDraft> | null,
  defaults?: Partial<Pick<ProjectVoiceoverDraft, "model" | "voiceId" | "useDefaultVoiceId">>
): ProjectVoiceoverDraft {
  const baseDefaults = createDefaultProjectVoiceoverDraft(typeof draft?.updatedAt === "number" ? draft.updatedAt : Date.now());
  const defaultModel = resolveVoiceoverModelSelection(defaults?.model);
  const defaultVoiceId = typeof defaults?.voiceId === "string" ? defaults.voiceId.trim() : "";
  const defaultUseDefaultVoiceId = typeof defaults?.useDefaultVoiceId === "boolean" ? defaults.useDefaultVoiceId : false;
  return {
    text: typeof draft?.text === "string" ? draft.text : baseDefaults.text,
    updatedAt: typeof draft?.updatedAt === "number" ? draft.updatedAt : baseDefaults.updatedAt,
    sourceFilename:
      typeof draft?.sourceFilename === "string" && draft.sourceFilename.trim() ? draft.sourceFilename.trim() : undefined,
    provider:
      draft?.provider === "elevenlabs" || draft?.provider === "openai" || draft?.provider === "gemini"
        ? draft.provider
        : baseDefaults.provider,
    model: resolveVoiceoverModelSelection(typeof draft?.model === "string" && draft.model.trim() ? draft.model.trim() : defaultModel),
    voiceId:
      typeof draft?.voiceId === "string" && draft.voiceId.trim()
        ? draft.voiceId.trim()
        : defaultVoiceId,
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
    normalizedLeft.useDefaultVoiceId === normalizedRight.useDefaultVoiceId &&
    normalizedLeft.outputFormat === normalizedRight.outputFormat
  );
}

export function sortProjectVoiceovers(records: ProjectVoiceoverRecord[]): ProjectVoiceoverRecord[] {
  return [...records].sort((left, right) => right.createdAt - left.createdAt);
}

export function resolveVoiceoverModelSelection(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (ELEVENLABS_MODEL_OPTIONS.some((option) => option.value === trimmed)) {
    return trimmed;
  }
  return ELEVENLABS_MODEL_OPTIONS[0]!.value;
}

export function buildDefaultProjectVoiceoverConfig(input?: {
  defaultModel?: string | null;
  defaultVoiceId?: string | null;
  hasApiKey?: boolean;
  maskedApiKey?: string | null;
  hasDefaultVoiceId?: boolean;
  maskedDefaultVoiceId?: string | null;
}): ProjectVoiceoverConfigResponse {
  return {
    provider: "elevenlabs",
    models: ELEVENLABS_MODEL_OPTIONS,
    defaultModel: resolveVoiceoverModelSelection(input?.defaultModel),
    defaultVoiceId: input?.defaultVoiceId?.trim() ?? "",
    hasApiKey: Boolean(input?.hasApiKey),
    maskedApiKey: input?.maskedApiKey?.trim() ?? "",
    hasDefaultVoiceId: Boolean(input?.hasDefaultVoiceId ?? input?.defaultVoiceId?.trim()),
    maskedDefaultVoiceId: input?.maskedDefaultVoiceId?.trim() ?? "",
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
    outputFormat: input.request.outputFormat,
    sourceFilename: input.sourceFilename,
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
