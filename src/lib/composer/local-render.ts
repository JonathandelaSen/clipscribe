import { getFFmpeg } from "@/lib/ffmpeg";
import { buildComposerRenderPlan } from "@/lib/composer/core/render-plan";
import type {
  ComposerAssetRecord,
  ComposerExportSettings,
  ComposerTimelineItem,
} from "@/lib/composer/types";

const LOCAL_EXPORT_PROGRESS = {
  init: 2,
  renderMax: 92,
  readOutput: 95,
  packaged: 98,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseFfmpegTimecodeToSeconds(timecode: string): number | null {
  const match = timecode.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return null;
  const [, hoursRaw, minutesRaw, secondsRaw, fractionRaw] = match;
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  const fraction = fractionRaw ? Number(`0.${fractionRaw}`) : 0;
  if (![hours, minutes, seconds, fraction].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function parseFfmpegLogProgressSeconds(message: string): number | null {
  const match = message.match(/\btime=(\d+:\d{2}:\d{2}(?:\.\d+)?)\b/);
  if (!match) return null;
  return parseFfmpegTimecodeToSeconds(match[1]);
}

export interface LocalComposerExportInput {
  items: ComposerTimelineItem[];
  assets: ComposerAssetRecord[];
  assetFiles: Map<string, File>;
  exportSettings: ComposerExportSettings;
  outputBasename: string;
  onProgress?: (progressPct: number) => void;
}

export interface LocalComposerExportResult {
  file: File;
  ffmpegCommandPreview: string[];
  notes: string[];
  resolution: string;
}

export async function exportComposerVideoLocally(
  input: LocalComposerExportInput
): Promise<LocalComposerExportResult> {
  const plan = buildComposerRenderPlan({
    items: input.items,
    assets: input.assets,
    exportSettings: input.exportSettings,
    outputBasename: input.outputBasename,
  });

  const ff = await getFFmpeg();
  const mountRoot = `/composer_${Date.now()}`;
  const outputPath = `${mountRoot}/out.mp4`;
  const mountedDirs: string[] = [];

  await ff.createDir(mountRoot);
  mountedDirs.push(mountRoot);

  let lastProgressPct = 0;
  const emitProgress = (pct: number) => {
    const next = Math.round(clamp(pct, 0, 100));
    if (next <= lastProgressPct) return;
    lastProgressPct = next;
    input.onProgress?.(next);
  };

  emitProgress(LOCAL_EXPORT_PROGRESS.init);

  for (const descriptor of plan.inputDescriptors) {
    const file = input.assetFiles.get(descriptor.assetId);
    if (!file) {
      throw new Error(`Missing asset file for ${descriptor.assetFilename}`);
    }
    const mountDir = `${mountRoot}/input_${descriptor.inputIndex}`;
    await ff.createDir(mountDir);
    await ff.mount("WORKERFS" as never, { files: [file] }, mountDir);
    mountedDirs.push(mountDir);
  }

  const ffmpegLogTail: string[] = [];
  const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
    if (Number.isFinite(time) && time > 0) {
      const seconds = time / 1_000_000;
      emitProgress(LOCAL_EXPORT_PROGRESS.init + (seconds / plan.durationSeconds) * (LOCAL_EXPORT_PROGRESS.renderMax - LOCAL_EXPORT_PROGRESS.init));
      return;
    }
    if (Number.isFinite(progress) && progress > 0) {
      emitProgress(LOCAL_EXPORT_PROGRESS.init + progress * (LOCAL_EXPORT_PROGRESS.renderMax - LOCAL_EXPORT_PROGRESS.init));
    }
  };
  const logHandler = ({ message }: { message: string }) => {
    const text = String(message ?? "").trim();
    if (text) {
      ffmpegLogTail.push(text);
      if (ffmpegLogTail.length > 60) ffmpegLogTail.shift();
    }
    const loggedSeconds = parseFfmpegLogProgressSeconds(text);
    if (loggedSeconds == null) return;
    emitProgress(LOCAL_EXPORT_PROGRESS.init + (loggedSeconds / plan.durationSeconds) * (LOCAL_EXPORT_PROGRESS.renderMax - LOCAL_EXPORT_PROGRESS.init));
  };

  ff.on("progress", progressHandler);
  ff.on("log", logHandler);

  const args = [
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${plan.preset.width}x${plan.preset.height}:d=${plan.durationSeconds.toFixed(3)}`,
    ...plan.inputDescriptors.flatMap((descriptor) => [
      "-i",
      `${mountRoot}/input_${descriptor.inputIndex}/${input.assetFiles.get(descriptor.assetId)?.name ?? descriptor.assetFilename}`,
    ]),
    "-filter_complex",
    plan.filterComplex,
    "-map",
    `[${plan.mapVideoLabel}]`,
    ...(plan.mapAudioLabel
      ? ["-map", `[${plan.mapAudioLabel}]`, "-c:a", "aac", "-b:a", `${plan.preset.audioBitrateKbps}k`]
      : ["-an"]),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(plan.preset.crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  try {
    await ff.exec(args);
    emitProgress(LOCAL_EXPORT_PROGRESS.readOutput);

    const data = await ff.readFile(outputPath);
    emitProgress(LOCAL_EXPORT_PROGRESS.packaged);
    const safeBytes =
      typeof data === "string" ? new TextEncoder().encode(data) : Uint8Array.from(data);
    const file = new File([safeBytes], plan.outputFilename, { type: "video/mp4" });
    emitProgress(100);

    return {
      file,
      ffmpegCommandPreview: ["ffmpeg", ...args],
      notes: [...plan.notes, `Rendered ${plan.outputFilename} at ${plan.preset.resolution}.`, ...ffmpegLogTail.slice(-8)],
      resolution: plan.preset.resolution,
    };
  } finally {
    ff.off("progress", progressHandler);
    ff.off("log", logHandler);
    try {
      await ff.deleteFile(outputPath);
    } catch {}
    for (const mountDir of mountedDirs.slice().reverse()) {
      if (mountDir === mountRoot) continue;
      try {
        await ff.unmount(mountDir);
      } catch {}
      try {
        await ff.deleteDir(mountDir);
      } catch {}
    }
    try {
      await ff.deleteDir(mountRoot);
    } catch {}
  }
}
