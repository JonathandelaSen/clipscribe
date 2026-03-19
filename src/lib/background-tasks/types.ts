export type BackgroundTaskKind = "transcription" | "timeline-export" | "timeline-bake";

export type BackgroundTaskStatus =
  | "queued"
  | "preparing"
  | "running"
  | "finalizing"
  | "completed"
  | "failed"
  | "canceled";

export interface BackgroundTaskScope {
  projectId?: string;
  assetId?: string;
}

export interface BackgroundTaskRecord {
  id: string;
  kind: BackgroundTaskKind;
  title: string;
  message?: string;
  status: BackgroundTaskStatus;
  progress: number | null;
  canCancel: boolean;
  scope: BackgroundTaskScope;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

export interface BackgroundTaskResourceMatch {
  kind?: BackgroundTaskKind;
  projectId?: string;
  assetId?: string;
}
