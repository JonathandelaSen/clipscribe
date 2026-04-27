import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { VoiceoverGenerateRequest, VoiceoverGenerateResponseMeta, VoiceoverJobStatus } from "@/lib/voiceover/types";

export interface VoiceoverJobEntity {
  id: string;
  projectId: string;
  status: VoiceoverJobStatus;
  request: string; // JSON
  resultMeta?: string; // JSON
  error?: string;
  audioFilename?: string;
  createdAt: number;
  completedAt?: number;
}

export interface VoiceoverJobModel {
  id: string;
  projectId: string;
  status: VoiceoverJobStatus;
  request: VoiceoverGenerateRequest;
  resultMeta?: VoiceoverGenerateResponseMeta;
  error?: string;
  audioFilename?: string;
  createdAt: number;
  completedAt?: number;
}

export interface IVoiceoverJobRepository {
  create(job: VoiceoverJobModel): void;
  updateStatus(id: string, status: VoiceoverJobStatus, error?: string): void;
  markCompleted(id: string, resultMeta: VoiceoverGenerateResponseMeta, audioFilename: string): void;
  getById(id: string): VoiceoverJobModel | null;
  delete(id: string): void;
  findOldJobs(olderThan: number): VoiceoverJobModel[];
}

const DB_DIR = path.join(process.cwd(), ".data", "voiceover-jobs");
const DB_PATH = path.join(DB_DIR, "jobs.db");

// Usamos el entorno global en desarrollo para no agotar las conexiones de SQLite con HMR
const globalForSqlite = globalThis as unknown as {
  __voiceoverSqliteDb: Database.Database | undefined;
};

export class SqliteVoiceoverJobRepository implements IVoiceoverJobRepository {
  private db: Database.Database;

  constructor() {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    if (globalForSqlite.__voiceoverSqliteDb) {
      this.db = globalForSqlite.__voiceoverSqliteDb;
    } else {
      this.db = new Database(DB_PATH);
      if (process.env.NODE_ENV !== "production") {
        globalForSqlite.__voiceoverSqliteDb = this.db;
      }
      this.initDb();
    }
  }

  private initDb() {
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS voiceover_jobs (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        status TEXT NOT NULL,
        request TEXT NOT NULL,
        resultMeta TEXT,
        error TEXT,
        audioFilename TEXT,
        createdAt INTEGER NOT NULL,
        completedAt INTEGER
      )
    `);
  }

  private mapEntityToModel(entity: VoiceoverJobEntity): VoiceoverJobModel {
    return {
      ...entity,
      request: JSON.parse(entity.request) as VoiceoverGenerateRequest,
      resultMeta: entity.resultMeta ? JSON.parse(entity.resultMeta) as VoiceoverGenerateResponseMeta : undefined,
    };
  }

  create(job: VoiceoverJobModel): void {
    const stmt = this.db.prepare(`
      INSERT INTO voiceover_jobs (id, projectId, status, request, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.projectId,
      job.status,
      JSON.stringify(job.request),
      job.createdAt
    );
  }

  updateStatus(id: string, status: VoiceoverJobStatus, error?: string): void {
    const stmt = this.db.prepare(`
      UPDATE voiceover_jobs
      SET status = ?, error = ?
      WHERE id = ?
    `);
    stmt.run(status, error ?? null, id);
  }

  markCompleted(id: string, resultMeta: VoiceoverGenerateResponseMeta, audioFilename: string): void {
    const stmt = this.db.prepare(`
      UPDATE voiceover_jobs
      SET status = 'completed', resultMeta = ?, audioFilename = ?, completedAt = ?
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(resultMeta), audioFilename, Date.now(), id);
  }

  getById(id: string): VoiceoverJobModel | null {
    const stmt = this.db.prepare(`SELECT * FROM voiceover_jobs WHERE id = ?`);
    const entity = stmt.get(id) as VoiceoverJobEntity | undefined;
    if (!entity) return null;

    // Si el job lleva más de 35 minutos pendiente, el proceso murió silenciosamente
    // o el servidor se reinició. Lo marcamos como fallido para no bloquear la UI.
    if (entity.status === "pending" && Date.now() - entity.createdAt > 35 * 60 * 1000) {
      this.updateStatus(id, "interrupted", "The job timed out or the server was restarted.");
      entity.status = "interrupted";
      entity.error = "The job timed out or the server was restarted.";
    }

    return this.mapEntityToModel(entity);
  }

  delete(id: string): void {
    const stmt = this.db.prepare(`DELETE FROM voiceover_jobs WHERE id = ?`);
    stmt.run(id);
  }

  findOldJobs(olderThanMs: number): VoiceoverJobModel[] {
    const threshold = Date.now() - olderThanMs;
    const stmt = this.db.prepare(`SELECT * FROM voiceover_jobs WHERE createdAt < ?`);
    const entities = stmt.all(threshold) as VoiceoverJobEntity[];
    return entities.map(this.mapEntityToModel);
  }
}

export const voiceoverJobRepository = new SqliteVoiceoverJobRepository();
