import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getEditorExportCapability } from "../editor/export-capabilities";
import { buildEditorExportFilename } from "../editor/export-output";
import {
  EDITOR_SYSTEM_EXPORT_FORM_FIELDS,
  type EditorSystemExportAssetDescriptor,
  type EditorSystemExportOverlayDescriptor,
} from "../editor/system-export-contract";
import {
  exportEditorProjectWithSystemFfmpeg,
  isNodeEditorExportCanceledError,
  type NodeEditorExportProgress,
  type NodeEditorExportAsset,
  type NodeEditorExportOverlay,
  type NodeEditorExportResult,
} from "../editor/node-render";
import type { EditorAssetRecord, EditorProjectRecord, EditorResolution } from "../editor/types";

type LooseRecord = Record<string, unknown>;

export interface EditorSystemExportUpload {
  asset: EditorAssetRecord;
  file: File;
}

export interface ParsedEditorSystemExportFormData {
  engine: "system";
  project: EditorProjectRecord;
  resolution: EditorResolution;
  assets: EditorSystemExportUpload[];
  overlays: Array<{
    descriptor: EditorSystemExportOverlayDescriptor;
    file: File;
  }>;
}

export interface RenderedEditorSystemExportResult {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  warnings: string[];
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

export interface EditorSystemExportDependencies {
  exportProject?: (input: Parameters<typeof exportEditorProjectWithSystemFfmpeg>[0]) => Promise<NodeEditorExportResult>;
}

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function sanitizeFilenameSegment(value: string, fallback: string) {
  const basename = path.basename(value || fallback);
  const normalized = basename.replace(/[^\w.-]+/g, "_");
  return normalized || fallback;
}

function toOwnedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

function parseJson<T>(value: FormDataEntryValue | null, label: string): T {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function isEditorResolution(value: unknown): value is EditorResolution {
  return value === "720p" || value === "1080p" || value === "4K";
}

function parseAssetDescriptor(value: unknown, index: number): EditorSystemExportAssetDescriptor {
  if (!isRecord(value) || !isRecord(value.asset)) {
    throw new Error(`assets[${index}] is invalid.`);
  }
  if (typeof value.fileField !== "string" || !value.fileField.trim()) {
    throw new Error(`assets[${index}].fileField is required.`);
  }

  return {
    asset: value.asset as EditorSystemExportAssetDescriptor["asset"],
    fileField: value.fileField,
  };
}

function parseOverlayDescriptor(value: unknown, index: number): EditorSystemExportOverlayDescriptor {
  if (!isRecord(value)) {
    throw new Error(`overlays[${index}] is invalid.`);
  }
  if (typeof value.fileField !== "string" || !value.fileField.trim()) {
    throw new Error(`overlays[${index}].fileField is required.`);
  }
  if (typeof value.filename !== "string" || !value.filename.trim()) {
    throw new Error(`overlays[${index}].filename is required.`);
  }
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`overlays[${index}] must include a valid time range.`);
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    throw new Error(`overlays[${index}] must include finite x, y, width, and height.`);
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`overlays[${index}] must include positive raster bounds.`);
  }

  return {
    start,
    end,
    fileField: value.fileField,
    filename: value.filename,
    x,
    y,
    width,
    height,
    cropExpression: typeof value.cropExpression === "string" && value.cropExpression.trim() ? value.cropExpression.trim() : undefined,
  };
}

export function parseEditorSystemExportFormData(formData: FormData): ParsedEditorSystemExportFormData {
  const project = parseJson<EditorProjectRecord>(
    formData.get(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.project),
    "project"
  );
  const resolutionValue = formData.get(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.resolution);
  if (typeof resolutionValue !== "string" || !isEditorResolution(resolutionValue)) {
    throw new Error("resolution must be one of 720p, 1080p, or 4K.");
  }

  const engine = formData.get(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.engine);
  if (engine !== "system") {
    throw new Error("engine must be system.");
  }

  const rawDescriptors = parseJson<unknown[]>(
    formData.get(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.assets),
    "assets"
  );
  const descriptors = rawDescriptors.map((value, index) => parseAssetDescriptor(value, index));
  const assets = descriptors.map(({ asset, fileField }, index) => {
    const fileValue = formData.get(fileField);
    if (!(fileValue instanceof File)) {
      throw new Error(`assets[${index}] file is required.`);
    }
    return {
      asset: asset as EditorAssetRecord,
      file: fileValue,
    };
  });
  const rawOverlayDescriptors = parseJson<unknown[]>(
    formData.get(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.overlays) ?? "[]",
    "overlays"
  );
  const overlayDescriptors = rawOverlayDescriptors.map((value, index) => parseOverlayDescriptor(value, index));
  const overlays = overlayDescriptors.map((descriptor, index) => {
    const fileValue = formData.get(descriptor.fileField);
    if (!(fileValue instanceof File)) {
      throw new Error(`overlays[${index}] file is required.`);
    }
    return {
      descriptor,
      file: fileValue,
    };
  });

  return {
    engine: "system",
    project,
    resolution: resolutionValue,
    assets,
    overlays,
  };
}

export async function renderEditorSystemExport(
  input: {
    project: EditorProjectRecord;
    assets: readonly EditorSystemExportUpload[];
    overlays: ParsedEditorSystemExportFormData["overlays"];
    resolution: EditorResolution;
    signal?: AbortSignal;
    onProgress?: (progress: NodeEditorExportProgress) => void;
  },
  dependencies: EditorSystemExportDependencies = {}
): Promise<RenderedEditorSystemExportResult> {
  const capability = getEditorExportCapability({
    project: input.project,
    assets: input.assets.map(({ asset }) => ({ asset })),
  });
  if (!capability.supported) {
    throw new Error(capability.reasons.join("\n"));
  }

  const exportProject = dependencies.exportProject ?? exportEditorProjectWithSystemFfmpeg;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clipscribe-editor-export-"));

  try {
    const preparedAssets: NodeEditorExportAsset[] = [];
    const preparedOverlays: NodeEditorExportOverlay[] = [];

    for (const [index, entry] of input.assets.entries()) {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      const filename = sanitizeFilenameSegment(entry.asset.filename, `asset_${index}.bin`);
      const absolutePath = path.join(tempRoot, "assets", `${String(index).padStart(3, "0")}_${filename}`);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
      preparedAssets.push({
        asset: entry.asset,
        absolutePath,
      });
    }

    for (const [index, entry] of input.overlays.entries()) {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      const filename = sanitizeFilenameSegment(entry.descriptor.filename, `overlay_${index}.png`);
      const absolutePath = path.join(tempRoot, "overlays", `${String(index).padStart(3, "0")}_${filename}`);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
      preparedOverlays.push({
        absolutePath,
        ...entry.descriptor,
      });
    }

    const outputPath = path.join(
      tempRoot,
      "output",
      buildEditorExportFilename(input.project.name, input.project.aspectRatio, input.resolution)
    );
    const result = await exportProject({
      project: input.project,
      assets: preparedAssets,
      overlays: preparedOverlays,
      resolution: input.resolution,
      outputPath,
      overwrite: true,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    const bytes = toOwnedBytes(new Uint8Array(await readFile(result.outputPath)));

    return {
      bytes,
      filename: result.filename,
      mimeType: "video/mp4",
      width: result.width,
      height: result.height,
      sizeBytes: result.sizeBytes,
      durationSeconds: result.durationSeconds,
      warnings: result.warnings,
      debugNotes: result.notes,
      debugFfmpegCommand: result.ffmpegCommandPreview,
    };
  } catch (error) {
    if (isNodeEditorExportCanceledError(error)) {
      throw error;
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
