import { getFFmpeg } from "@/lib/ffmpeg";
import type { ComposerAssetType } from "@/lib/composer/types";

export interface ComposerMediaMetadata {
  type: ComposerAssetType;
  mimeType: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
}

function readDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(3)) : 0;
}

export function detectComposerAssetType(file: File): ComposerAssetType {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return "audio";
  return "video";
}

async function loadMediaElement<T extends HTMLMediaElement>(element: T, file: File): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    element.preload = "metadata";
    element.src = url;
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error(`Failed to load media metadata for ${file.name}`));
      element.addEventListener("loadedmetadata", onLoaded, { once: true });
      element.addEventListener("error", onError, { once: true });
    });
    return element;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function probeVideoHasAudio(file: File): Promise<boolean> {
  const ff = await getFFmpeg();
  const mountDir = `/probe_${Date.now()}`;
  await ff.createDir(mountDir);
  await ff.mount("WORKERFS" as never, { files: [file] }, mountDir);

  try {
    await ff.exec(["-i", `${mountDir}/${file.name}`, "-map", "0:a:0", "-t", "0.1", "-f", "null", "-"]);
    return true;
  } catch {
    return false;
  } finally {
    try {
      await ff.unmount(mountDir);
      await ff.deleteDir(mountDir);
    } catch (error) {
      console.error("Failed to clean video audio probe mount", error);
    }
  }
}

export async function readComposerMediaMetadata(file: File): Promise<ComposerMediaMetadata> {
  const type = detectComposerAssetType(file);
  if (type === "audio") {
    const audio = await loadMediaElement(new Audio(), file);
    return {
      type,
      mimeType: file.type || "audio/*",
      durationSeconds: readDuration(audio.duration),
      hasAudio: true,
    };
  }

  const video = await loadMediaElement(document.createElement("video"), file);
  const width = Math.max(0, video.videoWidth || 0);
  const height = Math.max(0, video.videoHeight || 0);
  const hasAudio = await probeVideoHasAudio(file);

  return {
    type,
    mimeType: file.type || "video/*",
    durationSeconds: readDuration(video.duration),
    width,
    height,
    hasAudio,
  };
}

