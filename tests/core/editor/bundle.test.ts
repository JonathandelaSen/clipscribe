import assert from "node:assert/strict";
import test from "node:test";

import {
  loadEditorProjectBundleFromFiles,
  materializeEditorProjectBundle,
  normalizeEditorProjectBundleManifest,
  type EditorProjectBundleBrowserFile,
} from "../../../src/lib/editor/bundle";
import type { MediaMetadataResult } from "../../../src/lib/editor/media";

function withRelativePath(file: File, webkitRelativePath: string): EditorProjectBundleBrowserFile {
  return Object.assign(file, { webkitRelativePath }) as EditorProjectBundleBrowserFile;
}

function createMetadataReader(map: Record<string, MediaMetadataResult>) {
  return async (file: File) => {
    const metadata = map[file.name];
    if (!metadata) {
      throw new Error(`Unexpected test file ${file.name}`);
    }
    return metadata;
  };
}

test("loadEditorProjectBundleFromFiles strips the selected root folder and parses manifest.json", async () => {
  const manifest = {
    schemaVersion: 1,
    createdAt: 100,
    name: "Launch Reel",
    aspectRatio: "9:16",
    videoClips: [{ path: "media/intro.mp4" }],
  };

  const loaded = await loadEditorProjectBundleFromFiles([
    withRelativePath(
      new File([JSON.stringify(manifest)], "manifest.json", { type: "application/json" }),
      "launch-reel.clipscribe-project/manifest.json"
    ),
    withRelativePath(
      new File(["video"], "intro.mp4", { type: "video/mp4" }),
      "launch-reel.clipscribe-project/media/intro.mp4"
    ),
  ]);

  assert.equal(loaded.rootDirectoryName, "launch-reel.clipscribe-project");
  assert.equal(loaded.manifest.name, "Launch Reel");
  assert.equal(loaded.manifest.videoClips[0]?.path, "media/intro.mp4");
  assert.equal(loaded.filesByPath.has("media/intro.mp4"), true);
});

test("loadEditorProjectBundleFromFiles ignores project.json and still imports the browser bundle", async () => {
  const manifest = {
    schemaVersion: 1,
    createdAt: 100,
    name: "Workspace Bundle",
    aspectRatio: "16:9",
    videoClips: [{ path: "media/intro.mp4" }],
  };

  const loaded = await loadEditorProjectBundleFromFiles([
    withRelativePath(
      new File([JSON.stringify(manifest)], "manifest.json", { type: "application/json" }),
      "workspace-bundle.clipscribe-project/manifest.json"
    ),
    withRelativePath(
      new File([JSON.stringify({ schemaVersion: 1 })], "project.json", { type: "application/json" }),
      "workspace-bundle.clipscribe-project/project.json"
    ),
    withRelativePath(
      new File(["video"], "intro.mp4", { type: "video/mp4" }),
      "workspace-bundle.clipscribe-project/media/intro.mp4"
    ),
  ]);

  assert.equal(loaded.rootDirectoryName, "workspace-bundle.clipscribe-project");
  assert.equal(loaded.manifest.videoClips[0]?.path, "media/intro.mp4");
  assert.equal(loaded.filesByPath.has("project.json"), true);
});

test("materializeEditorProjectBundle creates upload assets and clamps imported trim defaults", async () => {
  const manifest = normalizeEditorProjectBundleManifest({
    schemaVersion: 1,
    createdAt: 200,
    name: "Imported Reel",
    aspectRatio: "9:16",
    videoClips: [
      {
        path: "media/intro.mp4",
        reverse: true,
        trimEndSeconds: 99,
      },
      {
        path: "media/body.mp4",
        label: "Body",
        trimStartSeconds: 1.5,
        volume: 0.55,
        muted: true,
      },
    ],
    audioItem: {
      path: "media/music.mp3",
      trimStartSeconds: 2,
      trimEndSeconds: 30,
      startOffsetSeconds: 3.25,
      volume: 0.7,
    },
  });

  const introFile = new File(["intro"], "intro.mp4", { type: "video/mp4" });
  const bodyFile = new File(["body"], "body.mp4", { type: "video/mp4" });
  const musicFile = new File(["music"], "music.mp3", { type: "audio/mpeg" });
  const { project, assets } = await materializeEditorProjectBundle({
    manifest,
    filesByPath: new Map([
      ["media/intro.mp4", introFile],
      ["media/body.mp4", bodyFile],
      ["media/music.mp3", musicFile],
    ]),
    readMetadata: createMetadataReader({
      "intro.mp4": { kind: "video", durationSeconds: 8, width: 1920, height: 1080, hasAudio: true },
      "body.mp4": { kind: "video", durationSeconds: 6, width: 1920, height: 1080, hasAudio: true },
      "music.mp3": { kind: "audio", durationSeconds: 12, hasAudio: true },
    }),
    now: 999,
  });

  assert.equal(project.name, "Imported Reel");
  assert.equal(project.aspectRatio, "9:16");
  assert.equal(project.assetIds.length, 3);
  assert.deepEqual(project.timeline.videoClipGroups, []);
  assert.equal(project.timeline.playheadSeconds, 0);
  assert.deepEqual(project.timeline.selectedItem, { kind: "video", id: project.timeline.videoClips[0]?.id });
  assert.equal(project.timeline.videoClips[0]?.label, "intro");
  assert.equal(project.timeline.videoClips[0]?.trimStartSeconds, 0);
  assert.equal(project.timeline.videoClips[0]?.trimEndSeconds, 8);
  assert.equal(project.timeline.videoClips[0]?.actions.reverse, true);
  assert.equal(project.timeline.videoClips[1]?.label, "Body");
  assert.equal(project.timeline.videoClips[1]?.trimStartSeconds, 1.5);
  assert.equal(project.timeline.videoClips[1]?.trimEndSeconds, 6);
  assert.equal(project.timeline.videoClips[1]?.volume, 0.55);
  assert.equal(project.timeline.videoClips[1]?.muted, true);
  assert.equal(project.timeline.audioItems[0]?.trimStartSeconds, 2);
  assert.equal(project.timeline.audioItems[0]?.trimEndSeconds, 12);
  assert.equal(project.timeline.audioItems[0]?.startOffsetSeconds, 3.25);
  assert.equal(project.timeline.audioItems[0]?.volume, 0.7);
  assert.deepEqual(
    assets.map((asset) => ({
      kind: asset.kind,
      sourceType: asset.sourceType,
      captionSource: asset.captionSource.kind,
      hasFileBlob: asset.fileBlob instanceof File,
    })),
    [
      { kind: "video", sourceType: "upload", captionSource: "none", hasFileBlob: true },
      { kind: "video", sourceType: "upload", captionSource: "none", hasFileBlob: true },
      { kind: "audio", sourceType: "upload", captionSource: "none", hasFileBlob: true },
    ]
  );
});

test("materializeEditorProjectBundle deduplicates repeated bundle media paths into one asset", async () => {
  const manifest = normalizeEditorProjectBundleManifest({
    schemaVersion: 1,
    createdAt: 400,
    name: "Repeated Clip",
    aspectRatio: "16:9",
    videoClips: [
      { path: "media/shared.mp4", reverse: true },
      { path: "media/shared.mp4", trimStartSeconds: 1, trimEndSeconds: 3.5, volume: 0.4 },
    ],
  });

  const sharedFile = new File(["shared"], "shared.mp4", { type: "video/mp4" });
  const { project, assets, assetPathsById } = await materializeEditorProjectBundle({
    manifest,
    filesByPath: new Map([["media/shared.mp4", sharedFile]]),
    readMetadata: createMetadataReader({
      "shared.mp4": { kind: "video", durationSeconds: 8, width: 1920, height: 1080, hasAudio: true },
    }),
    now: 1234,
  });

  assert.equal(assets.length, 1);
  assert.equal(project.assetIds.length, 1);
  assert.equal(project.timeline.videoClips.length, 2);
  assert.equal(project.timeline.videoClips[0]?.assetId, assets[0]?.id);
  assert.equal(project.timeline.videoClips[1]?.assetId, assets[0]?.id);
  assert.equal(project.timeline.videoClips[0]?.actions.reverse, true);
  assert.equal(project.timeline.videoClips[1]?.trimStartSeconds, 1);
  assert.equal(project.timeline.videoClips[1]?.trimEndSeconds, 3.5);
  assert.equal(project.timeline.videoClips[1]?.volume, 0.4);
  assert.equal(assetPathsById.get(assets[0]!.id), "media/shared.mp4");
});

test("materializeEditorProjectBundle fails clearly when a bundled media file is missing", async () => {
  const manifest = normalizeEditorProjectBundleManifest({
    schemaVersion: 1,
    createdAt: 300,
    name: "Broken Bundle",
    aspectRatio: "16:9",
    videoClips: [{ path: "media/missing.mp4" }],
  });

  await assert.rejects(
    () =>
      materializeEditorProjectBundle({
        manifest,
        filesByPath: new Map(),
        readMetadata: createMetadataReader({}),
      }),
    /Bundle media file "media\/missing\.mp4" is missing/
  );
});
