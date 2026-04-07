import test from "node:test";
import assert from "node:assert/strict";

import { createDexieProjectRepository } from "../../src/lib/repositories/project-repo";
import type {
  ContentProjectRecord,
  ProjectAssetRecord,
  ProjectExportRecord,
  ProjectVoiceoverRecord,
  ProjectYouTubeUploadRecord,
} from "../../src/lib/projects/types";

class InMemoryTable<T extends object> {
  private readonly records = new Map<string, T>();

  constructor(private readonly primaryKey: keyof T) {}

  async toArray(): Promise<T[]> {
    return [...this.records.values()];
  }

  async put(record: T): Promise<void> {
    this.records.set(String((record as Record<string, unknown>)[this.primaryKey as string]), record);
  }

  async bulkPut(records: T[]): Promise<void> {
    for (const record of records) {
      await this.put(record);
    }
  }

  async get(key: string): Promise<T | undefined> {
    return this.records.get(key);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async bulkDelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.records.delete(key);
    }
  }

  where(field: keyof T) {
    return {
      equals: (value: unknown) => ({
        toArray: async () =>
          [...this.records.values()].filter(
            (record) => (record as Record<string, unknown>)[field as string] === value
          ),
      }),
    };
  }

  filter(predicate: (record: T) => boolean) {
    return {
      toArray: async () => [...this.records.values()].filter(predicate),
    };
  }
}

class InMemoryProjectDb {
  projects = new InMemoryTable<ContentProjectRecord>("id");
  projectAssets = new InMemoryTable<ProjectAssetRecord>("id");
  assetTranscripts = new InMemoryTable<{ assetId: string; projectId: string }>("assetId");
  projectShorts = new InMemoryTable<{ id: string; projectId: string }>("id");
  projectExports = new InMemoryTable<ProjectExportRecord>("id");
  projectVoiceovers = new InMemoryTable<ProjectVoiceoverRecord>("id");
  projectYouTubeUploads = new InMemoryTable<ProjectYouTubeUploadRecord>("id");

  async transaction(_mode: string, ...args: unknown[]) {
    const callback = args.at(-1) as (() => Promise<void>) | undefined;
    if (!callback) {
      throw new Error("transaction callback missing");
    }
    await callback();
  }
}

function createProject(overrides: Partial<ContentProjectRecord> = {}): ContentProjectRecord {
  return {
    id: overrides.id ?? "project_1",
    name: overrides.name ?? "Project",
    createdAt: overrides.createdAt ?? 100,
    updatedAt: overrides.updatedAt ?? 100,
    lastOpenedAt: overrides.lastOpenedAt ?? 100,
    status: overrides.status ?? "draft",
    aspectRatio: overrides.aspectRatio ?? "16:9",
    assetIds: overrides.assetIds ?? [],
    timeline: overrides.timeline ?? {
      playheadSeconds: 0,
      zoomLevel: 1,
      selectedItem: undefined,
      imageItems: [],
      overlayItems: [],
      videoClips: [],
      videoClipGroups: [],
      audioItems: [],
    },
    subtitles: overrides.subtitles ?? {
      source: {
        kind: "none",
      },
      label: undefined,
      language: undefined,
      chunks: [],
      subtitleTimingMode: "segment",
      offsetSeconds: 0,
      trimStartSeconds: 0,
      trimEndSeconds: 0,
      enabled: true,
      preset: "clean_caption",
      positionXPercent: 50,
      positionYPercent: 78,
      scale: 1,
      style: {},
    },
    activeSourceAssetId: overrides.activeSourceAssetId,
  };
}

function createUpload(overrides: Partial<ProjectYouTubeUploadRecord> = {}): ProjectYouTubeUploadRecord {
  return {
    id: overrides.id ?? "upload_1",
    projectId: overrides.projectId ?? "project_1",
    uploadedAt: overrides.uploadedAt ?? 1_000,
    videoId: overrides.videoId ?? "video_1",
    watchUrl: overrides.watchUrl ?? "https://youtube.com/watch?v=video_1",
    studioUrl: overrides.studioUrl ?? "https://studio.youtube.com/video/video_1/edit",
    sourceMode: overrides.sourceMode ?? "project_export",
    sourceAssetId: overrides.sourceAssetId,
    sourceExportId: overrides.sourceExportId,
    outputAssetId: overrides.outputAssetId,
    sourceFilename: overrides.sourceFilename ?? "render.mp4",
    draft: overrides.draft ?? {
      publishIntent: "standard",
      title: "Upload",
      description: "Description",
      privacyStatus: "private",
      tags: [],
      localizations: [],
    },
    result: overrides.result ?? {
      processingStatus: "succeeded",
      thumbnailState: "applied",
      captionState: "skipped",
    },
  };
}

test("project repository lists YouTube uploads newest first", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await repository.putProjectYouTubeUpload(createUpload({ id: "upload_old", uploadedAt: 100 }));
  await repository.putProjectYouTubeUpload(createUpload({ id: "upload_new", uploadedAt: 200 }));

  const uploads = await repository.listProjectYouTubeUploads("project_1");
  assert.deepEqual(uploads.map((upload) => upload.id), ["upload_new", "upload_old"]);
});

test("deleteProject removes the associated YouTube upload history", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await database.projects.put(createProject());
  await database.projectAssets.put({
    id: "asset_1",
    projectId: "project_1",
    role: "source",
    origin: "upload",
    sourceType: "upload",
    kind: "video",
    filename: "source.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
    durationSeconds: 10,
    captionSource: { kind: "none" },
    createdAt: 100,
    updatedAt: 100,
  });
  await database.projectExports.put({
    id: "export_1",
    projectId: "project_1",
    kind: "timeline",
    createdAt: 100,
    status: "completed",
    filename: "export.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    outputAssetId: "asset_1",
  });
  await repository.putProjectYouTubeUpload(createUpload({ id: "upload_1" }));
  await repository.putProjectYouTubeUpload(createUpload({ id: "upload_2", projectId: "project_2" }));

  await repository.deleteProject("project_1");

  assert.equal(await database.projects.get("project_1"), undefined);
  assert.deepEqual(
    (await repository.listProjectYouTubeUploads()).map((upload) => upload.id),
    ["upload_2"]
  );
});

test("deleteAsset removes linked export outputs and keeps upload history by clearing stale references", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await database.projectAssets.put({
    id: "asset_drop",
    projectId: "project_1",
    role: "derived",
    origin: "timeline-export",
    sourceType: "upload",
    kind: "video",
    filename: "export.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    durationSeconds: 10,
    captionSource: { kind: "none" },
    createdAt: 100,
    updatedAt: 100,
  });
  await database.projectAssets.put({
    id: "asset_keep",
    projectId: "project_1",
    role: "source",
    origin: "upload",
    sourceType: "upload",
    kind: "video",
    filename: "source.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
    durationSeconds: 10,
    captionSource: { kind: "none" },
    createdAt: 100,
    updatedAt: 100,
  });
  await database.projectExports.put({
    id: "export_drop",
    projectId: "project_1",
    kind: "timeline",
    createdAt: 100,
    status: "completed",
    filename: "export.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    outputAssetId: "asset_drop",
  });
  await database.projectExports.put({
    id: "export_keep",
    projectId: "project_1",
    kind: "timeline",
    createdAt: 200,
    status: "completed",
    filename: "other-export.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    outputAssetId: "asset_keep",
  });
  await repository.putProjectYouTubeUpload(
    createUpload({
      id: "upload_history",
      sourceMode: "project_export",
      sourceAssetId: "asset_drop",
      sourceExportId: "export_drop",
      outputAssetId: "asset_drop",
    })
  );
  await repository.putProjectYouTubeUpload(
    createUpload({
      id: "upload_keep",
      uploadedAt: 2_000,
      sourceMode: "project_export",
      sourceAssetId: "asset_keep",
      sourceExportId: "export_keep",
      outputAssetId: "asset_keep",
    })
  );

  await repository.deleteAsset("asset_drop");

  assert.equal(await database.projectAssets.get("asset_drop"), undefined);
  assert.equal(await database.projectExports.get("export_drop"), undefined);
  assert.deepEqual(
    (await repository.listProjectExports("project_1")).map((record) => record.id),
    ["export_keep"]
  );

  const uploads = await repository.listProjectYouTubeUploads("project_1");
  const preservedHistory = uploads.find((upload) => upload.id === "upload_history");
  const unaffectedUpload = uploads.find((upload) => upload.id === "upload_keep");
  assert.equal(preservedHistory?.sourceAssetId, undefined);
  assert.equal(preservedHistory?.sourceExportId, undefined);
  assert.equal(preservedHistory?.outputAssetId, undefined);
  assert.equal(unaffectedUpload?.sourceAssetId, "asset_keep");
  assert.equal(unaffectedUpload?.sourceExportId, "export_keep");
  assert.equal(unaffectedUpload?.outputAssetId, "asset_keep");
});
