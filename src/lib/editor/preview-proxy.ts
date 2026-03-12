"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

import type { TimelineVideoClip } from "./types";

const FFMPEG_CORE_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

let previewFfmpeg: FFmpeg | null = null;
let previewLoadPromise: Promise<FFmpeg> | null = null;
let previewQueue: Promise<void> = Promise.resolve();

async function getPreviewFFmpeg(): Promise<FFmpeg> {
  if (previewFfmpeg) return previewFfmpeg;
  if (previewLoadPromise) return previewLoadPromise;

  previewLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      if (process.env.NEXT_PUBLIC_ENABLE_LOGS === "true") {
        console.log("[FFmpeg Preview]", message);
      }
    });
    await ffmpeg.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    previewFfmpeg = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await previewLoadPromise;
  } finally {
    previewLoadPromise = null;
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
}

function buildReversePreviewFilter(clip: TimelineVideoClip, hasAudio: boolean): {
  filterComplex: string;
  mapArgs: string[];
} {
  const videoFilters = [
    `trim=start=${clip.trimStartSeconds}:end=${clip.trimEndSeconds}`,
    "setpts=PTS-STARTPTS",
    "reverse",
    "scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2",
  ];
  const filterParts = [`[0:v]${videoFilters.join(",")}[preview_v]`];

  if (hasAudio) {
    filterParts.push(
      `[0:a]atrim=start=${clip.trimStartSeconds}:end=${clip.trimEndSeconds},asetpts=PTS-STARTPTS,areverse[preview_a]`
    );
    return {
      filterComplex: filterParts.join(";"),
      mapArgs: ["-map", "[preview_v]", "-map", "[preview_a]"],
    };
  }

  return {
    filterComplex: filterParts.join(";"),
    mapArgs: ["-map", "[preview_v]", "-an"],
  };
}

export async function renderReversedClipPreview(input: {
  file: File;
  clip: TimelineVideoClip;
  hasAudio: boolean;
}): Promise<File> {
  const run = async () => {
    const ff = await getPreviewFFmpeg();
    const mountRoot = `/preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = `/preview_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
    const sourcePath = `${mountRoot}/${input.file.name}`;
    const { filterComplex, mapArgs } = buildReversePreviewFilter(input.clip, input.hasAudio);
    const audioCodecArgs = input.hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : [];

    try {
      await ff.createDir(mountRoot);
      await ff.mount("WORKERFS" as never, { files: [input.file] }, mountRoot);
      await ff.exec([
        "-i",
        sourcePath,
        "-filter_complex",
        filterComplex,
        ...mapArgs,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "30",
        ...audioCodecArgs,
        "-movflags",
        "+faststart",
        outputPath,
      ]);

      const output = await ff.readFile(outputPath);
      if (typeof output === "string") {
        throw new Error("FFmpeg returned text output instead of binary media.");
      }

      const bytes = output instanceof Uint8Array ? new Uint8Array(output) : new Uint8Array(output as Uint8Array);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return new File([arrayBuffer], sanitizeFilename(`${input.clip.label || input.file.name}_reversed_preview.mp4`), {
        type: "video/mp4",
      });
    } finally {
      try {
        await ff.deleteFile(outputPath);
      } catch {}
      try {
        await ff.unmount(mountRoot);
      } catch {}
      try {
        await ff.deleteDir(mountRoot);
      } catch {}
    }
  };

  const queuedRun = previewQueue.then(run, run);
  previewQueue = queuedRun.then(
    () => undefined,
    () => undefined
  );
  return queuedRun;
}
