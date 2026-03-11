import { getFFmpeg } from "@/lib/ffmpeg";
import { buildProjectCaptionTimeline } from "@/lib/editor/core/captions";
import { getEditorOutputDimensions } from "@/lib/editor/core/aspect-ratio";
import { buildEditorExportPlan } from "@/lib/editor/core/export-plan";
import { renderTimelineSubtitlesToPngs } from "@/lib/editor/subtitle-canvas";
import type { EditorProjectRecord, EditorResolution, ResolvedEditorAsset } from "@/lib/editor/types";
import type { HistoryItem } from "@/lib/history";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w.-]+/g, "_");
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

export interface LocalEditorExportInput {
  project: EditorProjectRecord;
  resolvedAssets: ResolvedEditorAsset[];
  historyMap: Map<string, HistoryItem>;
  resolution: EditorResolution;
  onProgress?: (progressPct: number) => void;
}

export interface LocalEditorExportResult {
  file: File;
  width: number;
  height: number;
  warnings: string[];
  ffmpegCommandPreview: string[];
  notes: string[];
}

export async function exportEditorProjectLocally(input: LocalEditorExportInput): Promise<LocalEditorExportResult> {
  const ff = await getFFmpeg();
  const mountRoot = `/timeline_${Date.now()}`;
  const outputPath = `/timeline_out_${Date.now()}.mp4`;
  const availableAssets = input.resolvedAssets.filter((asset) => !asset.missing && asset.file);
  if (availableAssets.length === 0) {
    throw new Error("No project assets are available for export.");
  }

  const fileInputRefs: Array<{ assetId: string; inputIndex: number; path: string; file: File }> = [];
  let lastProgressPct = 0;
  const emitProgress = (pct: number) => {
    const next = Math.round(clampNumber(pct, 0, 100));
    if (next <= lastProgressPct) return;
    lastProgressPct = next;
    input.onProgress?.(next);
  };

  const progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress) && progress > 0 && progress <= 1.05) {
      emitProgress(progress * 92);
    }
  };
  ff.on("progress", progressHandler);

  const ffmpegLogTail: string[] = [];
  const logHandler = ({ message }: { message: string }) => {
    const text = String(message ?? "").trim();
    if (text) {
      ffmpegLogTail.push(text);
      if (ffmpegLogTail.length > 30) ffmpegLogTail.shift();
    }
    const seconds = parseFfmpegLogProgressSeconds(text);
    if (!seconds || !Number.isFinite(seconds)) return;
  };
  ff.on("log", logHandler);

  try {
    emitProgress(2);
    await ff.createDir(mountRoot);
    for (const [index, resolved] of availableAssets.entries()) {
      const assetDir = `${mountRoot}/${resolved.asset.id}`;
      await ff.createDir(assetDir);
      await ff.mount("WORKERFS" as never, { files: [resolved.file!] }, assetDir);
      fileInputRefs.push({
        assetId: resolved.asset.id,
        inputIndex: index,
        path: `${assetDir}/${resolved.file!.name}`,
        file: resolved.file!,
      });
    }
    emitProgress(8);

    const exportPlan = buildEditorExportPlan({
      project: input.project,
      inputs: fileInputRefs.map((entry) => {
        const resolved = availableAssets.find((asset) => asset.asset.id === entry.assetId);
        if (!resolved) {
          throw new Error(`Missing resolved asset for ${entry.assetId}`);
        }
        return {
          inputIndex: entry.inputIndex,
          assetId: entry.assetId,
          path: entry.path,
          asset: resolved.asset,
        };
      }),
      resolution: input.resolution,
    });

    const timelineCaptions = buildProjectCaptionTimeline({
      project: input.project,
      assets: input.resolvedAssets.map((resolved) => resolved.asset),
      historyMap: input.historyMap,
    });
    const subtitleFrames = await renderTimelineSubtitlesToPngs({
      chunks: timelineCaptions,
      project: input.project,
      width: exportPlan.width,
      height: exportPlan.height,
    });

    for (const frame of subtitleFrames) {
      await ff.writeFile(frame.vfsPath, frame.pngBytes);
    }
    emitProgress(15);

    const extraInputs = subtitleFrames.flatMap((frame) => ["-loop", "1", "-i", frame.vfsPath]);
    let finalVideoLabel = exportPlan.videoTrackLabel;
    let filterComplex = exportPlan.filterComplex;

    if (subtitleFrames.length > 0) {
      const overlayParts: string[] = [];
      subtitleFrames.forEach((frame, index) => {
        const inputLabel = index === 0 ? exportPlan.videoTrackLabel : `edv${index - 1}`;
        const outputLabel = index === subtitleFrames.length - 1 ? "video_out" : `edv${index}`;
        overlayParts.push(
          `[${inputLabel}][${fileInputRefs.length + index}:v]overlay=enable='between(t,${frame.start.toFixed(3)},${frame.end.toFixed(3)})'[${outputLabel}]`
        );
      });
      filterComplex = `${filterComplex};${overlayParts.join(";")}`;
      finalVideoLabel = "video_out";
    }

    const args = [
      ...exportPlan.ffmpegArgs,
      ...extraInputs,
      "-filter_complex",
      filterComplex,
      "-map",
      `[${finalVideoLabel}]`,
      "-map",
      `[${exportPlan.mixedAudioLabel ?? exportPlan.videoTrackLabel}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      input.resolution === "4K" ? "24" : "22",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    await ff.exec(args);
    emitProgress(95);

    const output = await ff.readFile(outputPath);
    if (typeof output === "string") {
      throw new Error("FFmpeg returned text output instead of binary media.");
    }
    const data = output instanceof Uint8Array ? new Uint8Array(output) : new Uint8Array(output as Uint8Array);
    if (data.byteLength < 1024) {
      throw new Error("Rendered output is empty.");
    }

    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
    const filename = sanitizeFilename(
      `${input.project.name.replace(/\.[^/.]+$/, "")}__${input.project.aspectRatio.replace(":", "x")}__${input.resolution}.mp4`
    );
    const file = new File([arrayBuffer], filename, { type: "video/mp4" });
    emitProgress(100);

    return {
      file,
      width,
      height,
      warnings: exportPlan.warnings,
      ffmpegCommandPreview: [
        "ffmpeg",
        ...args.map((value) => value.replace(mountRoot, "").replace(/^\/+/, "")),
      ],
      notes: [
        `Timeline export via ffmpeg.wasm (${input.project.aspectRatio} @ ${input.resolution}).`,
        `${input.project.timeline.videoClips.length} video clips in ripple sequence.`,
        input.project.timeline.audioItems.length
          ? `${input.project.timeline.audioItems.length} audio track item${input.project.timeline.audioItems.length === 1 ? "" : "s"} mixed with clip audio.`
          : "Clip audio only.",
        subtitleFrames.length > 0 ? `${subtitleFrames.length} subtitle frames burned into the output.` : "No subtitle burn-in frames were rendered.",
        input.resolution === "4K" ? "4K is experimental in browser and may fail on lower-memory devices." : "Standard browser export preset.",
      ],
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const logTail = ffmpegLogTail.slice(-8).join("\n");
    throw new Error(logTail ? `${rawMessage}\nffmpeg-log-tail:\n${logTail}` : rawMessage);
  } finally {
    try {
      await ff.deleteFile(outputPath);
    } catch {}
    for (const resolved of availableAssets) {
      const assetDir = `${mountRoot}/${resolved.asset.id}`;
      try {
        await ff.unmount(assetDir);
      } catch {}
      try {
        await ff.deleteDir(assetDir);
      } catch {}
    }
    try {
      await ff.deleteDir(mountRoot);
    } catch {}
    ff.off("progress", progressHandler);
    ff.off("log", logHandler);
  }
}
