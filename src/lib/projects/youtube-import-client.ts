import type { EditorExternalSourceRef } from "@/lib/editor/types";
import { parseProjectYouTubeImportHeaders } from "@/lib/projects/youtube-import-contract";

export interface ProjectYouTubeImportTaskSnapshot {
  id: string;
  status: "queued" | "preparing" | "running" | "finalizing" | "completed" | "failed" | "canceled";
  progress: number | null;
  message?: string;
  logLines: string[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RequestProjectYouTubeImportResult {
  file: File;
  externalSource: EditorExternalSourceRef;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
}

export async function startProjectYouTubeImportTask(input: { url: string }): Promise<{ taskId: string }> {
  const response = await fetch("/api/projects/youtube/import/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: input.url,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Could not start the YouTube import task.");
  }

  return response.json() as Promise<{ taskId: string }>;
}

export async function getProjectYouTubeImportTask(taskId: string, signal?: AbortSignal): Promise<ProjectYouTubeImportTaskSnapshot> {
  const response = await fetch(`/api/projects/youtube/import/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Could not read the YouTube import task.");
  }

  const payload = (await response.json()) as { task: ProjectYouTubeImportTaskSnapshot };
  return payload.task;
}

export async function cancelProjectYouTubeImportTask(taskId: string): Promise<void> {
  await fetch(`/api/projects/youtube/import/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  }).catch(() => undefined);
}

export async function downloadProjectYouTubeImportTaskFile(taskId: string, signal?: AbortSignal): Promise<RequestProjectYouTubeImportResult> {
  const response = await fetch(`/api/projects/youtube/import/tasks/${encodeURIComponent(taskId)}/file`, {
    method: "GET",
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Could not download the imported YouTube file.");
  }

  const metadata = parseProjectYouTubeImportHeaders(response.headers, "youtube-source.mp4");
  const arrayBuffer = await response.arrayBuffer();
  const file = new File([arrayBuffer], metadata.filename, {
    type: response.headers.get("content-type") || "video/mp4",
  });

  return {
    file,
    externalSource: {
      kind: "youtube",
      url: "",
      videoId: metadata.videoId,
      title: metadata.title,
      channelTitle: metadata.channelTitle,
    },
    sizeBytes: metadata.sizeBytes || file.size,
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
  };
}

export async function requestProjectYouTubeImport(input: {
  url: string;
  projectId?: string;
  signal?: AbortSignal;
}): Promise<RequestProjectYouTubeImportResult> {
  const response = await fetch("/api/projects/youtube/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: input.url,
      projectId: input.projectId,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    let message = "YouTube import failed.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      }
    } catch {
      const fallbackText = await response.text().catch(() => "");
      if (fallbackText.trim()) {
        message = fallbackText.trim();
      }
    }

    throw new Error(message);
  }

  const metadata = parseProjectYouTubeImportHeaders(response.headers, "youtube-source.mp4");
  const arrayBuffer = await response.arrayBuffer();
  const file = new File([arrayBuffer], metadata.filename, {
    type: response.headers.get("content-type") || "video/mp4",
  });

  return {
    file,
    externalSource: {
      kind: "youtube",
      url: input.url,
      videoId: metadata.videoId,
      title: metadata.title,
      channelTitle: metadata.channelTitle,
    },
    sizeBytes: metadata.sizeBytes || file.size,
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
  };
}
