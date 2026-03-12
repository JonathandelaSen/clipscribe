import { buildEditorExportFilename } from "./export-output";
import { filterEditorAssetsForExport } from "./export-capabilities";
import {
  EDITOR_SYSTEM_EXPORT_FORM_FIELDS,
  parseEditorSystemExportResponseHeaders,
  type EditorSystemExportAssetDescriptor,
  type SystemEditorExportAssetRecord,
} from "./system-export-contract";
import type { EditorProjectRecord, EditorResolution, ResolvedEditorAsset } from "./types";

export interface SystemEditorExportClientResult {
  file: File;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
  warnings: string[];
  debugNotes: string[];
  debugFfmpegCommand: string[];
}

function serializeAssetRecord(asset: ResolvedEditorAsset["asset"]): SystemEditorExportAssetRecord {
  const { fileBlob: _fileBlob, ...rest } = asset;
  void _fileBlob;
  return rest;
}

export async function requestSystemEditorExport(input: {
  project: EditorProjectRecord;
  resolvedAssets: ResolvedEditorAsset[];
  resolution: EditorResolution;
  signal?: AbortSignal;
}): Promise<SystemEditorExportClientResult> {
  const relevantAssets = filterEditorAssetsForExport(input.project, input.resolvedAssets).filter(
    (entry): entry is ResolvedEditorAsset & { file: File } => Boolean(entry.file)
  );
  const assetDescriptors: EditorSystemExportAssetDescriptor[] = [];
  const formData = new FormData();

  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.project, JSON.stringify(input.project));
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.resolution, input.resolution);
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");

  relevantAssets.forEach((entry, index) => {
    const fileField = `asset_${index}`;
    assetDescriptors.push({
      asset: serializeAssetRecord(entry.asset),
      fileField,
    });
    formData.set(fileField, entry.file, entry.file.name);
  });
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.assets, JSON.stringify(assetDescriptors));

  const response = await fetch("/api/editor/exports/render", {
    method: "POST",
    body: formData,
    signal: input.signal,
  });

  if (!response.ok) {
    let message = "System export failed.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      const fallbackText = await response.text().catch(() => "");
      if (fallbackText.trim()) {
        message = fallbackText.trim();
      }
    }

    throw new Error(message);
  }

  const fallbackFilename = buildEditorExportFilename(
    input.project.name,
    input.project.aspectRatio,
    input.resolution
  );
  const metadata = parseEditorSystemExportResponseHeaders(response.headers, {
    filename: fallbackFilename,
    resolution: input.resolution,
  });
  const arrayBuffer = await response.arrayBuffer();
  const file = new File([arrayBuffer], metadata.filename, {
    type: response.headers.get("content-type") || "video/mp4",
  });

  return {
    file,
    width: metadata.width,
    height: metadata.height,
    sizeBytes: metadata.sizeBytes || file.size,
    durationSeconds: metadata.durationSeconds,
    warnings: metadata.warnings,
    debugNotes: metadata.debugNotes,
    debugFfmpegCommand: metadata.debugFfmpegCommand,
  };
}
