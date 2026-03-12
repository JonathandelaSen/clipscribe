import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultVideoClip, createEditorAssetRecord, createEmptyEditorProject } from "../../../src/lib/editor/storage";
import {
  createEditorProjectWorkspace,
  parseEditorProjectWorkspace,
} from "../../../src/lib/editor/workspace";

test("createEditorProjectWorkspace strips file blobs and keeps normalized asset paths", () => {
  const project = createEmptyEditorProject({
    id: "project_1",
    now: 100,
    name: "Workspace Project",
    aspectRatio: "16:9",
  });
  const asset = createEditorAssetRecord({
    projectId: project.id,
    kind: "video",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 128,
    durationSeconds: 6,
    width: 1920,
    height: 1080,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    fileBlob: new File(["clip"], "clip.mp4", { type: "video/mp4" }),
    id: "asset_1",
    now: 100,
  });
  project.assetIds = [asset.id];
  project.timeline.videoClips = [
    createDefaultVideoClip({
      assetId: asset.id,
      label: "Clip",
      durationSeconds: asset.durationSeconds,
    }),
  ];

  const workspace = createEditorProjectWorkspace({
    project,
    assets: [asset],
    assetPathsById: new Map([[asset.id, "media/clip.mp4"]]),
    createdAt: 200,
  });

  assert.equal(workspace.schemaVersion, 1);
  assert.equal(workspace.createdAt, 200);
  assert.equal(workspace.project.assetIds[0], asset.id);
  assert.equal(workspace.assets[0]?.path, "media/clip.mp4");
  assert.equal("fileBlob" in (workspace.assets[0] ?? {}), false);
});

test("parseEditorProjectWorkspace normalizes project selection and asset ids", () => {
  const project = createEmptyEditorProject({
    id: "project_2",
    now: 300,
    name: "Selection Fix",
    aspectRatio: "9:16",
  });
  const clip = createDefaultVideoClip({
    assetId: "asset_2",
    label: "Clip",
    durationSeconds: 5,
  });
  project.timeline.videoClips = [clip];
  project.timeline.selectedItem = { kind: "video", id: "missing_clip" };
  project.assetIds = ["stale_asset"];

  const workspace = parseEditorProjectWorkspace(
    JSON.stringify({
      schemaVersion: 1,
      createdAt: 301,
      project,
      assets: [
        {
          id: "asset_2",
          projectId: project.id,
          sourceType: "upload",
          kind: "video",
          filename: "clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 256,
          durationSeconds: 5,
          width: 1920,
          height: 1080,
          hasAudio: true,
          createdAt: 300,
          updatedAt: 300,
          captionSource: { kind: "none" },
          path: "media/clip.mp4",
        },
      ],
    })
  );

  assert.deepEqual(workspace.project.assetIds, ["asset_2"]);
  assert.deepEqual(workspace.project.timeline.selectedItem, { kind: "video", id: clip.id });
});

test("parseEditorProjectWorkspace rejects asset paths that escape the workspace root", () => {
  const project = createEmptyEditorProject({
    id: "project_3",
    now: 400,
  });

  assert.throws(
    () =>
      parseEditorProjectWorkspace(
        JSON.stringify({
          schemaVersion: 1,
          createdAt: 401,
          project,
          assets: [
            {
              id: "asset_3",
              projectId: project.id,
              sourceType: "upload",
              kind: "video",
              filename: "clip.mp4",
              mimeType: "video/mp4",
              sizeBytes: 64,
              durationSeconds: 4,
              createdAt: 400,
              updatedAt: 400,
              captionSource: { kind: "none" },
              path: "../outside.mp4",
            },
          ],
        })
      ),
    /must stay inside the project workspace/
  );
});
