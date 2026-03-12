import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  exportTimelineProjectWorkspace,
  importTimelineProjectWorkspace,
  normalizeExportTimelineProjectOptions,
  normalizeImportTimelineProjectOptions,
  parseExportTimelineProjectArgs,
  parseImportTimelineProjectArgs,
} from "../../../src/lib/editor/workspace-cli";
import { createDefaultVideoClip, createEditorAssetRecord, createEmptyEditorProject } from "../../../src/lib/editor/storage";
import { createEditorProjectWorkspace, parseEditorProjectWorkspace, serializeEditorProjectWorkspace } from "../../../src/lib/editor/workspace";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-workspace-test-"));
}

test("workspace CLI parsers normalize required paths and default export resolution", () => {
  const importOptions = normalizeImportTimelineProjectOptions(
    parseImportTimelineProjectArgs(["--bundle", "./demo.clipscribe-project", "--force"]),
    "/repo"
  );
  const exportOptions = normalizeExportTimelineProjectOptions(
    parseExportTimelineProjectArgs(["--project", "./demo.clipscribe-project", "--dry-run"]),
    "/repo"
  );

  assert.equal(importOptions.bundlePath, "/repo/demo.clipscribe-project");
  assert.equal(importOptions.force, true);
  assert.equal(exportOptions.projectPath, "/repo/demo.clipscribe-project");
  assert.equal(exportOptions.resolution, "1080p");
  assert.equal(exportOptions.dryRun, true);
});

test("importTimelineProjectWorkspace fails when manifest.json is missing", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const bundleDir = path.join(tempDir, "missing-manifest.clipscribe-project");
  await mkdir(bundleDir, { recursive: true });

  await assert.rejects(
    () =>
      importTimelineProjectWorkspace({
        bundlePath: bundleDir,
        force: false,
        json: false,
      }),
    /Bundle manifest is not readable/
  );
});

test("importTimelineProjectWorkspace writes project.json and deduplicates repeated media paths", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const bundleDir = path.join(tempDir, "dedupe.clipscribe-project");
  await mkdir(path.join(bundleDir, "media"), { recursive: true });
  await writeFile(
    path.join(bundleDir, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: 10,
        name: "Dedupe",
        aspectRatio: "16:9",
        videoClips: [
          { path: "media/shared.mp4", reverse: true },
          { path: "media/shared.mp4", trimStartSeconds: 1, trimEndSeconds: 3.5 },
        ],
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(bundleDir, "media", "shared.mp4"), "video", "utf8");

  const result = await importTimelineProjectWorkspace(
    {
      bundlePath: bundleDir,
      force: false,
      json: false,
    },
    {
      now: () => 999,
      probeMedia: async () => ({
        kind: "video",
        filename: "shared.mp4",
        mimeType: "video/mp4",
        sizeBytes: 128,
        durationSeconds: 8,
        width: 1920,
        height: 1080,
        hasAudio: true,
      }),
    }
  );

  const workspace = parseEditorProjectWorkspace(await readFile(result.workspacePath, "utf8"));
  assert.equal(workspace.assets.length, 1);
  assert.equal(workspace.project.assetIds.length, 1);
  assert.equal(workspace.project.timeline.videoClips.length, 2);
  assert.equal(workspace.project.timeline.videoClips[0]?.assetId, workspace.assets[0]?.id);
  assert.equal(workspace.project.timeline.videoClips[1]?.assetId, workspace.assets[0]?.id);
  assert.equal(workspace.assets[0]?.path, "media/shared.mp4");
});

test("importTimelineProjectWorkspace fails when a manifest references missing media", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const bundleDir = path.join(tempDir, "missing-media.clipscribe-project");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    path.join(bundleDir, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: 10,
        name: "Missing Media",
        aspectRatio: "16:9",
        videoClips: [{ path: "media/missing.mp4" }],
      },
      null,
      2
    ),
    "utf8"
  );

  await assert.rejects(
    () =>
      importTimelineProjectWorkspace({
        bundlePath: bundleDir,
        force: false,
        json: false,
      }),
    /The selected bundle is missing media\/missing\.mp4/
  );
});

test("importTimelineProjectWorkspace surfaces ffprobe-style media errors", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const bundleDir = path.join(tempDir, "probe-error.clipscribe-project");
  await mkdir(path.join(bundleDir, "media"), { recursive: true });
  await writeFile(
    path.join(bundleDir, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        createdAt: 10,
        name: "Probe Error",
        aspectRatio: "16:9",
        videoClips: [{ path: "media/shared.mp4" }],
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(bundleDir, "media", "shared.mp4"), "video", "utf8");

  await assert.rejects(
    () =>
      importTimelineProjectWorkspace(
        {
          bundlePath: bundleDir,
          force: false,
          json: false,
        },
        {
          probeMedia: async () => {
            throw new Error("ffprobe failed for shared.mp4");
          },
        }
      ),
    /ffprobe failed/
  );
});

test("exportTimelineProjectWorkspace uses the default exports directory during dry runs", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const workspaceDir = path.join(tempDir, "dry-run.clipscribe-project");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, "media"), { recursive: true });
  await writeFile(path.join(workspaceDir, "media", "clip.mp4"), "clip", "utf8");

  const project = createEmptyEditorProject({
    id: "project_dry_run",
    now: 100,
    name: "Dry Run",
    aspectRatio: "9:16",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 64,
    durationSeconds: 5,
    width: 1080,
    height: 1920,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_dry_run",
    now: 100,
  });
  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: asset.id, label: "Clip", durationSeconds: 5 }),
  ];
  await writeFile(
    path.join(workspaceDir, "project.json"),
    serializeEditorProjectWorkspace(
      createEditorProjectWorkspace({
        project,
        assets: [asset],
        assetPathsById: new Map([[asset.id, "media/clip.mp4"]]),
        createdAt: 100,
      })
    ),
    "utf8"
  );

  const result = await exportTimelineProjectWorkspace(
    {
      projectPath: workspaceDir,
      resolution: "720p",
      dryRun: true,
      force: false,
      json: false,
    },
    {
      exportProject: async (input) => ({
        outputPath: input.outputPath,
        filename: path.basename(input.outputPath),
        width: 720,
        height: 1280,
        sizeBytes: 0,
        durationSeconds: 5,
        warnings: [],
        ffmpegCommandPreview: ["ffmpeg", "-i", "clip.mp4"],
        notes: [],
        dryRun: true,
      }),
    }
  );

  assert.equal(
    result.outputPath,
    path.join(workspaceDir, "exports", "Dry_Run__9x16__720p.mp4")
  );
  const workspaceAfterDryRun = parseEditorProjectWorkspace(await readFile(path.join(workspaceDir, "project.json"), "utf8"));
  assert.equal(workspaceAfterDryRun.project.status, "draft");
});

test("exportTimelineProjectWorkspace persists latestExport on success", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const workspaceDir = path.join(tempDir, "success.clipscribe-project");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, "media"), { recursive: true });
  await writeFile(path.join(workspaceDir, "media", "clip.mp4"), "clip", "utf8");

  const project = createEmptyEditorProject({
    id: "project_success",
    now: 200,
    name: "CLI Success",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 64,
    durationSeconds: 6,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_success",
    now: 200,
  });
  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: asset.id, label: "Clip", durationSeconds: 6 }),
  ];
  await writeFile(
    path.join(workspaceDir, "project.json"),
    serializeEditorProjectWorkspace(
      createEditorProjectWorkspace({
        project,
        assets: [asset],
        assetPathsById: new Map([[asset.id, "media/clip.mp4"]]),
        createdAt: 200,
      })
    ),
    "utf8"
  );

  const result = await exportTimelineProjectWorkspace(
    {
      projectPath: workspaceDir,
      resolution: "1080p",
      dryRun: false,
      force: true,
      json: false,
    },
    {
      now: () => 1234,
      exportProject: async (input) => ({
        outputPath: input.outputPath,
        filename: path.basename(input.outputPath),
        width: 1920,
        height: 1080,
        sizeBytes: 4096,
        durationSeconds: 6,
        warnings: ["warn"],
        ffmpegCommandPreview: ["ffmpeg", "-i", "clip.mp4"],
        notes: ["done"],
        dryRun: false,
      }),
    }
  );

  const workspaceAfterExport = parseEditorProjectWorkspace(await readFile(path.join(workspaceDir, "project.json"), "utf8"));
  assert.equal(result.sizeBytes, 4096);
  assert.equal(workspaceAfterExport.project.status, "draft");
  assert.equal(workspaceAfterExport.project.lastError, undefined);
  assert.equal(workspaceAfterExport.project.latestExport?.filename, path.basename(result.outputPath));
  assert.equal(workspaceAfterExport.project.latestExport?.resolution, "1080p");
});

test("exportTimelineProjectWorkspace persists failure state when export errors", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const workspaceDir = path.join(tempDir, "failure.clipscribe-project");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, "media"), { recursive: true });
  await writeFile(path.join(workspaceDir, "media", "clip.mp4"), "clip", "utf8");

  const project = createEmptyEditorProject({
    id: "project_failure",
    now: 300,
    name: "CLI Failure",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 64,
    durationSeconds: 4,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_failure",
    now: 300,
  });
  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: asset.id, label: "Clip", durationSeconds: 4 }),
  ];
  await writeFile(
    path.join(workspaceDir, "project.json"),
    serializeEditorProjectWorkspace(
      createEditorProjectWorkspace({
        project,
        assets: [asset],
        assetPathsById: new Map([[asset.id, "media/clip.mp4"]]),
        createdAt: 300,
      })
    ),
    "utf8"
  );

  await assert.rejects(
    () =>
      exportTimelineProjectWorkspace(
        {
          projectPath: workspaceDir,
          resolution: "1080p",
          dryRun: false,
          force: false,
          json: false,
        },
        {
          now: () => 5678,
          exportProject: async () => {
            throw new Error("render exploded");
          },
        }
      ),
    /render exploded/
  );

  const workspaceAfterFailure = parseEditorProjectWorkspace(await readFile(path.join(workspaceDir, "project.json"), "utf8"));
  assert.equal(workspaceAfterFailure.project.status, "error");
  assert.match(workspaceAfterFailure.project.lastError ?? "", /render exploded/);
});

test("exportTimelineProjectWorkspace fails when project.json is missing", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await assert.rejects(
    () =>
      exportTimelineProjectWorkspace({
        projectPath: path.join(tempDir, "missing.clipscribe-project"),
        resolution: "1080p",
        dryRun: true,
        force: false,
        json: false,
      }),
    /Project workspace is not readable/
  );
});

test("exportTimelineProjectWorkspace fails when an asset file is missing", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const workspaceDir = path.join(tempDir, "missing-asset.clipscribe-project");
  await mkdir(workspaceDir, { recursive: true });

  const project = createEmptyEditorProject({
    id: "project_missing_asset",
    now: 400,
    name: "Missing Asset",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 64,
    durationSeconds: 4,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    id: "asset_missing_asset",
    now: 400,
  });
  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: asset.id, label: "Clip", durationSeconds: 4 }),
  ];
  await writeFile(
    path.join(workspaceDir, "project.json"),
    serializeEditorProjectWorkspace(
      createEditorProjectWorkspace({
        project,
        assets: [asset],
        assetPathsById: new Map([[asset.id, "media/missing.mp4"]]),
        createdAt: 400,
      })
    ),
    "utf8"
  );

  await assert.rejects(
    () =>
      exportTimelineProjectWorkspace({
        projectPath: workspaceDir,
        resolution: "1080p",
        dryRun: true,
        force: false,
        json: false,
      }),
    /Workspace asset "clip\.mp4" is not readable/
  );
});
