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
      source: { kind: "none" },
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
    voiceoverDraft: overrides.voiceoverDraft,
  };
}

function createAsset(overrides: Partial<ProjectAssetRecord> = {}): ProjectAssetRecord {
  return {
    id: overrides.id ?? "asset_1",
    projectId: overrides.projectId ?? "project_1",
    role: overrides.role ?? "support",
    origin: overrides.origin ?? "ai-audio",
    sourceType: overrides.sourceType ?? "upload",
    kind: overrides.kind ?? "audio",
    filename: overrides.filename ?? "voiceover.mp3",
    mimeType: overrides.mimeType ?? "audio/mpeg",
    sizeBytes: overrides.sizeBytes ?? 1024,
    durationSeconds: overrides.durationSeconds ?? 12,
    hasAudio: overrides.hasAudio ?? true,
    captionSource: overrides.captionSource ?? { kind: "none" },
    createdAt: overrides.createdAt ?? 100,
    updatedAt: overrides.updatedAt ?? 100,
    fileBlob: overrides.fileBlob,
  };
}

function createVoiceover(overrides: Partial<ProjectVoiceoverRecord> = {}): ProjectVoiceoverRecord {
  return {
    id: overrides.id ?? "voiceover_1",
    projectId: overrides.projectId ?? "project_1",
    assetId: overrides.assetId ?? "asset_1",
    createdAt: overrides.createdAt ?? 100,
    scriptText: overrides.scriptText ?? "Hola mundo",
    provider: overrides.provider ?? "elevenlabs",
    model: overrides.model ?? "eleven_multilingual_v2",
    voiceId: overrides.voiceId ?? "voice_1",
    outputFormat: overrides.outputFormat ?? "mp3",
    sourceFilename: overrides.sourceFilename,
    apiKeySource: overrides.apiKeySource,
    maskedApiKey: overrides.maskedApiKey,
  };
}

test("project repository lists voiceovers newest first", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await repository.putProjectVoiceover(createVoiceover({ id: "voiceover_old", createdAt: 100 }));
  await repository.putProjectVoiceover(createVoiceover({ id: "voiceover_new", createdAt: 200 }));

  const voiceovers = await repository.listProjectVoiceovers("project_1");
  assert.deepEqual(voiceovers.map((record) => record.id), ["voiceover_new", "voiceover_old"]);
});

test("deleteAsset removes linked voiceover records", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await database.projectAssets.put(createAsset({ id: "asset_keep", projectId: "project_1" }));
  await database.projectAssets.put(createAsset({ id: "asset_drop", projectId: "project_1" }));
  await repository.putProjectVoiceover(createVoiceover({ id: "voiceover_keep", assetId: "asset_keep" }));
  await repository.putProjectVoiceover(createVoiceover({ id: "voiceover_drop", assetId: "asset_drop" }));

  await repository.deleteAsset("asset_drop");

  assert.deepEqual(
    (await repository.listProjectVoiceovers("project_1")).map((record) => record.id),
    ["voiceover_keep"]
  );
});

test("deleteProject removes linked voiceovers", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await database.projects.put(createProject({ id: "project_1" }));
  await database.projects.put(createProject({ id: "project_2" }));
  await repository.putProjectVoiceover(createVoiceover({ id: "voiceover_1", projectId: "project_1" }));
  await repository.putProjectVoiceover(createVoiceover({ id: "voiceover_2", projectId: "project_2" }));

  await repository.deleteProject("project_1");

  assert.deepEqual(
    (await repository.listProjectVoiceovers()).map((record) => record.id),
    ["voiceover_2"]
  );
});

test("project repository preserves optional voiceover replay metadata", async () => {
  const database = new InMemoryProjectDb();
  const repository = createDexieProjectRepository(database as never);

  await repository.putProjectVoiceover(
    createVoiceover({
      id: "voiceover_meta",
      apiKeySource: "voiceover_settings",
      maskedApiKey: "xi-se...cdef",
    })
  );

  const [record] = await repository.listProjectVoiceovers("project_1");
  assert.equal(record?.apiKeySource, "voiceover_settings");
  assert.equal(record?.maskedApiKey, "xi-se...cdef");
});
