import { getFFmpeg, resetFFmpeg } from "../ffmpeg";
import { getFfmpegRenderStallTimeoutMs } from "../ffmpeg-config";
import {
  isBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
  type BrowserRenderLifecycle,
} from "../browser-render";
import { buildProjectCaptionTimeline } from "./core/captions";
import { getEditorOutputDimensions } from "./core/aspect-ratio";
import {
  buildEditorAudioExportPlan,
  buildEditorExportPlan,
  type ResolvedExportInput,
} from "./core/export-plan";
import { buildEditorExportFilename } from "./export-output";
import {
  BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT,
  BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS,
  buildSegmentedBrowserRenderSegments,
  shouldUseSegmentedBrowserRender,
} from "./local-render-segments";
import {
  createEditorFfmpegActivityWatchdog,
  isEditorFfmpegExecDiagnosticMessage,
  runEditorFfmpegExec,
  type EditorFfmpegActivityWatchdog,
} from "./local-render-runtime";
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

const FFMPEG_INTERESTING_LOG_PATTERN =
  /(error\b|failed\b|invalid\b|could not\b|cannot\b|unable\b|too many packets buffered\b|non[- ]monoton|no space left\b|trailer\b|av_interleaved_write_frame\b|resource temporarily unavailable\b|out of memory\b)/i;
const SEGMENTED_RENDER_FINALIZE_BUDGET_PCT = 10;
const SEGMENTED_RENDER_SEGMENT_BUDGET_PCT = 100 - SEGMENTED_RENDER_FINALIZE_BUDGET_PCT;

interface MountedFileInputRef {
  assetId: string;
  inputIndex: number;
  path: string;
  file: File;
}

interface RenderPassResult {
  warnings: string[];
  ffmpegArgs: string[];
}

function clampNumber(value: number, min: number, max: number): number {
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

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function copyBinaryOutput(output: string | Uint8Array): Uint8Array {
  if (typeof output === "string") {
    throw new Error("FFmpeg returned text output instead of binary media.");
  }
  const copy = new Uint8Array(output.byteLength);
  copy.set(output);
  return copy;
}

function toOwnedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

function buildConcatManifest(paths: string[]): string {
  return `ffconcat version 1.0\n${paths.map((path) => `file ${path}`).join("\n")}\n`;
}

function stripMountRoot(value: string, mountRoot: string): string {
  return value.replace(mountRoot, "").replace(/^\/+/, "");
}

function withSegmentContext(message: string, segmentIndex: number, segmentCount: number, segmentDurationSeconds: number): string {
  const segmentLine = `renderSegment=${segmentIndex + 1}/${segmentCount}, segmentDurationSeconds=${segmentDurationSeconds.toFixed(3)}`;
  const [headline, ...rest] = message.split("\n");
  return [headline, segmentLine, ...rest].filter(Boolean).join("\n");
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
  const segmentMountRoot = `${mountRoot}/segments_concat`;
  const segmentManifestPath = `${mountRoot}/segments.ffconcat`;
  const stitchedVideoPath = `${mountRoot}/timeline_stitched_video.mp4`;
  const mixedAudioPath = `${mountRoot}/timeline_mix.m4a`;
  const textEncoder = new TextEncoder();
  const availableAssets = input.resolvedAssets.filter((asset) => !asset.missing && asset.file);
  if (availableAssets.length === 0) {
    throw new Error("No project assets are available for export.");
  }

  const fileInputRefs: MountedFileInputRef[] = [];
  const ffmpegLogTail: string[] = [];
  const ffmpegLogHighlights: string[] = [];
  const renderClipCount = input.project.timeline.videoClips.length;
  const renderAudioItemCount = input.project.timeline.audioItems.length;
  const stallTimeoutMs = getFfmpegRenderStallTimeoutMs(input.resolution);
  const temporaryFiles = new Set<string>([
    outputPath,
    segmentManifestPath,
    stitchedVideoPath,
    mixedAudioPath,
  ]);

  let lastProgressPct = 0;
  let totalSubtitleFrameCount = 0;
  let currentExecDurationSeconds = 0;
  let progressTimeBaselineSeconds: number | null = null;
  let logTimeBaselineSeconds: number | null = null;
  let activityWatchdog: EditorFfmpegActivityWatchdog | null = null;
  let currentRenderProgressEmitter: (renderPct: number) => void = () => undefined;
  let segmentMountCreated = false;

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
    activityWatchdog?.markActivity();

    if (currentExecDurationSeconds > 0 && Number.isFinite(time) && time > 0) {
      const processedSeconds = normalizeProcessedSeconds(time / 1_000_000, "progress");
      if (processedSeconds > 0) {
        currentRenderProgressEmitter((processedSeconds / currentExecDurationSeconds) * 100);
        return;
      }
    }

    if (Number.isFinite(progress) && progress > 0 && progress <= 1.05) {
      currentRenderProgressEmitter(progress * 100);
    }
  };
  ff.on("progress", progressHandler);

  const logHandler = ({ message }: { message: string }) => {
    const text = String(message ?? "").trim();
    if (text) {
      activityWatchdog?.markActivity();
      ffmpegLogTail.push(text);
      if (FFMPEG_INTERESTING_LOG_PATTERN.test(text) || text === "Conversion failed!") {
        if (ffmpegLogHighlights[ffmpegLogHighlights.length - 1] !== text) {
          ffmpegLogHighlights.push(text);
          if (ffmpegLogHighlights.length > 24) ffmpegLogHighlights.shift();
        }
      }
      if (ffmpegLogTail.length > 60) ffmpegLogTail.shift();
    }
    if (currentExecDurationSeconds <= 0) return;

    const rawSeconds = parseFfmpegLogProgressSeconds(text);
    if (rawSeconds == null || rawSeconds <= 0) return;
    const processedSeconds = normalizeProcessedSeconds(rawSeconds, "log");
    if (processedSeconds <= 0) return;
    currentRenderProgressEmitter((processedSeconds / currentExecDurationSeconds) * 100);
  };
  ff.on("log", logHandler);

  const runFfmpegExecWithFallbackProgress = async (execInput: {
    args: string[];
    durationSeconds: number;
    clipCount: number;
    audioItemCount: number;
    subtitleFrameCount: number;
    onRenderProgress?: (renderPct: number) => void;
  }) => {
    const startedAt = Date.now();
    const quickRampMs = Math.max(4_000, execInput.durationSeconds * 2_500);
    const tailTauMs = Math.max(12_000, execInput.durationSeconds * 5_000);
    const quickTarget = 82;
    const fallbackCeiling = 99;

    currentExecDurationSeconds = Math.max(execInput.durationSeconds, 0.5);
    currentRenderProgressEmitter = execInput.onRenderProgress ?? emitRenderProgress;
    resetProgressTimeBaselines();

    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed <= quickRampMs) {
        const linear = clampNumber(elapsed / quickRampMs, 0, 1);
        const eased = 1 - Math.pow(1 - linear, 3);
        currentRenderProgressEmitter(quickTarget * eased);
        return;
      }

      const tailElapsed = elapsed - quickRampMs;
      const tailEased = 1 - Math.exp(-tailElapsed / tailTauMs);
      currentRenderProgressEmitter(quickTarget + (fallbackCeiling - quickTarget) * tailEased);
    }, 250);

    try {
      activityWatchdog = createEditorFfmpegActivityWatchdog({
        stallTimeoutMs,
        onStall: resetFFmpeg,
      });
      await runEditorFfmpegExec({
        ff,
        args: execInput.args,
        resolution: input.resolution,
        clipCount: execInput.clipCount,
        durationSeconds: execInput.durationSeconds,
        logTail: ffmpegLogTail,
        logHighlights: ffmpegLogHighlights,
        audioItemCount: execInput.audioItemCount,
        subtitleFrameCount: execInput.subtitleFrameCount,
        activityWatchdog,
        resetFfmpeg: resetFFmpeg,
        lifecycle: input.renderLifecycle,
      });
    } finally {
      activityWatchdog = null;
      clearInterval(timer);
    }
  };

  const readRenderedFile = async (path: string): Promise<Uint8Array> => {
    const output = await ff.readFile(path);
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    const data = copyBinaryOutput(output);
    if (data.byteLength < 1024) {
      throw new Error("Rendered output is empty.");
    }
    return data;
  };

  const renderProjectPass = async (passInput: {
    project: EditorProjectRecord;
    outputPath: string;
    mountedInputs: ResolvedExportInput[];
    onRenderProgress?: (renderPct: number) => void;
    includeAudio?: boolean;
  }): Promise<RenderPassResult> => {
    const exportPlan = buildEditorExportPlan({
      project: passInput.project,
      inputs: passInput.mountedInputs,
      resolution: input.resolution,
      includeAudio: passInput.includeAudio,
    });
    const timelineCaptions = buildProjectCaptionTimeline({
      project: passInput.project,
      assets: input.resolvedAssets.map((resolved) => resolved.asset),
      historyMap: input.historyMap,
    });
    const subtitleFrames = await renderTimelineSubtitlesToPngs({
      chunks: timelineCaptions,
      project: passInput.project,
      width: exportPlan.width,
      height: exportPlan.height,
      signal: input.renderLifecycle?.signal,
    });

    totalSubtitleFrameCount += subtitleFrames.length;

    try {
      for (const frame of subtitleFrames) {
        throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
        temporaryFiles.add(frame.vfsPath);
        await ff.writeFile(frame.vfsPath, frame.pngBytes);
      }

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
        "-filter_threads",
        "1",
        "-filter_complex",
        filterComplex,
        "-map",
        `[${finalVideoLabel}]`,
        "-max_muxing_queue_size",
        "4096",
        "-threads",
        "1",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        input.resolution === "4K" ? "24" : "22",
      ];
      if (passInput.includeAudio !== false && exportPlan.mixedAudioLabel) {
        args.push(
          "-map",
          `[${exportPlan.mixedAudioLabel}]`,
          "-c:a",
          "aac",
          "-b:a",
          "192k"
        );
      } else {
        args.push("-an");
      }
      args.push(passInput.outputPath);

      await runFfmpegExecWithFallbackProgress({
        args,
        durationSeconds: Math.max(exportPlan.durationSeconds, 0.5),
        clipCount: passInput.project.timeline.videoClips.length,
        audioItemCount: passInput.includeAudio === false ? 0 : passInput.project.timeline.audioItems.length,
        subtitleFrameCount: subtitleFrames.length,
        onRenderProgress: passInput.onRenderProgress,
      });

      return {
        warnings: exportPlan.warnings,
        ffmpegArgs: args,
      };
    } finally {
      for (const frame of subtitleFrames) {
        try {
          await ff.deleteFile(frame.vfsPath);
        } catch {}
        temporaryFiles.delete(frame.vfsPath);
      }
    }
  };

  const renderAudioMixPass = async (passInput: {
    project: EditorProjectRecord;
    outputPath: string;
    mountedInputs: ResolvedExportInput[];
    onRenderProgress?: (renderPct: number) => void;
  }): Promise<RenderPassResult> => {
    const audioPlan = buildEditorAudioExportPlan({
      project: passInput.project,
      inputs: passInput.mountedInputs,
    });
    const args = [
      ...audioPlan.ffmpegArgs,
      "-filter_threads",
      "1",
      "-filter_complex",
      audioPlan.filterComplex,
      "-map",
      `[${audioPlan.mixedAudioLabel}]`,
      "-vn",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      passInput.outputPath,
    ];

    await runFfmpegExecWithFallbackProgress({
      args,
      durationSeconds: Math.max(audioPlan.durationSeconds, 0.5),
      clipCount: passInput.project.timeline.videoClips.length,
      audioItemCount: passInput.project.timeline.audioItems.length,
      subtitleFrameCount: 0,
      onRenderProgress: passInput.onRenderProgress,
    });

    return {
      warnings: audioPlan.warnings,
      ffmpegArgs: args,
    };
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

    const availableAssetsById = new Map(availableAssets.map((asset) => [asset.asset.id, asset]));
    const mountedInputs = fileInputRefs.map((entry) => {
      const resolved = availableAssetsById.get(entry.assetId);
      if (!resolved) {
        throw new Error(`Missing resolved asset for ${entry.assetId}`);
      }
      return {
        inputIndex: entry.inputIndex,
        assetId: entry.assetId,
        path: entry.path,
        asset: resolved.asset,
      };
    });

    const fullExportPlan = buildEditorExportPlan({
      project: input.project,
      inputs: mountedInputs,
      resolution: input.resolution,
    });
    const fullRenderDurationSeconds = Math.max(fullExportPlan.durationSeconds, 0.5);
    const candidateSegments = shouldUseSegmentedBrowserRender({
      clipCount: renderClipCount,
      durationSeconds: fullRenderDurationSeconds,
    })
      ? buildSegmentedBrowserRenderSegments({ project: input.project })
      : [];
    const useSegmentedRender = candidateSegments.length > 1;

    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.preRender);
    setBrowserRenderStage(input.renderLifecycle, "rendering");

    let warnings: string[] = [];
    let ffmpegCommandPreview: string[] = [];

    if (useSegmentedRender) {
      const segmentFiles: File[] = [];
      let completedDurationSeconds = 0;

      for (const segment of candidateSegments) {
        const segmentOutputPath = `${mountRoot}/timeline_segment_${String(segment.index).padStart(3, "0")}.mp4`;
        temporaryFiles.add(segmentOutputPath);

        try {
          const pass = await renderProjectPass({
            project: segment.project,
            outputPath: segmentOutputPath,
            mountedInputs,
            includeAudio: false,
            onRenderProgress: (renderPct) => {
              const renderedSeconds =
                completedDurationSeconds + (clampNumber(renderPct, 0, 100) / 100) * segment.durationSeconds;
              emitRenderProgress(
                (renderedSeconds / fullRenderDurationSeconds) * SEGMENTED_RENDER_SEGMENT_BUDGET_PCT
              );
            },
          });

          warnings.push(...pass.warnings);
          if (ffmpegCommandPreview.length === 0) {
            ffmpegCommandPreview = [
              "ffmpeg",
              ...pass.ffmpegArgs.map((value) => stripMountRoot(value, mountRoot)),
            ];
          }

          const segmentData = await readRenderedFile(segmentOutputPath);
          segmentFiles.push(
            new File(
              [toOwnedBytes(segmentData)],
              `timeline_segment_${String(segment.index).padStart(3, "0")}.mp4`,
              { type: "video/mp4" }
            )
          );
        } catch (error) {
          if (isBrowserRenderCanceledError(error) || input.renderLifecycle?.signal?.aborted) {
            throw error;
          }

          const rawMessage = error instanceof Error ? error.message : String(error);
          if (isEditorFfmpegExecDiagnosticMessage(rawMessage)) {
            throw new Error(
              withSegmentContext(
                rawMessage,
                segment.index,
                candidateSegments.length,
                segment.durationSeconds
              )
            );
          }
          throw error instanceof Error ? error : new Error(rawMessage);
        } finally {
          try {
            await ff.deleteFile(segmentOutputPath);
          } catch {}
          temporaryFiles.delete(segmentOutputPath);
        }

        completedDurationSeconds += segment.durationSeconds;
        emitRenderProgress(
          (completedDurationSeconds / fullRenderDurationSeconds) * SEGMENTED_RENDER_SEGMENT_BUDGET_PCT
        );
      }

      await ff.createDir(segmentMountRoot);
      segmentMountCreated = true;
      await ff.mount("WORKERFS" as never, { files: segmentFiles }, segmentMountRoot);
      await ff.writeFile(
        segmentManifestPath,
        textEncoder.encode(buildConcatManifest(segmentFiles.map((file) => `${segmentMountRoot}/${file.name}`)))
      );

      const concatArgs = [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        segmentManifestPath,
        "-c:v",
        "copy",
        "-an",
        stitchedVideoPath,
      ];

      await runFfmpegExecWithFallbackProgress({
        args: concatArgs,
        durationSeconds: fullRenderDurationSeconds,
        clipCount: renderClipCount,
        audioItemCount: 0,
        subtitleFrameCount: totalSubtitleFrameCount,
        onRenderProgress: (renderPct) => {
          emitRenderProgress(
            SEGMENTED_RENDER_SEGMENT_BUDGET_PCT +
              (clampNumber(renderPct, 0, 100) / 100) * (SEGMENTED_RENDER_FINALIZE_BUDGET_PCT * 0.25)
          );
        },
      });

      const audioPass = await renderAudioMixPass({
        project: input.project,
        outputPath: mixedAudioPath,
        mountedInputs,
        onRenderProgress: (renderPct) => {
          emitRenderProgress(
            SEGMENTED_RENDER_SEGMENT_BUDGET_PCT +
              SEGMENTED_RENDER_FINALIZE_BUDGET_PCT * 0.25 +
              (clampNumber(renderPct, 0, 100) / 100) * (SEGMENTED_RENDER_FINALIZE_BUDGET_PCT * 0.45)
          );
        },
      });
      warnings.push(...audioPass.warnings);

      const muxArgs = [
        "-i",
        stitchedVideoPath,
        "-i",
        mixedAudioPath,
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        outputPath,
      ];
      await runFfmpegExecWithFallbackProgress({
        args: muxArgs,
        durationSeconds: fullRenderDurationSeconds,
        clipCount: renderClipCount,
        audioItemCount: renderAudioItemCount,
        subtitleFrameCount: totalSubtitleFrameCount,
        onRenderProgress: (renderPct) => {
          emitRenderProgress(
            SEGMENTED_RENDER_SEGMENT_BUDGET_PCT +
              SEGMENTED_RENDER_FINALIZE_BUDGET_PCT * 0.7 +
              (clampNumber(renderPct, 0, 100) / 100) * (SEGMENTED_RENDER_FINALIZE_BUDGET_PCT * 0.3)
          );
        },
      });

      ffmpegCommandPreview = [
        "ffmpeg",
        ...muxArgs.map((value) => stripMountRoot(value, mountRoot)),
      ];
    } else {
      const pass = await renderProjectPass({
        project: input.project,
        outputPath,
        mountedInputs,
      });
      warnings = pass.warnings;
      ffmpegCommandPreview = [
        "ffmpeg",
        ...pass.ffmpegArgs.map((value) => stripMountRoot(value, mountRoot)),
      ];
    }

    setBrowserRenderStage(input.renderLifecycle, "handoff");
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.readOutput);

    const data = await readRenderedFile(outputPath);
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    const { width, height } = getEditorOutputDimensions(input.project.aspectRatio, input.resolution);
    const filename = buildEditorExportFilename(input.project.name, input.project.aspectRatio, input.resolution);
    const file = new File([toOwnedBytes(data)], filename, { type: "video/mp4" });
    emitProgress(LOCAL_EDITOR_EXPORT_PROGRESS.packaged);

    return {
      file,
      width,
      height,
      warnings: dedupeStrings(warnings),
      ffmpegCommandPreview,
      notes: [
        `Timeline export via ffmpeg.wasm (${input.project.aspectRatio} @ ${input.resolution}).`,
        `${renderClipCount} video clips in ripple sequence.`,
        renderAudioItemCount
          ? `${renderAudioItemCount} audio track item${renderAudioItemCount === 1 ? "" : "s"} mixed with clip audio.`
          : "Clip audio only.",
        totalSubtitleFrameCount > 0
          ? `${totalSubtitleFrameCount} subtitle frames burned into the output.`
          : "No subtitle burn-in frames were rendered.",
        useSegmentedRender
          ? `Browser export rendered ${candidateSegments.length} video-only segments, stitched them, then mixed audio separately (up to ${BROWSER_SEGMENT_RENDER_MAX_CLIP_COUNT} clip or ${BROWSER_SEGMENT_RENDER_MAX_DURATION_SECONDS}s per segment) to reduce FFmpeg.wasm memory pressure.`
          : "Browser timeline export used a single FFmpeg.wasm render pass.",
        "Browser timeline export disables +faststart so long local renders avoid a second MP4 rewrite pass.",
        "Filtering and encoding are limited to one FFmpeg thread in browser export to reduce peak memory usage.",
        "Muxing queue size raised to 4096 packets to reduce long-timeline stream buffering failures.",
        `Render stall watchdog: ${Math.round(stallTimeoutMs / 1000)}s without FFmpeg activity before abort.`,
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
    for (const filePath of temporaryFiles) {
      try {
        await ff.deleteFile(filePath);
      } catch {}
    }
    if (segmentMountCreated) {
      try {
        await ff.unmount(segmentMountRoot);
      } catch {}
      try {
        await ff.deleteDir(segmentMountRoot);
      } catch {}
    }
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
