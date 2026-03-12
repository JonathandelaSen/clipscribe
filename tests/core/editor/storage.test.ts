import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultVideoClip,
  createEmptyEditorProject,
  getEditorProjectPersistenceFingerprint,
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
