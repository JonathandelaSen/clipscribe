import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CREATOR_SYSTEM_EXPORT_FORM_FIELDS,
  type CreatorShortSystemExportOverlayDescriptor,
  type CreatorShortSystemExportPayload,
} from "../../../creator/system-export-contract";
import {
  exportCreatorShortWithSystemFfmpeg,
  isCreatorSystemRenderCanceledError,
  type CreatorSystemRenderOverlayInput,
  type CreatorSystemRenderResult,
} from "./system-render";

type LooseRecord = Record<string, unknown>;

export interface ParsedCreatorShortSystemExportFormData {
  engine: "system";
  payload: CreatorShortSystemExportPayload;
  sourceFile: File;
  overlays: Array<{
    descriptor: CreatorShortSystemExportOverlayDescriptor;
    file: File;
  }>;
}

export interface RenderedCreatorShortSystemExportResult {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  subtitleBurnedIn: boolean;
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

export interface CreatorShortSystemExportDependencies {
  exportShort?: (input: Parameters<typeof exportCreatorShortWithSystemFfmpeg>[0]) => Promise<CreatorSystemRenderResult>;
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

function parseOverlayDescriptor(value: unknown, index: number): CreatorShortSystemExportOverlayDescriptor {
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

  return {
    start,
    end,
    fileField: value.fileField,
    filename: value.filename,
  };
}

function parsePayload(value: unknown): CreatorShortSystemExportPayload {
  if (!isRecord(value)) {
    throw new Error("payload is invalid.");
  }
  if (typeof value.sourceFilename !== "string" || !value.sourceFilename.trim()) {
    throw new Error("payload.sourceFilename is required.");
  }
  if (!isRecord(value.short)) {
    throw new Error("payload.short is required.");
  }
  if (!isRecord(value.editor)) {
    throw new Error("payload.editor is required.");
  }
  if (!isRecord(value.sourceVideoSize)) {
    throw new Error("payload.sourceVideoSize is required.");
  }
  const sourceWidth = Number(value.sourceVideoSize.width);
  const sourceHeight = Number(value.sourceVideoSize.height);
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error("payload.sourceVideoSize must include positive width and height.");
  }
  if (!isRecord(value.geometry) || typeof value.geometry.filter !== "string") {
    throw new Error("payload.geometry is required.");
  }
  if (!isRecord(value.overlaySummary)) {
    throw new Error("payload.overlaySummary is required.");
  }

  return value as unknown as CreatorShortSystemExportPayload;
}

export function parseCreatorShortSystemExportFormData(formData: FormData): ParsedCreatorShortSystemExportFormData {
  const engine = formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.engine);
  if (engine !== "system") {
    throw new Error("engine must be system.");
  }

  const payload = parsePayload(
    parseJson<unknown>(formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.payload), "payload")
  );
  const sourceFileValue = formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.sourceFile);
  if (!(sourceFileValue instanceof File)) {
    throw new Error("source_file is required.");
  }

  const rawDescriptors = parseJson<unknown[]>(
    formData.get(CREATOR_SYSTEM_EXPORT_FORM_FIELDS.overlays),
    "overlays"
  );
  const descriptors = rawDescriptors.map((value, index) => parseOverlayDescriptor(value, index));
  const overlays = descriptors.map((descriptor, index) => {
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
    payload,
    sourceFile: sourceFileValue,
    overlays,
  };
}

export async function renderCreatorShortSystemExport(
  input: {
    payload: CreatorShortSystemExportPayload;
    sourceFile: File;
    overlays: Array<{
      descriptor: CreatorShortSystemExportOverlayDescriptor;
      file: File;
    }>;
    signal?: AbortSignal;
  },
  dependencies: CreatorShortSystemExportDependencies = {}
): Promise<RenderedCreatorShortSystemExportResult> {
  const exportShort = dependencies.exportShort ?? exportCreatorShortWithSystemFfmpeg;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clipscribe-short-export-"));

  try {
    const sourceFilename = sanitizeFilenameSegment(input.sourceFile.name, "source.mp4");
    const sourcePath = path.join(tempRoot, "source", sourceFilename);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, new Uint8Array(await input.sourceFile.arrayBuffer()));

    const preparedOverlays: CreatorSystemRenderOverlayInput[] = [];
    for (const [index, entry] of input.overlays.entries()) {
      const overlayFilename = sanitizeFilenameSegment(entry.descriptor.filename, `overlay_${index}.png`);
      const overlayPath = path.join(
        tempRoot,
        "overlays",
        `${String(index).padStart(3, "0")}_${overlayFilename}`
      );
      await mkdir(path.dirname(overlayPath), { recursive: true });
      await writeFile(overlayPath, new Uint8Array(await entry.file.arrayBuffer()));
      preparedOverlays.push({
        absolutePath: overlayPath,
        filename: overlayFilename,
        start: entry.descriptor.start,
        end: entry.descriptor.end,
      });
    }

    const outputPath = path.join(tempRoot, "output", "short_export.mp4");
    const result = await exportShort({
      sourceFilePath: sourcePath,
      sourceFilename: input.payload.sourceFilename,
      short: input.payload.short,
      editor: input.payload.editor,
      sourceVideoSize: input.payload.sourceVideoSize,
      geometry: input.payload.geometry,
      previewViewport: input.payload.previewViewport ?? null,
      previewVideoRect: input.payload.previewVideoRect ?? null,
      overlays: preparedOverlays,
      subtitleBurnedIn: input.payload.subtitleBurnedIn,
      overlaySummary: input.payload.overlaySummary,
      outputPath,
      overwrite: true,
      signal: input.signal,
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
      subtitleBurnedIn: result.subtitleBurnedIn,
      debugNotes: result.notes,
      debugFfmpegCommand: result.ffmpegCommandPreview,
    };
  } catch (error) {
    if (isCreatorSystemRenderCanceledError(error)) {
      throw error;
    }
    throw error;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
