import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultTimelineOverlayItem,
  createDefaultVideoClip,
  createEditorAssetRecord,
  createEmptyEditorProject,
} from "../../../src/lib/editor/storage";
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

test("parseEditorProjectWorkspace keeps reactive overlay items and overlay selection", () => {
  const project = createEmptyEditorProject({
    id: "project_overlay",
    now: 320,
    name: "Overlay Workspace",
    aspectRatio: "9:16",
  });
  const overlayItem = createDefaultTimelineOverlayItem({
    presetId: "equalizer_bars",
    startOffsetSeconds: 1,
    durationSeconds: 2.5,
  });
  project.timeline.overlayItems = [overlayItem];
  project.timeline.selectedItem = { kind: "overlay", id: overlayItem.id };

  const workspace = parseEditorProjectWorkspace(
    JSON.stringify({
      schemaVersion: 1,
      createdAt: 321,
      project,
      assets: [],
    })
  );

  assert.equal(workspace.project.timeline.overlayItems.length, 1);
  assert.deepEqual(workspace.project.timeline.selectedItem, { kind: "overlay", id: overlayItem.id });
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

test("parseEditorProjectWorkspace keeps YouTube import metadata on assets", () => {
  const project = createEmptyEditorProject({
    id: "project_youtube",
    now: 500,
  });

  const workspace = parseEditorProjectWorkspace(
    JSON.stringify({
      schemaVersion: 1,
      createdAt: 501,
      project,
      assets: [
        {
          id: "asset_youtube",
          projectId: project.id,
          role: "source",
          origin: "youtube-import",
          sourceType: "youtube",
          kind: "video",
          filename: "clip.mp4",
          mimeType: "video/mp4",
          sizeBytes: 512,
          durationSeconds: 14,
          createdAt: 500,
          updatedAt: 500,
          captionSource: { kind: "none" },
          externalSource: {
            kind: "youtube",
            url: "https://www.youtube.com/watch?v=abc123",
            videoId: "abc123",
            title: "Imported Clip",
            channelTitle: "ClipScribe",
          },
          path: "media/clip.mp4",
        },
      ],
    })
  );

  assert.equal(workspace.assets[0]?.sourceType, "youtube");
  assert.equal(workspace.assets[0]?.origin, "youtube-import");
  assert.deepEqual(workspace.assets[0]?.externalSource, {
    kind: "youtube",
    url: "https://www.youtube.com/watch?v=abc123",
    videoId: "abc123",
    title: "Imported Clip",
    channelTitle: "ClipScribe",
  });
});
