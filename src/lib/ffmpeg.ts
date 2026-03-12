import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

import { FFMPEG_CORE_BASE_URL, FFMPEG_LOAD_TIMEOUT_MS } from "./ffmpeg-config";

let ffmpegInstance: FFmpeg | null = null;
let pendingInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

function attachFfmpegLogs(ffmpeg: FFmpeg) {
  ffmpeg.on("log", ({ message }) => {
    if (process.env.NEXT_PUBLIC_ENABLE_LOGS === "true") {
      console.log("[FFmpeg]", message);
    }
  });
}

function formatFfmpegLoadError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new Error(`Failed to initialize FFmpeg. Loading timed out after ${Math.round(FFMPEG_LOAD_TIMEOUT_MS / 1000)}s.`);
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to initialize FFmpeg. ${rawMessage}`);
}

async function loadFfmpeg(ffmpeg: FFmpeg): Promise<FFmpeg> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FFMPEG_LOAD_TIMEOUT_MS);

  try {
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    ]);

    await ffmpeg.load(
      {
        coreURL,
        wasmURL,
      },
      { signal: controller.signal }
    );

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  } catch (error) {
    ffmpeg.terminate();
    ffmpegInstance = null;
    throw formatFfmpegLoadError(error);
  } finally {
    clearTimeout(timeoutId);
    if (pendingInstance === ffmpeg) {
      pendingInstance = null;
    }
  }
}

export async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  const ffmpeg = new FFmpeg();
  pendingInstance = ffmpeg;
  attachFfmpegLogs(ffmpeg);
  const currentLoadPromise = loadFfmpeg(ffmpeg);
  loadPromise = currentLoadPromise;

  try {
    return await currentLoadPromise;
  } finally {
    if (loadPromise === currentLoadPromise) {
      loadPromise = null;
    }
  }
}

export function resetFFmpeg() {
  const activeInstance = ffmpegInstance ?? pendingInstance;
  ffmpegInstance = null;
  pendingInstance = null;
  loadPromise = null;
  activeInstance?.terminate();
}

function getAudioContextConstructor(): typeof AudioContext {
  const webkitWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = window.AudioContext ?? webkitWindow.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is not available in this browser.");
  }
  return AudioContextConstructor;
}

export async function extractAudioWithFFmpeg(file: File, onProgress?: (p: number) => void): Promise<Float32Array> {
  const ff = await getFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(progress);
  };

  ff.on("progress", progressHandler);

  const mntDir = `/mnt_${Date.now()}`;
  const outputName = `output_${Date.now()}.wav`;

  try {
    // Mount the large file using zero-copy WORKERFS
    await ff.createDir(mntDir);
    await ff.mount("WORKERFS" as never, { files: [file] }, mntDir);

    // Run FFmpeg to extract audio as 16kHz mono WAV
    await ff.exec([
      "-i", `${mntDir}/${file.name}`,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      outputName,
    ]);

    // Read the resulting small WAV file into memory
    const data = await ff.readFile(outputName);

    // Cleanup generated file
    await ff.deleteFile(outputName);

    // Decode the WAV file using Native AudioContext
    const AudioContextConstructor = getAudioContextConstructor();
    const audioContext = new AudioContextConstructor({
      sampleRate: 16000,
    });

    const arrayBuffer = (data as Uint8Array).buffer as ArrayBuffer;
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return audioBuffer.getChannelData(0);
  } finally {
    // Always cleanup mounts and listeners
    try {
      await ff.unmount(mntDir);
      await ff.deleteDir(mntDir);
    } catch (e) {
      console.error("Cleanup mount error", e);
    }
    ff.off("progress", progressHandler);
  }
}
