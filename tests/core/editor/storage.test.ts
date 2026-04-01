import assert from "node:assert/strict";
import test from "node:test";

import {
  materializeEditorProjectBundle,
  normalizeEditorProjectBundleManifest,
} from "../../../src/lib/editor/bundle";
import {
  buildEditorExportRecord,
  createDefaultVideoClip,
  createEmptyEditorProject,
  getEditorProjectPersistenceFingerprint,
  normalizeLegacyEditorProjectRecord,
  restoreEditorProjectAfterCanceledExport,
  serializeEditorProjectForPersistence,
} from "../../../src/lib/editor/storage";

test("editor persistence fingerprint ignores transient playhead movement", () => {
  const project = createEmptyEditorProject();
  project.assetIds = ["asset-1"];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: "asset-1", label: "Clip", durationSeconds: 12 }),
  ];
  project.timeline.playheadSeconds = 1.25;

  const persistedPlayheadSeconds = 1.25;
  const baselineFingerprint = getEditorProjectPersistenceFingerprint(
    project,
    project.assetIds,
    persistedPlayheadSeconds
  );
  const movedPlayheadProject = {
    ...project,
    timeline: {
      ...project.timeline,
      playheadSeconds: 8.5,
    },
  };

  assert.equal(
    getEditorProjectPersistenceFingerprint(
      movedPlayheadProject,
      movedPlayheadProject.assetIds,
      persistedPlayheadSeconds
    ),
    baselineFingerprint
  );
  assert.equal(
    serializeEditorProjectForPersistence(movedPlayheadProject, persistedPlayheadSeconds).timeline.playheadSeconds,
    persistedPlayheadSeconds
  );
});

test("editor persistence fingerprint changes for structural edits", () => {
  const project = createEmptyEditorProject();
  project.assetIds = ["asset-1"];
  project.timeline.videoClips = [
    createDefaultVideoClip({ assetId: "asset-1", label: "Clip", durationSeconds: 12 }),
  ];
  project.timeline.playheadSeconds = 1.25;

  const baselineFingerprint = getEditorProjectPersistenceFingerprint(
    project,
    project.assetIds,
    project.timeline.playheadSeconds
  );
  const structurallyEditedProject = {
    ...project,
    aspectRatio: "9:16" as const,
  };

  assert.notEqual(
    getEditorProjectPersistenceFingerprint(
      structurallyEditedProject,
      structurallyEditedProject.assetIds,
      project.timeline.playheadSeconds
    ),
    baselineFingerprint
  );
});

test("restoreEditorProjectAfterCanceledExport keeps current edit and restores prior status metadata", () => {
  const project = createEmptyEditorProject();
  project.status = "exporting";
  project.latestExport = {
    id: "exp_prev",
    createdAt: 100,
    filename: "prev.mp4",
    aspectRatio: "16:9",
    resolution: "1080p",
    engine: "system",
    status: "completed",
  };
  project.lastError = undefined;
  project.name = "Current Edit";

  const restored = restoreEditorProjectAfterCanceledExport(
    project,
    {
      status: "error",
      latestExport: project.latestExport,
      lastError: "Previous failure",
    },
    1234
  );

  assert.equal(restored.name, "Current Edit");
  assert.equal(restored.status, "error");
  assert.equal(restored.lastError, "Previous failure");
  assert.equal(restored.latestExport?.id, "exp_prev");
  assert.equal(restored.updatedAt, 1234);
});

test("editor export records persist system engine metadata and normalize legacy summaries to system", () => {
  const exportRecord = buildEditorExportRecord({
    projectId: "project_1",
    engine: "system",
    filename: "timeline.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    durationSeconds: 12,
    aspectRatio: "16:9",
    resolution: "1080p",
    width: 1920,
    height: 1080,
  });

  assert.equal(exportRecord.engine, "system");

  const normalizedProject = normalizeLegacyEditorProjectRecord({
    ...createEmptyEditorProject(),
    latestExport: {
      id: "legacy_exp",
      createdAt: 10,
      filename: "legacy.mp4",
      aspectRatio: "16:9",
      resolution: "720p",
      status: "completed",
    },
  } as ReturnType<typeof createEmptyEditorProject>);

  assert.equal(normalizedProject.latestExport?.engine, "system");
});

test("imported projects stay stable under persistence serialization helpers", async () => {
  const manifest = normalizeEditorProjectBundleManifest({
    schemaVersion: 1,
    createdAt: 10,
    name: "Imported Timeline",
    aspectRatio: "16:9",
    videoClips: [{ path: "media/intro.mp4", reverse: true }],
  });

  const { project } = await materializeEditorProjectBundle({
    manifest,
    filesByPath: new Map([
      ["media/intro.mp4", new File(["intro"], "intro.mp4", { type: "video/mp4" })],
    ]),
    readMetadata: async () => ({
      kind: "video",
      durationSeconds: 9,
      width: 1920,
      height: 1080,
      hasAudio: true,
    }),
    now: 777,
  });

  const fingerprint = getEditorProjectPersistenceFingerprint(project, project.assetIds, 0);
  const movedPlayheadProject = {
    ...project,
    timeline: {
      ...project.timeline,
      playheadSeconds: 6.4,
    },
  };

  assert.equal(
    getEditorProjectPersistenceFingerprint(movedPlayheadProject, movedPlayheadProject.assetIds, 0),
    fingerprint
  );
  assert.equal(
    serializeEditorProjectForPersistence(movedPlayheadProject, 0).timeline.playheadSeconds,
    0
  );
});
