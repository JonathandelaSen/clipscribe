import { getFFmpeg, resetFFmpeg } from "../ffmpeg";
import { getFfmpegExecTimeoutMs } from "../ffmpeg-config";
import {
  isBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
  type BrowserRenderLifecycle,
} from "../browser-render";
import { buildProjectCaptionTimeline } from "./core/captions";
import { getEditorOutputDimensions } from "./core/aspect-ratio";
import { buildEditorExportPlan } from "./core/export-plan";
import { isEditorFfmpegExecDiagnosticMessage, runEditorFfmpegExec } from "./local-render-runtime";
import { renderTimelineSubtitlesToPngs } from "./subtitle-canvas";
import type { EditorProjectRecord, EditorResolution, ResolvedEditorAsset } from "./types";
import type { HistoryItem } from "../history";

const LOCAL_EDITOR_EXPORT_PROGRESS = {
  init: 2,
  mounted: 8,
  preRender: 15,
  renderMax: 92,
  readOutput: 95,
  packaged: 100,
} as const;

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
  renderLifecycle?: BrowserRenderLifecycle;
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
  setBrowserRenderStage(input.renderLifecycle, "preparing");
  const ff = await getFFmpeg();
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  const mountRoot = `/timeline_${Date.now()}`;
  const outputPath = `/timeline_out_${Date.now()}.mp4`;
  const availableAssets = input.resolvedAssets.filter((asset) => !asset.missing && asset.file);
  if (availableAssets.length === 0) {
    throw new Error("No project assets are available for export.");
  }

  const fileInputRefs: Array<{ assetId: string; inputIndex: number; path: string; file: File }> = [];
  const ffmpegLogTail: string[] = [];
  const renderClipCount = input.project.timeline.videoClips.length;

  let lastProgressPct = 0;
  let renderDurationSeconds = 0;
  let timeoutMs = 0;
  let progressTimeBaselineSeconds: number | null = null;
  let logTimeBaselineSeconds: number | null = null;

  const emitProgress = (pct: number) => {
    const next = Math.round(clampNumber(pct, 0, 100));
    if (next <= lastProgressPct) return;
    lastProgressPct = next;
    input.onProgress?.(next);
  };

  const emitRenderProgress = (renderPct: number) => {
    const safeRenderPct = clampNumber(renderPct, 0, 100);
    const span = LOCAL_EDITOR_EXPORT_PROGRESS.renderMax - LOCAL_EDITOR_EXPORT_PROGRESS.preRender;
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.preRender + (safeRenderPct / 100) * span);
  };

  const resetProgressTimeBaselines = () => {
    progressTimeBaselineSeconds = null;
    logTimeBaselineSeconds = null;
  };

  const normalizeProcessedSeconds = (seconds: number, source: "progress" | "log"): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    const baseline = source === "progress" ? progressTimeBaselineSeconds : logTimeBaselineSeconds;
    if (baseline == null || seconds + 0.25 < baseline) {
      if (source === "progress") {
        progressTimeBaselineSeconds = seconds;
      } else {
        logTimeBaselineSeconds = seconds;
      }
      return 0;
    }
    return Math.max(0, seconds - baseline);
  };

  const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
    if (renderDurationSeconds > 0 && Number.isFinite(time) && time > 0) {
      const processedSeconds = normalizeProcessedSeconds(time / 1_000_000, "progress");
      if (processedSeconds > 0) {
        emitRenderProgress((processedSeconds / renderDurationSeconds) * 100);
        return;
      }
    }

    if (Number.isFinite(progress) && progress > 0 && progress <= 1.05) {
      emitRenderProgress(progress * 100);
    }
  };
  ff.on("progress", progressHandler);

  const logHandler = ({ message }: { message: string }) => {
    const text = String(message ?? "").trim();
    if (text) {
      ffmpegLogTail.push(text);
      if (ffmpegLogTail.length > 30) ffmpegLogTail.shift();
    }
    if (renderDurationSeconds <= 0) return;

    const rawSeconds = parseFfmpegLogProgressSeconds(text);
    if (rawSeconds == null || rawSeconds <= 0) return;
    const processedSeconds = normalizeProcessedSeconds(rawSeconds, "log");
    if (processedSeconds <= 0) return;
    emitRenderProgress((processedSeconds / renderDurationSeconds) * 100);
  };
  ff.on("log", logHandler);

  const runFfmpegExecWithFallbackProgress = async (args: string[]) => {
    const startPct = Math.max(lastProgressPct, LOCAL_EDITOR_EXPORT_PROGRESS.preRender);
    const startedAt = Date.now();
    const quickRampMs = Math.max(4_000, renderDurationSeconds * 2_500);
    const tailTauMs = Math.max(12_000, renderDurationSeconds * 5_000);
    const quickTarget = 82;
    const fallbackCeiling = LOCAL_EDITOR_EXPORT_PROGRESS.renderMax - 1;

    resetProgressTimeBaselines();

    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed <= quickRampMs) {
        const linear = clampNumber(elapsed / quickRampMs, 0, 1);
        const eased = 1 - Math.pow(1 - linear, 3);
        emitProgress(startPct + (quickTarget - startPct) * eased);
        return;
      }

      const tailElapsed = elapsed - quickRampMs;
      const tailEased = 1 - Math.exp(-tailElapsed / tailTauMs);
      emitProgress(quickTarget + (fallbackCeiling - quickTarget) * tailEased);
    }, 250);

    try {
      await runEditorFfmpegExec({
        ff,
        args,
        timeoutMs,
        resolution: input.resolution,
        clipCount: renderClipCount,
        durationSeconds: renderDurationSeconds,
        logTail: ffmpegLogTail,
        resetFfmpeg: resetFFmpeg,
      });
    } finally {
      clearInterval(timer);
    }
  };

  try {
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.init);
    await ff.createDir(mountRoot);
    for (const [index, resolved] of availableAssets.entries()) {
      throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
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
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.mounted);

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
    renderDurationSeconds = Math.max(exportPlan.durationSeconds, 0.5);
    timeoutMs = getFfmpegExecTimeoutMs(input.resolution, exportPlan.durationSeconds);

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
      signal: input.renderLifecycle?.signal,
    });

    for (const frame of subtitleFrames) {
      throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
      await ff.writeFile(frame.vfsPath, frame.pngBytes);
    }
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.preRender);

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

    setBrowserRenderStage(input.renderLifecycle, "rendering");
    await runFfmpegExecWithFallbackProgress(args);
    setBrowserRenderStage(input.renderLifecycle, "handoff");
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.readOutput);

    const output = await ff.readFile(outputPath);
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    if (typeof output === "string") {
      throw new Error("FFmpeg returned text output instead of binary media.");
    }
    const data = output instanceof Uint8Array ? new Uint8Array(output) : new Uint8Array(output as Uint8Array);
    if (data.byteLength < 1024) {
      throw new Error("Rendered output is empty.");
    }

    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
    const filename = sanitizeFilename(
      `${input.project.name.replace(/\.[^/.]+$/, "")}__${input.project.aspectRatio.replace(":", "x")}__${input.resolution}.mp4`
    );
    const file = new File([arrayBuffer], filename, { type: "video/mp4" });
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.packaged);

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
    if (isBrowserRenderCanceledError(error) || input.renderLifecycle?.signal?.aborted) {
      throw error;
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    if (isEditorFfmpegExecDiagnosticMessage(rawMessage)) {
      throw error instanceof Error ? error : new Error(rawMessage);
    }

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
