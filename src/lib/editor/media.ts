export interface MediaMetadataResult {
  kind: "video" | "audio";
  durationSeconds: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
}

export async function readMediaMetadata(file: File): Promise<MediaMetadataResult> {
  const url = URL.createObjectURL(file);
  try {
    if (isVideoFile(file)) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error(`Failed to read metadata for ${file.name}`)), {
          once: true,
        });
      });
      const detectedHasAudio = Boolean(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).mozHasAudio || (video as any).webkitAudioDecodedByteCount || (video as any).audioTracks?.length
      );
      return {
        kind: "video",
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        hasAudio: detectedHasAudio,
      };
    }

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error(`Failed to read metadata for ${file.name}`)), {
        once: true,
      });
    });
    return {
      kind: "audio",
      durationSeconds: Number.isFinite(audio.duration) ? audio.duration : 0,
      hasAudio: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
