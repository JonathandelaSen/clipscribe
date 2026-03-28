import test from "node:test";
import assert from "node:assert/strict";

import { createDexieProjectRepository } from "../../src/lib/repositories/project-repo";
import type {
  ContentProjectRecord,
  ProjectAssetRecord,
  ProjectExportRecord,
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
  projectYouTubeUploads = new InMemoryTable<ProjectYouTubeUploadRecord>("id");

  async transaction(_mode: string, _tables: unknown, callback: () => Promise<void>) {
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
      videoClips: [],
      videoClipGroups: [],
      audioItems: [],
    },
    subtitles: overrides.subtitles ?? {
      enabled: true,
      preset: "clean_caption",
      positionXPercent: 50,
      positionYPercent: 84,
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
