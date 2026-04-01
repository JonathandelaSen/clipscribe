const STORE_TTL_MS = 15 * 60_000;
const MAX_EVENTS_PER_SESSION = 256;

export type EditorExportProgressStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface EditorExportProgressEvent {
  index: number;
  createdAt: number;
  elapsedMs: number;
  stage: string;
  message: string;
  progressPct?: number;
  processedSeconds?: number;
  durationSeconds?: number;
}

export interface EditorExportProgressEventInput {
  stage: string;
  message: string;
  progressPct?: number;
  processedSeconds?: number;
  durationSeconds?: number;
}

interface EditorExportProgressSession {
  requestId: string;
  createdAt: number;
  updatedAt: number;
  status: EditorExportProgressStatus;
  progressPct?: number;
  errorMessage?: string;
  nextEventIndex: number;
  events: EditorExportProgressEvent[];
}

export interface EditorExportProgressSnapshot {
  exists: boolean;
  requestId: string;
  status?: EditorExportProgressStatus;
  progressPct?: number;
  errorMessage?: string;
  cursor: number;
  events: EditorExportProgressEvent[];
}

const SESSIONS = new Map<string, EditorExportProgressSession>();

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanupExpiredSessions(now = Date.now()) {
  for (const [requestId, session] of SESSIONS.entries()) {
    if (now - session.updatedAt > STORE_TTL_MS) {
      SESSIONS.delete(requestId);
    }
  }
}

function getOrCreateSession(requestId: string): EditorExportProgressSession {
  cleanupExpiredSessions();
  const existing = SESSIONS.get(requestId);
  if (existing) return existing;

  const createdAt = Date.now();
  const session: EditorExportProgressSession = {
    requestId,
    createdAt,
    updatedAt: createdAt,
    status: "pending",
    nextEventIndex: 0,
    events: [],
  };
  SESSIONS.set(requestId, session);
  return session;
}

function appendEvent(session: EditorExportProgressSession, input: EditorExportProgressEventInput) {
  const now = Date.now();
  session.updatedAt = now;
  if (typeof input.progressPct === "number" && Number.isFinite(input.progressPct)) {
    session.progressPct = clampNumber(input.progressPct, 0, 100);
  }

  const event: EditorExportProgressEvent = {
    index: session.nextEventIndex++,
    createdAt: now,
    elapsedMs: now - session.createdAt,
    stage: input.stage,
    message: input.message,
    progressPct:
      typeof input.progressPct === "number" && Number.isFinite(input.progressPct)
        ? clampNumber(input.progressPct, 0, 100)
        : undefined,
    processedSeconds:
      typeof input.processedSeconds === "number" && Number.isFinite(input.processedSeconds)
        ? input.processedSeconds
        : undefined,
    durationSeconds:
      typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
        ? input.durationSeconds
        : undefined,
  };
  session.events.push(event);
  if (session.events.length > MAX_EVENTS_PER_SESSION) {
    session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
  }
}

export function startEditorExportProgress(requestId: string, initialMessage?: string) {
  const session = getOrCreateSession(requestId);
  session.status = "running";
  if (initialMessage) {
    appendEvent(session, {
      stage: "accepted",
      message: initialMessage,
    });
  }
}

export function appendEditorExportProgress(requestId: string, input: EditorExportProgressEventInput) {
  const session = getOrCreateSession(requestId);
  if (session.status === "completed" || session.status === "failed" || session.status === "canceled") {
    return;
  }
  session.status = "running";
  appendEvent(session, input);
}

export function completeEditorExportProgress(requestId: string, message?: string) {
  const session = getOrCreateSession(requestId);
  session.status = "completed";
  session.progressPct = 100;
  session.updatedAt = Date.now();
  if (message) {
    appendEvent(session, {
      stage: "completed",
      message,
      progressPct: 100,
    });
  }
}

export function failEditorExportProgress(
  requestId: string,
  message: string,
  status: Exclude<EditorExportProgressStatus, "pending" | "running" | "completed"> = "failed"
) {
  const session = getOrCreateSession(requestId);
  session.status = status;
  session.errorMessage = message;
  session.updatedAt = Date.now();
  appendEvent(session, {
    stage: status,
    message,
    progressPct: session.progressPct,
  });
}

export function readEditorExportProgress(
  requestId: string,
  cursor = -1
): EditorExportProgressSnapshot {
  cleanupExpiredSessions();
  const session = SESSIONS.get(requestId);
  if (!session) {
    return {
      exists: false,
      requestId,
      cursor,
      events: [],
    };
  }

  const normalizedCursor = Number.isFinite(cursor) ? Math.floor(cursor) : -1;
  const events = session.events.filter((event) => event.index > normalizedCursor);
  const latestCursor = session.events.length > 0 ? session.events[session.events.length - 1]!.index : normalizedCursor;

  return {
    exists: true,
    requestId,
    status: session.status,
    progressPct: session.progressPct,
    errorMessage: session.errorMessage,
    cursor: latestCursor,
    events,
  };
}
