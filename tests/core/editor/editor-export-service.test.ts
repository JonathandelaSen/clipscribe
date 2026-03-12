import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  parseEditorSystemExportFormData,
  renderEditorSystemExport,
} from "../../../src/lib/server/editor-export-service";
import {
  EDITOR_SYSTEM_EXPORT_FORM_FIELDS,
  type EditorSystemExportAssetDescriptor,
} from "../../../src/lib/editor/system-export-contract";
import {
  createDefaultVideoClip,
  createEditorAssetRecord,
  createEmptyEditorProject,
} from "../../../src/lib/editor/storage";

function createRenderableUpload() {
  const project = createEmptyEditorProject({
    id: "service_project",
    now: 100,
    name: "Service Export",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    durationSeconds: 8,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_service",
    now: 100,
  });

  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({
      assetId: asset.id,
      label: "Clip",
      durationSeconds: 8,
    }),
  ];

  return {
    project,
    asset,
    file: new File(["clip"], "clip.mp4", { type: "video/mp4" }),
  };
}

test("parseEditorSystemExportFormData reads project metadata and uploaded files", () => {
  const { project, asset, file } = createRenderableUpload();
  const formData = new FormData();
  const descriptors: EditorSystemExportAssetDescriptor[] = [
    {
      asset: (() => {
        const { fileBlob: _fileBlob, ...rest } = asset;
        void _fileBlob;
        return rest;
      })(),
      fileField: "asset_0",
    },
  ];

  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.project, JSON.stringify(project));
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.resolution, "1080p");
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.engine, "system");
  formData.set(EDITOR_SYSTEM_EXPORT_FORM_FIELDS.assets, JSON.stringify(descriptors));
  formData.set("asset_0", file, file.name);

  const parsed = parseEditorSystemExportFormData(formData);

  assert.equal(parsed.engine, "system");
  assert.equal(parsed.resolution, "1080p");
  assert.equal(parsed.project.id, project.id);
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0]?.asset.id, asset.id);
  assert.equal(parsed.assets[0]?.file.name, "clip.mp4");
});

test("renderEditorSystemExport returns bytes and cleans up temp files on success", async () => {
  const { project, asset, file } = createRenderableUpload();
  let tempRoot = "";

  const result = await renderEditorSystemExport(
    {
      project,
      resolution: "1080p",
      assets: [{ asset, file }],
    },
    {
      exportProject: async (input) => {
        tempRoot = path.dirname(path.dirname(input.assets[0]!.absolutePath));
        await mkdir(path.dirname(input.outputPath), { recursive: true });
        await writeFile(input.outputPath, Buffer.alloc(2048, 1));
        return {
          outputPath: input.outputPath,
          filename: path.basename(input.outputPath),
          width: 1920,
          height: 1080,
          sizeBytes: 2048,
          durationSeconds: 8,
          warnings: ["warning"],
          ffmpegCommandPreview: ["ffmpeg", "-i", "clip.mp4"],
          notes: ["rendered"],
          dryRun: false,
        };
      },
    }
  );

  assert.equal(result.filename.endsWith(".mp4"), true);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.sizeBytes, 2048);
  assert.equal(result.bytes.byteLength, 2048);
  await assert.rejects(() => access(tempRoot));
});

test("renderEditorSystemExport cleans up temp files when the export is aborted", async () => {
  const { project, asset, file } = createRenderableUpload();
  const controller = new AbortController();
  let tempRoot = "";

  await assert.rejects(
    () =>
      renderEditorSystemExport(
        {
          project,
          resolution: "1080p",
          assets: [{ asset, file }],
          signal: controller.signal,
        },
        {
          exportProject: async (input) => {
            tempRoot = path.dirname(path.dirname(input.assets[0]!.absolutePath));
            return new Promise((_, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => {
                  const error = new Error("Export canceled.");
                  error.name = "AbortError";
                  reject(error);
                },
                { once: true }
              );
              controller.abort();
            });
          },
        }
      ),
    (error) => error instanceof Error && error.name === "AbortError"
  );

  await assert.rejects(() => access(tempRoot));
});
