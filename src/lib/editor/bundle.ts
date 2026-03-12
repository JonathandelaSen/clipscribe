import type { MediaMetadataResult } from "./media";
import { clampAudioItemToAsset, clampVideoClipToAsset, ensureProjectSelection } from "./core/timeline";
import {
  createDefaultAudioTrack,
  createDefaultVideoClip,
  createEditorAssetRecord,
  createEmptyEditorProject,
  markEditorProjectSaved,
} from "./storage";
import type { EditorAspectRatio, EditorAssetRecord, EditorProjectRecord } from "./types";

const EDITOR_PROJECT_BUNDLE_SCHEMA_VERSION = 1 as const;
const VALID_ASPECT_RATIOS: EditorAspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];

type LooseRecord = Record<string, unknown>;

export interface EditorProjectBundleVideoClipSpec {
  path: string;
  label?: string;
  trimStartSeconds?: number;
  trimEndSeconds?: number | null;
  reverse?: boolean;
  volume?: number;
  muted?: boolean;
}

export interface EditorProjectBundleAudioItemSpec {
  path: string;
  trimStartSeconds?: number;
  trimEndSeconds?: number | null;
  startOffsetSeconds?: number;
  volume?: number;
  muted?: boolean;
}

export interface EditorProjectBundleManifestV1 {
  schemaVersion: typeof EDITOR_PROJECT_BUNDLE_SCHEMA_VERSION;
  createdAt: number;
  name: string;
  aspectRatio: EditorAspectRatio;
  videoClips: EditorProjectBundleVideoClipSpec[];
  audioItem?: EditorProjectBundleAudioItemSpec;
}

export interface NormalizedEditorProjectBundleVideoClipSpec {
  path: string;
  label: string;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  reverse: boolean;
  volume: number;
  muted: boolean;
}

export interface NormalizedEditorProjectBundleAudioItemSpec {
  path: string;
  trimStartSeconds: number;
  trimEndSeconds: number | null;
  startOffsetSeconds: number;
  volume: number;
  muted: boolean;
}

export interface NormalizedEditorProjectBundleManifestV1 {
  schemaVersion: typeof EDITOR_PROJECT_BUNDLE_SCHEMA_VERSION;
  createdAt: number;
  name: string;
  aspectRatio: EditorAspectRatio;
  videoClips: NormalizedEditorProjectBundleVideoClipSpec[];
  audioItem?: NormalizedEditorProjectBundleAudioItemSpec;
}

export type EditorProjectBundleBrowserFile = File & {
  webkitRelativePath?: string;
};

export interface LoadedEditorProjectBundle {
  manifest: NormalizedEditorProjectBundleManifestV1;
  filesByPath: Map<string, File>;
  rootDirectoryName?: string;
}

export interface MaterializeEditorProjectBundleInput {
  manifest: NormalizedEditorProjectBundleManifestV1;
  filesByPath: ReadonlyMap<string, File>;
  readMetadata: (file: File) => Promise<MediaMetadataResult>;
  now?: number;
  projectId?: string;
}

export interface MaterializedEditorProjectBundle {
  project: EditorProjectRecord;
  assets: EditorAssetRecord[];
  assetPathsById: Map<string, string>;
}

export interface EditorProjectBundleResolvedMedia {
  kind: "video" | "audio";
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  fileBlob?: File;
}

export interface MaterializeEditorProjectBundleWithResolverInput {
  manifest: NormalizedEditorProjectBundleManifestV1;
  resolveMedia: (bundlePath: string) => Promise<EditorProjectBundleResolvedMedia>;
  now?: number;
  projectId?: string;
}

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeEditorProjectBundlePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  return normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

function getFilenameFromPath(value: string): string {
  const normalized = normalizeEditorProjectBundlePath(value);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function getDefaultLabelFromPath(value: string): string {
  return getFilenameFromPath(value).replace(/\.[^/.]+$/, "") || "Clip";
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  const numeric = readFiniteNumber(value, label);
  if (numeric < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }
  return numeric;
}

function readVolume(value: unknown, label: string): number {
  const numeric = readFiniteNumber(value, label);
  if (numeric < 0 || numeric > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return numeric;
}

function normalizeVideoClipSpec(
  raw: unknown,
  index: number
): NormalizedEditorProjectBundleVideoClipSpec {
  if (!isRecord(raw)) {
    throw new Error(`videoClips[${index + 1}] must be an object.`);
  }

  const path = normalizeEditorProjectBundlePath(String(raw.path ?? ""));
  if (!path) {
    throw new Error(`videoClips[${index + 1}].path is required.`);
  }

  const trimStartSeconds =
    raw.trimStartSeconds == null ? 0 : readNonNegativeNumber(raw.trimStartSeconds, `videoClips[${index + 1}].trimStartSeconds`);
  const trimEndSeconds =
    raw.trimEndSeconds == null ? null : readNonNegativeNumber(raw.trimEndSeconds, `videoClips[${index + 1}].trimEndSeconds`);
  if (trimEndSeconds != null && trimEndSeconds <= trimStartSeconds) {
    throw new Error(`videoClips[${index + 1}].trimEndSeconds must be greater than trimStartSeconds.`);
  }

  const reverse = raw.reverse == null ? false : Boolean(raw.reverse);
  const volume = raw.volume == null ? 1 : readVolume(raw.volume, `videoClips[${index + 1}].volume`);
  const muted = raw.muted == null ? false : Boolean(raw.muted);
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : getDefaultLabelFromPath(path);

  return {
    path,
    label,
    trimStartSeconds,
    trimEndSeconds,
    reverse,
    volume,
    muted,
  };
}

function normalizeAudioItemSpec(raw: unknown): NormalizedEditorProjectBundleAudioItemSpec {
  if (!isRecord(raw)) {
    throw new Error("audioItem must be an object.");
  }

  const path = normalizeEditorProjectBundlePath(String(raw.path ?? ""));
  if (!path) {
    throw new Error("audioItem.path is required.");
  }

  const trimStartSeconds = raw.trimStartSeconds == null ? 0 : readNonNegativeNumber(raw.trimStartSeconds, "audioItem.trimStartSeconds");
  const trimEndSeconds = raw.trimEndSeconds == null ? null : readNonNegativeNumber(raw.trimEndSeconds, "audioItem.trimEndSeconds");
  if (trimEndSeconds != null && trimEndSeconds <= trimStartSeconds) {
    throw new Error("audioItem.trimEndSeconds must be greater than trimStartSeconds.");
  }

  return {
    path,
    trimStartSeconds,
    trimEndSeconds,
    startOffsetSeconds: raw.startOffsetSeconds == null ? 0 : readNonNegativeNumber(raw.startOffsetSeconds, "audioItem.startOffsetSeconds"),
    volume: raw.volume == null ? 1 : readVolume(raw.volume, "audioItem.volume"),
    muted: raw.muted == null ? false : Boolean(raw.muted),
  };
}

export function normalizeEditorProjectBundleManifest(raw: unknown): NormalizedEditorProjectBundleManifestV1 {
  if (!isRecord(raw)) {
    throw new Error("Bundle manifest must be a JSON object.");
  }

  const schemaVersion = Number(raw.schemaVersion ?? NaN);
  if (schemaVersion !== EDITOR_PROJECT_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported bundle schema version "${String(raw.schemaVersion ?? "")}".`);
  }

  const aspectRatio = String(raw.aspectRatio ?? "");
  if (!VALID_ASPECT_RATIOS.includes(aspectRatio as EditorAspectRatio)) {
    throw new Error(`Unsupported aspect ratio "${aspectRatio}".`);
  }

  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Untitled Timeline";
  const createdAt = raw.createdAt == null ? Date.now() : readFiniteNumber(raw.createdAt, "createdAt");
  const rawVideoClips = Array.isArray(raw.videoClips) ? raw.videoClips : [];
  if (rawVideoClips.length === 0) {
    throw new Error("Bundle manifest must include at least one video clip.");
  }

  return {
    schemaVersion: EDITOR_PROJECT_BUNDLE_SCHEMA_VERSION,
    createdAt,
    name,
    aspectRatio: aspectRatio as EditorAspectRatio,
    videoClips: rawVideoClips.map((clip, index) => normalizeVideoClipSpec(clip, index)),
    audioItem: raw.audioItem == null ? undefined : normalizeAudioItemSpec(raw.audioItem),
  };
}

export function parseEditorProjectBundleManifest(text: string): NormalizedEditorProjectBundleManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new Error(`Failed to parse bundle manifest JSON. ${message}`);
  }
  return normalizeEditorProjectBundleManifest(parsed);
}

function getSharedRootDirectory(files: readonly EditorProjectBundleBrowserFile[]): string | undefined {
  const rawPaths = files
    .map((file) => normalizeEditorProjectBundlePath(file.webkitRelativePath || file.name))
    .filter((path) => path.includes("/"));
  if (rawPaths.length !== files.length || rawPaths.length === 0) return undefined;

  const [firstRoot, ...otherRoots] = rawPaths.map((path) => path.split("/")[0]);
  return otherRoots.every((root) => root === firstRoot) ? firstRoot : undefined;
}

export function buildEditorProjectBundleFileMap(
  files: readonly EditorProjectBundleBrowserFile[]
): {
  filesByPath: Map<string, File>;
  rootDirectoryName?: string;
} {
  const rootDirectoryName = getSharedRootDirectory(files);
  const filesByPath = new Map<string, File>();

  for (const file of files) {
    const rawPath = normalizeEditorProjectBundlePath(file.webkitRelativePath || file.name);
    if (!rawPath) continue;

    const relativePath =
      rootDirectoryName && rawPath.startsWith(`${rootDirectoryName}/`)
        ? rawPath.slice(rootDirectoryName.length + 1)
        : rawPath;

    filesByPath.set(relativePath, file);
  }

  return {
    filesByPath,
    rootDirectoryName,
  };
}

export function getEditorProjectBundleExpectedPaths(
  manifest: Pick<NormalizedEditorProjectBundleManifestV1, "videoClips" | "audioItem">
): string[] {
  const paths = manifest.videoClips.map((clip) => clip.path);
  if (manifest.audioItem) paths.push(manifest.audioItem.path);
  return [...new Set(paths)];
}

export function getEditorProjectBundleMissingPaths(
  manifest: Pick<NormalizedEditorProjectBundleManifestV1, "videoClips" | "audioItem">,
  filesByPath: ReadonlyMap<string, File>
): string[] {
  return getEditorProjectBundleExpectedPaths(manifest).filter((path) => !filesByPath.has(path));
}

export async function loadEditorProjectBundleFromFiles(
  files: readonly EditorProjectBundleBrowserFile[]
): Promise<LoadedEditorProjectBundle> {
  if (files.length === 0) {
    throw new Error("Select a bundle folder that includes manifest.json.");
  }

  const { filesByPath, rootDirectoryName } = buildEditorProjectBundleFileMap(files);
  const manifestFile = filesByPath.get("manifest.json");
  if (!manifestFile) {
    throw new Error("The selected folder does not contain manifest.json at its root.");
  }

  const manifest = parseEditorProjectBundleManifest(await manifestFile.text());
  const missingPaths = getEditorProjectBundleMissingPaths(manifest, filesByPath);
  if (missingPaths.length) {
    throw new Error(`The selected bundle is missing ${missingPaths.join(", ")}.`);
  }

  return {
    manifest,
    filesByPath,
    rootDirectoryName,
  };
}

export async function materializeEditorProjectBundle(
  input: MaterializeEditorProjectBundleInput
): Promise<MaterializedEditorProjectBundle> {
  return materializeEditorProjectBundleWithResolver({
    manifest: input.manifest,
    now: input.now,
    projectId: input.projectId,
    resolveMedia: async (bundlePath) => {
      const file = input.filesByPath.get(bundlePath);
      if (!file) {
        throw new Error(`Bundle media file "${bundlePath}" is missing.`);
      }
      const metadata = await input.readMetadata(file);
      return {
        kind: metadata.kind,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        hasAudio: metadata.hasAudio,
        fileBlob: file,
      };
    },
  });
}

export async function materializeEditorProjectBundleWithResolver(
  input: MaterializeEditorProjectBundleWithResolverInput
): Promise<MaterializedEditorProjectBundle> {
  const now = input.now ?? Date.now();
  const project = createEmptyEditorProject({
    id: input.projectId,
    now,
    name: input.manifest.name,
    aspectRatio: input.manifest.aspectRatio,
  });
  const assets: EditorAssetRecord[] = [];
  const assetPathsById = new Map<string, string>();
  const assetsByBundlePath = new Map<string, EditorAssetRecord>();

  const getOrCreateAsset = async (
    bundlePath: string,
    expectedKind: "video" | "audio"
  ): Promise<EditorAssetRecord> => {
    const existingAsset = assetsByBundlePath.get(bundlePath);
    if (existingAsset) {
      if (existingAsset.kind !== expectedKind) {
        throw new Error(`Bundle media file "${bundlePath}" cannot be used as both ${existingAsset.kind} and ${expectedKind}.`);
      }
      return existingAsset;
    }

    const resolved = await input.resolveMedia(bundlePath);
    if (resolved.kind !== expectedKind) {
      if (expectedKind === "video") {
        throw new Error(`Bundle clip "${bundlePath}" must resolve to a video file.`);
      }
      throw new Error(`Bundle audio item "${bundlePath}" must resolve to an audio file.`);
    }

    const asset = createEditorAssetRecord({
      projectId: project.id,
      kind: expectedKind,
      filename: resolved.filename,
      mimeType: resolved.mimeType || (expectedKind === "video" ? "video/mp4" : "audio/mpeg"),
      sizeBytes: resolved.sizeBytes,
      durationSeconds: resolved.durationSeconds,
      width: resolved.width,
      height: resolved.height,
      hasAudio: resolved.hasAudio,
      sourceType: "upload",
      captionSource: { kind: "none" },
      fileBlob: resolved.fileBlob,
      now,
    });

    assets.push(asset);
    assetsByBundlePath.set(bundlePath, asset);
    assetPathsById.set(asset.id, bundlePath);
    return asset;
  };

  for (const clipSpec of input.manifest.videoClips) {
    const asset = await getOrCreateAsset(clipSpec.path, "video");

    const nextClip = clampVideoClipToAsset(
      {
        ...createDefaultVideoClip({
          assetId: asset.id,
          label: clipSpec.label,
          durationSeconds: asset.durationSeconds,
        }),
        trimStartSeconds: clipSpec.trimStartSeconds,
        trimEndSeconds: clipSpec.trimEndSeconds ?? asset.durationSeconds,
        volume: clipSpec.volume,
        muted: clipSpec.muted,
        actions: {
          reverse: clipSpec.reverse,
        },
      },
      asset.durationSeconds
    );
    project.timeline.videoClips.push(nextClip);
  }

  if (input.manifest.audioItem) {
    const asset = await getOrCreateAsset(input.manifest.audioItem.path, "audio");

    const audioItem = clampAudioItemToAsset(
      {
        ...createDefaultAudioTrack({
          assetId: asset.id,
          durationSeconds: asset.durationSeconds,
        }),
        trimStartSeconds: input.manifest.audioItem.trimStartSeconds,
        trimEndSeconds: input.manifest.audioItem.trimEndSeconds ?? asset.durationSeconds,
        startOffsetSeconds: input.manifest.audioItem.startOffsetSeconds,
        volume: input.manifest.audioItem.volume,
        muted: input.manifest.audioItem.muted,
      },
      asset.durationSeconds
    );
    project.timeline.audioItems = [audioItem];
  }

  project.assetIds = assets.map((asset) => asset.id);
  project.timeline.playheadSeconds = 0;
  project.timeline.videoClipGroups = [];

  return {
    project: markEditorProjectSaved(ensureProjectSelection(project), now),
    assets,
    assetPathsById,
  };
}
