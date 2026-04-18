import { ensureProjectSelection } from "./core/timeline";
import { normalizeEditorProjectBundlePath } from "./bundle";
import { normalizeLegacyEditorProjectRecord, serializeEditorProjectForPersistence } from "./storage";
import type { CaptionSourceRef, EditorAssetRecord, EditorExternalSourceRef, EditorProjectRecord } from "./types";

const EDITOR_PROJECT_WORKSPACE_SCHEMA_VERSION = 1 as const;

type LooseRecord = Record<string, unknown>;

export const EDITOR_PROJECT_WORKSPACE_FILENAME = "project.json";

export interface EditorProjectWorkspaceAssetV1 extends Omit<EditorAssetRecord, "fileBlob"> {
  path: string;
}

export interface EditorProjectWorkspaceV1 {
  schemaVersion: typeof EDITOR_PROJECT_WORKSPACE_SCHEMA_VERSION;
  createdAt: number;
  project: EditorProjectRecord;
  assets: EditorProjectWorkspaceAssetV1[];
}

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function readOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  return readFiniteNumber(value, label);
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function normalizeWorkspaceAssetPath(value: string, label: string): string {
  const rawValue = value.trim().replace(/\\/g, "/");
  if (rawValue.startsWith("/") || /^[A-Za-z]:\//.test(rawValue)) {
    throw new Error(`${label} must stay inside the project workspace.`);
  }
  const normalized = normalizeEditorProjectBundlePath(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`${label} must stay inside the project workspace.`);
  }
  return normalized;
}

function normalizeCaptionSource(raw: unknown, label: string): CaptionSourceRef {
  if (!isRecord(raw)) {
    throw new Error(`${label} must be an object.`);
  }

  const kind = String(raw.kind ?? "");
  if (kind === "none") {
    return { kind: "none" };
  }
  if (kind === "history-subtitle") {
    return {
      kind,
      sourceProjectId: readRequiredString(raw.sourceProjectId, `${label}.sourceProjectId`),
      transcriptId: readRequiredString(raw.transcriptId, `${label}.transcriptId`),
      subtitleId: readRequiredString(raw.subtitleId, `${label}.subtitleId`),
      language: readRequiredString(raw.language, `${label}.language`),
      label: readRequiredString(raw.label, `${label}.label`),
    };
  }
  if (kind === "asset-subtitle") {
    return {
      kind,
      sourceAssetId: readRequiredString(raw.sourceAssetId, `${label}.sourceAssetId`),
      transcriptId: readRequiredString(raw.transcriptId, `${label}.transcriptId`),
      subtitleId: readRequiredString(raw.subtitleId, `${label}.subtitleId`),
      language: readRequiredString(raw.language, `${label}.language`),
      label: readRequiredString(raw.label, `${label}.label`),
    };
  }
  if (kind === "embedded-srt") {
    return {
      kind,
      label: readRequiredString(raw.label, `${label}.label`),
      language: typeof raw.language === "string" && raw.language.trim() ? raw.language.trim() : undefined,
      chunks: Array.isArray(raw.chunks) ? raw.chunks : [],
    };
  }
  throw new Error(`${label}.kind "${kind}" is not supported.`);
}

function normalizeExternalSource(raw: unknown, label: string): EditorExternalSourceRef | undefined {
  if (raw == null) return undefined;
  if (!isRecord(raw)) {
    throw new Error(`${label} must be an object.`);
  }

  const kind = String(raw.kind ?? "");
  if (kind === "youtube") {
    return {
      kind,
      url: readRequiredString(raw.url, `${label}.url`),
      videoId: readRequiredString(raw.videoId, `${label}.videoId`),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined,
      channelTitle: typeof raw.channelTitle === "string" && raw.channelTitle.trim() ? raw.channelTitle.trim() : undefined,
    };
  }

  throw new Error(`${label}.kind "${kind}" is not supported.`);
}

function normalizeWorkspaceAsset(
  raw: unknown,
  index: number,
  projectId: string
): EditorProjectWorkspaceAssetV1 {
  if (!isRecord(raw)) {
    throw new Error(`assets[${index + 1}] must be an object.`);
  }

  const kind = raw.kind === "video" || raw.kind === "audio" || raw.kind === "image" ? raw.kind : null;
  if (!kind) {
    throw new Error(`assets[${index + 1}].kind must be "video", "audio", or "image".`);
  }

  const sourceType =
    raw.sourceType === "upload" || raw.sourceType === "history" || raw.sourceType === "youtube" ? raw.sourceType : null;
  if (!sourceType) {
    throw new Error(`assets[${index + 1}].sourceType must be "upload", "history", or "youtube".`);
  }

  return {
    id: readRequiredString(raw.id, `assets[${index + 1}].id`),
    projectId:
      typeof raw.projectId === "string" && raw.projectId.trim()
        ? raw.projectId.trim()
        : projectId,
    role: raw.role === "source" || raw.role === "derived" || raw.role === "support" ? raw.role : "support",
    origin:
      raw.origin === "upload" ||
      raw.origin === "short-export" ||
      raw.origin === "timeline-export" ||
      raw.origin === "manual" ||
      raw.origin === "ai-audio" ||
      raw.origin === "youtube-import"
        ? raw.origin
        : "manual",
    sourceType,
    kind,
    filename: readRequiredString(raw.filename, `assets[${index + 1}].filename`),
    mimeType: readRequiredString(raw.mimeType, `assets[${index + 1}].mimeType`),
    sizeBytes: readFiniteNumber(raw.sizeBytes, `assets[${index + 1}].sizeBytes`),
    durationSeconds: readFiniteNumber(raw.durationSeconds, `assets[${index + 1}].durationSeconds`),
    width: readOptionalFiniteNumber(raw.width, `assets[${index + 1}].width`),
    height: readOptionalFiniteNumber(raw.height, `assets[${index + 1}].height`),
    hasAudio: raw.hasAudio == null ? undefined : Boolean(raw.hasAudio),
    derivedFromAssetId: typeof raw.derivedFromAssetId === "string" && raw.derivedFromAssetId.trim() ? raw.derivedFromAssetId.trim() : undefined,
    sourceAssetId: typeof raw.sourceAssetId === "string" && raw.sourceAssetId.trim() ? raw.sourceAssetId.trim() : undefined,
    sourceMediaId: typeof raw.sourceMediaId === "string" && raw.sourceMediaId.trim() ? raw.sourceMediaId.trim() : undefined,
    sourceProjectId: typeof raw.sourceProjectId === "string" && raw.sourceProjectId.trim() ? raw.sourceProjectId.trim() : undefined,
    externalSource: normalizeExternalSource(raw.externalSource, `assets[${index + 1}].externalSource`),
    createdAt: readFiniteNumber(raw.createdAt, `assets[${index + 1}].createdAt`),
    updatedAt: readFiniteNumber(raw.updatedAt, `assets[${index + 1}].updatedAt`),
    captionSource: normalizeCaptionSource(raw.captionSource, `assets[${index + 1}].captionSource`),
    path: normalizeWorkspaceAssetPath(String(raw.path ?? ""), `assets[${index + 1}].path`),
  };
}

function normalizeWorkspaceProject(
  raw: unknown,
  assets: readonly EditorProjectWorkspaceAssetV1[]
): EditorProjectRecord {
  if (!isRecord(raw)) {
    throw new Error("project must be an object.");
  }

  const normalizedProject = ensureProjectSelection(
    normalizeLegacyEditorProjectRecord(raw as unknown as EditorProjectRecord)
  );

  return serializeEditorProjectForPersistence(
    {
      ...normalizedProject,
      assetIds: assets.map((asset) => asset.id),
    },
    normalizedProject.timeline.playheadSeconds
  );
}

export function createEditorProjectWorkspace(input: {
  project: EditorProjectRecord;
  assets: readonly EditorAssetRecord[];
  assetPathsById: ReadonlyMap<string, string>;
  createdAt?: number;
}): EditorProjectWorkspaceV1 {
  const assets = input.assets.map((asset) => {
    const assetPath = input.assetPathsById.get(asset.id);
    if (!assetPath) {
      throw new Error(`Workspace asset path is missing for ${asset.id}.`);
    }
    const rest = { ...asset };
    delete rest.fileBlob;
    return {
      ...rest,
      projectId: input.project.id,
      path: normalizeWorkspaceAssetPath(assetPath, `asset ${asset.id} path`),
    };
  });

  return {
    schemaVersion: EDITOR_PROJECT_WORKSPACE_SCHEMA_VERSION,
    createdAt: input.createdAt ?? Date.now(),
    project: normalizeWorkspaceProject(input.project, assets),
    assets,
  };
}

export function normalizeEditorProjectWorkspace(raw: unknown): EditorProjectWorkspaceV1 {
  if (!isRecord(raw)) {
    throw new Error("Project workspace must be a JSON object.");
  }

  const schemaVersion = Number(raw.schemaVersion ?? NaN);
  if (schemaVersion !== EDITOR_PROJECT_WORKSPACE_SCHEMA_VERSION) {
    throw new Error(`Unsupported project workspace schema version "${String(raw.schemaVersion ?? "")}".`);
  }

  const provisionalProjectId =
    isRecord(raw.project) && typeof raw.project.id === "string" && raw.project.id.trim()
      ? raw.project.id.trim()
      : "workspace-project";
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map((asset, index) => normalizeWorkspaceAsset(asset, index, provisionalProjectId))
    : [];
  const project = normalizeWorkspaceProject(raw.project, assets);

  return {
    schemaVersion: EDITOR_PROJECT_WORKSPACE_SCHEMA_VERSION,
    createdAt: raw.createdAt == null ? Date.now() : readFiniteNumber(raw.createdAt, "createdAt"),
    project,
    assets: assets.map((asset) => ({
      ...asset,
      projectId: project.id,
    })),
  };
}

export function parseEditorProjectWorkspace(text: string): EditorProjectWorkspaceV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Failed to parse project workspace JSON. ${message}`);
  }
  return normalizeEditorProjectWorkspace(parsed);
}

export function serializeEditorProjectWorkspace(workspace: EditorProjectWorkspaceV1): string {
  return `${JSON.stringify(workspace, null, 2)}\n`;
}
