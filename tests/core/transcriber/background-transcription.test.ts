import test from "node:test";
import assert from "node:assert/strict";

import { startBackgroundTranscriptionTask } from "../../../src/lib/transcriber/core/background-transcription";
import type { ProjectRepository } from "../../../src/lib/repositories/project-repo";
import type { AssetTranscriptRecord, ContentProjectRecord, ProjectAssetRecord, ProjectHistoryItem } from "../../../src/lib/projects/types";

type WorkerMessage = {
  status: "progress" | "ready" | "chunk_progress" | "complete" | "error";
  data?: { file: string; name: string; progress: number };
  progress?: number;
  output?: unknown;
  error?: string;
};

class MockWorker {
  listener: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  terminated = false;
  constructor(private readonly onPostMessage: (worker: MockWorker) => void) {}

  addEventListener(_type: "message", listener: (event: MessageEvent<WorkerMessage>) => void) {
    this.listener = listener;
  }

  removeEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void) {
    void type;
    void listener;
    this.listener = null;
  }

  postMessage(message: { type: "transcribe"; audio: Float32Array; duration: number; language?: string }) {
    void message;
    this.onPostMessage(this);
  }

  emit(message: WorkerMessage) {
    this.listener?.({ data: message } as MessageEvent<WorkerMessage>);
  }

  terminate() {
    this.terminated = true;
  }
}

function buildRepository() {
  const asset: ProjectAssetRecord = {
    id: "asset_1",
    projectId: "proj_1",
    kind: "audio",
    role: "source",
    origin: "upload",
    filename: "voice.wav",
    mimeType: "audio/wav",
    sizeBytes: 10,
    durationSeconds: 1,
    hasAudio: true,
    sourceType: "upload",
    captionSource: { kind: "none" },
    createdAt: 1,
    updatedAt: 1,
    fileBlob: new File(["a"], "voice.wav", { type: "audio/wav" }),
  };
  let transcriptRecord: AssetTranscriptRecord | undefined;

  const repository: Partial<ProjectRepository> = {
    async getAsset(assetId: string) {
      return assetId === asset.id ? asset : undefined;
    },
    async bulkPutAssets(records: ProjectAssetRecord[]) {
      const next = records[0];
      asset.filename = next.filename;
      asset.updatedAt = next.updatedAt;
      asset.fileBlob = next.fileBlob;
    },
    async listProjectHistory(projectId?: string) {
      if (!transcriptRecord || (projectId && transcriptRecord.projectId !== projectId)) return [];
      return [
        {
          id: transcriptRecord.assetId,
          mediaId: transcriptRecord.assetId,
          assetId: transcriptRecord.assetId,
          projectId: transcriptRecord.projectId,
          filename: asset.filename,
          createdAt: transcriptRecord.createdAt,
          updatedAt: transcriptRecord.updatedAt,
          timestamp: transcriptRecord.timestamp,
          activeTranscriptVersionId: transcriptRecord.activeTranscriptVersionId,
          transcripts: transcriptRecord.transcripts,
        },
      ] as ProjectHistoryItem[];
    },
    async putAssetTranscript(record: AssetTranscriptRecord) {
      transcriptRecord = record;
    },
    async getAssetTranscript(assetId: string) {
      return transcriptRecord?.assetId === assetId ? transcriptRecord : undefined;
    },
    async putProject(record: ContentProjectRecord) {
      void record;
    },
  };

  return {
    repository: repository as ProjectRepository,
    getTranscriptRecord: () => transcriptRecord,
  };
}

test("startBackgroundTranscriptionTask persists progress and final transcript output", async () => {
  const repo = buildRepository();
  const updates: Array<{ status?: string; progress?: number | null; message?: string }> = [];

  const worker = new MockWorker((instance) => {
    queueMicrotask(() => {
      instance.emit({ status: "ready" });
      instance.emit({ status: "chunk_progress", progress: 42 });
      instance.emit({
        status: "complete",
        output: {
          text: "hola mundo",
          language: "es",
          chunks: [
            { text: "hola", timestamp: [0, 0.45] },
            { text: "mundo", timestamp: [0.45, 1] },
          ],
        },
      });
    });
  });

  const task = startBackgroundTranscriptionTask(
    {
      file: new File(["a"], "voice.wav", { type: "audio/wav" }),
      language: "es",
      projectId: "proj_1",
      assetId: "asset_1",
    },
    {
      decodeAudio: async () => new Float32Array(16000),
      createWorker: () => worker,
      repository: repo.repository,
    },
    {
      onTaskUpdate: (update) => {
        updates.push(update);
      },
    }
  );

  await task.promise;

  const transcriptRecord = repo.getTranscriptRecord();
  assert.ok(transcriptRecord);
  assert.equal(transcriptRecord?.transcripts[0].status, "completed");
  assert.equal(transcriptRecord?.transcripts[0].transcript, "hola mundo");
  assert.equal(transcriptRecord?.transcripts[0].detectedLanguage, "es");
  assert.deepEqual(transcriptRecord?.transcripts[0].wordChunks, [
    { text: "hola", timestamp: [0, 0.45] },
    { text: "mundo", timestamp: [0.45, 1] },
  ]);
  assert.deepEqual(transcriptRecord?.transcripts[0].chunks, [
    { text: "hola mundo", timestamp: [0, 1] },
  ]);
  assert.equal(transcriptRecord?.transcripts[0].subtitles[0].kind, "original");
  assert.equal(updates.some((update) => update.progress === 42), true);
  assert.equal(worker.terminated, true);
});

test("startBackgroundTranscriptionTask creates a transcribing version before audio decode finishes", async () => {
  const repo = buildRepository();
  let finishDecode!: (value: Float32Array) => void;

  const task = startBackgroundTranscriptionTask(
    {
      file: new File(["a"], "voice.wav", { type: "audio/wav" }),
      language: "es",
      projectId: "proj_1",
      assetId: "asset_1",
    },
    {
      decodeAudio: async () => await new Promise<Float32Array>((resolve) => {
        finishDecode = resolve;
      }),
      createWorker: () => new MockWorker(() => {}),
      repository: repo.repository,
    },
    {
      onTaskUpdate: () => {},
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  const transcriptRecord = repo.getTranscriptRecord();
  assert.ok(transcriptRecord);
  assert.equal(transcriptRecord?.transcripts[0].status, "transcribing");

  task.cancel();
  finishDecode(new Float32Array(16000));
  await task.promise;
});

test("startBackgroundTranscriptionTask marks the transcript as error when audio preparation fails", async () => {
  const repo = buildRepository();

  const task = startBackgroundTranscriptionTask(
    {
      file: new File(["a"], "voice.wav", { type: "audio/wav" }),
      language: "es",
      projectId: "proj_1",
      assetId: "asset_1",
    },
    {
      decodeAudio: async () => {
        throw new Error("Decode failed");
      },
      createWorker: () => new MockWorker(() => {}),
      repository: repo.repository,
    },
    {
      onTaskUpdate: () => {},
    }
  );

  await assert.rejects(task.promise, /Decode failed/);

  const transcriptRecord = repo.getTranscriptRecord();
  assert.ok(transcriptRecord);
  assert.equal(transcriptRecord?.transcripts[0].status, "error");
  assert.equal(transcriptRecord?.transcripts[0].error, "Decode failed");
});

test("startBackgroundTranscriptionTask marks the transcript as stopped when canceled", async () => {
  const repo = buildRepository();
  const worker = new MockWorker((instance) => {
    queueMicrotask(() => {
      instance.emit({ status: "ready" });
    });
  });

  const task = startBackgroundTranscriptionTask(
    {
      file: new File(["a"], "voice.wav", { type: "audio/wav" }),
      language: "en",
      projectId: "proj_1",
      assetId: "asset_1",
    },
    {
      decodeAudio: async () => new Float32Array(16000),
      createWorker: () => worker,
      repository: repo.repository,
    },
    {
      onTaskUpdate: () => {},
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  task.cancel();
  await task.promise;

  const transcriptRecord = repo.getTranscriptRecord();
  assert.ok(transcriptRecord);
  assert.equal(transcriptRecord?.transcripts[0].status, "stopped");
  assert.equal(worker.terminated, true);
});
