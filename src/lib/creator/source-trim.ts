/**
 * source-trim.ts
 *
 * Pre-trims a source video to just the needed segment using FFmpeg WASM with
 * `-c copy` (stream copy = zero re-encoding). This dramatically reduces the
 * upload payload for system exports by sending only the relevant ~30 seconds
 * instead of the full source video which can be hundreds of MB or even GBs.
 *
 * The trim uses a generous cushion so FFmpeg on the server can still apply
 * hybrid seek and accurate frame-level trimming.
 */

import { getFFmpeg } from "@/lib/ffmpeg";
import { throwIfBrowserRenderCanceled } from "@/lib/browser-render";

/**
 * Seconds of cushion added before the clip start to allow the server-side
 * FFmpeg to do accurate keyframe-based seeking. Stream copy can only cut on
 * keyframe boundaries, so extra pre-roll ensures the server has full control.
 */
const PRE_CUSHION_SECONDS = 10;

/**
 * Seconds of cushion added after the clip end.
 */
const POST_CUSHION_SECONDS = 5;

export interface TrimSourceResult {
  /** The trimmed video as a File, suitable for FormData upload. */
  trimmedFile: File;
  /**
   * How many seconds were cut from the beginning of the original source.
   * Subtract this from all absolute timestamps (startSeconds, endSeconds)
   * to get their positions relative to the trimmed file.
   */
  trimmedOffsetSeconds: number;
}

/**
 * Trim a source video file to the segment around a clip using FFmpeg WASM
 * with `-c copy` (no re-encoding). Returns the trimmed file and the offset
 * so the caller can adjust seek positions.
 *
 * Falls back to returning the original file if trimming fails.
 */
export async function trimSourceForExport(input: {
  sourceFile: File;
  clipStartSeconds: number;
  clipEndSeconds: number;
  signal?: AbortSignal;
}): Promise<TrimSourceResult> {
  const trimStart = Math.max(0, input.clipStartSeconds - PRE_CUSHION_SECONDS);
  const trimEnd = input.clipEndSeconds + POST_CUSHION_SECONDS;
  const trimDuration = trimEnd - trimStart;

  // If the trim wouldn't save meaningful bytes, skip it
  // (e.g. clip starts near 0 and covers most of the file)
  if (trimStart < 1 && trimDuration > 120) {
    return {
      trimmedFile: input.sourceFile,
      trimmedOffsetSeconds: 0,
    };
  }

  const ff = await getFFmpeg();
  throwIfBrowserRenderCanceled(input.signal);

  const mountDir = `/trim_${Date.now()}`;
  const outputName = `trimmed_${Date.now()}.mp4`;

  try {
    await ff.createDir(mountDir);
    await ff.mount("WORKERFS" as never, { files: [input.sourceFile] }, mountDir);
    throwIfBrowserRenderCanceled(input.signal);

    await ff.exec(
      [
        "-fflags",
        "+genpts",
        "-ss",
        String(trimStart),
        "-i",
        `${mountDir}/${input.sourceFile.name}`,
        "-t",
        String(trimDuration),
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        outputName,
      ],
      -1,
      { signal: input.signal }
    );

    const output = await ff.readFile(outputName);
    throwIfBrowserRenderCanceled(input.signal);

    if (typeof output === "string") {
      throw new Error("FFmpeg trim returned text instead of binary data");
    }

    const data = output instanceof Uint8Array ? new Uint8Array(output) : new Uint8Array(output as Uint8Array);

    // Sanity: the trimmed file should be at least 1KB
    if (data.byteLength < 1024) {
      throw new Error("Trimmed output is too small — falling back to full source");
    }

    const originalExtension = input.sourceFile.name.replace(/^.*(\.[^.]+)$/, "$1") || ".mp4";
    const trimmedFilename = input.sourceFile.name.replace(/\.[^/.]+$/, `__trimmed${originalExtension}`);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const trimmedFile = new File([arrayBuffer], trimmedFilename, {
      type: input.sourceFile.type || "video/mp4",
    });

    const savedMB = ((input.sourceFile.size - trimmedFile.size) / (1024 * 1024)).toFixed(1);
    console.log(
      `[source-trim] Trimmed source from ${(input.sourceFile.size / (1024 * 1024)).toFixed(1)}MB to ${(trimmedFile.size / (1024 * 1024)).toFixed(1)}MB (saved ${savedMB}MB). Offset=${trimStart.toFixed(2)}s`
    );

    return {
      trimmedFile,
      trimmedOffsetSeconds: trimStart,
    };
  } catch (error) {
    // If cancellation was requested, re-throw
    if (input.signal?.aborted) {
      throw error;
    }

    // On any other error, fall back silently to the full source
    console.warn("[source-trim] Trim failed, falling back to full source upload:", error);
    return {
      trimmedFile: input.sourceFile,
      trimmedOffsetSeconds: 0,
    };
  } finally {
    try {
      await ff.deleteFile(outputName);
    } catch {}
    try {
      await ff.unmount(mountDir);
      await ff.deleteDir(mountDir);
    } catch {}
  }
}
