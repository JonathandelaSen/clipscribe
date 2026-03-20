import {
  createBrowserRenderCanceledError,
  isBrowserRenderCanceledError,
  setBrowserRenderStage,
  throwIfBrowserRenderCanceled,
  type BrowserRenderLifecycle,
} from "@/lib/browser-render";
import { getFFmpeg } from "@/lib/ffmpeg";
import { assertExportGeometryInvariants } from "@/lib/creator/core/export-contracts";
import { buildShortExportGeometry } from "@/lib/creator/core/export-geometry";
import {
  resolveCreatorSubtitleStyle,
} from "@/lib/creator/subtitle-style";
import { renderSubtitlesToPngs } from "@/lib/creator/subtitle-canvas";
import type {
  CreatorShortEditorState,
  CreatorShortPlan,
  CreatorViralClip,
} from "@/lib/creator/types";
import type { SubtitleChunk } from "@/lib/history";


const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const FAST_SEEK_CUSHION_SECONDS = 3;
const LOCAL_EXPORT_PROGRESS = {
  init: 1,
  mounted: 4,
  preRender: 8,
  renderMax: 92,
  readOutput: 94,
  validateOutput: 95,
  packaged: 96,
} as const;

function clamp(value: number, min: number, max: number): number {
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



export interface LocalShortExportInput {
  sourceFile: File;
  sourceFilename: string;
  clip: CreatorViralClip;
  plan: CreatorShortPlan;
  subtitleChunks: SubtitleChunk[];
  editor: CreatorShortEditorState;
  sourceVideoSize: { width: number; height: number };
  previewViewport?: { width: number; height: number } | null;
  previewVideoRect?: { width: number; height: number } | null;
  onProgress?: (progressPct: number) => void;
  renderLifecycle?: BrowserRenderLifecycle;
}

export interface LocalShortExportResult {
  file: File;
  ffmpegCommandPreview: string[];
  notes: string[];
  subtitleBurnedIn: boolean;
}

export async function exportShortVideoLocally(input: LocalShortExportInput): Promise<LocalShortExportResult> {
  setBrowserRenderStage(input.renderLifecycle, "preparing");
  const ff = await getFFmpeg();
  throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
  const mountDir = `/render_${Date.now()}`;
  const outputFilename = sanitizeFilename(
    `${input.sourceFilename.replace(/\.[^/.]+$/, "")}__${input.plan.platform}__${Math.floor(input.clip.startSeconds)}-${Math.ceil(
      input.clip.endSeconds
    )}.mp4`
  );
  const outputPath = `out_${Date.now()}.mp4`;

  const preview = buildShortExportGeometry({
    sourceWidth: input.sourceVideoSize.width,
    sourceHeight: input.sourceVideoSize.height,
    editor: input.editor,
    previewViewport: input.previewViewport ?? null,
    previewVideoRect: input.previewVideoRect ?? null,
    outputWidth: OUTPUT_WIDTH,
    outputHeight: OUTPUT_HEIGHT,
  });
  const geometryContract = assertExportGeometryInvariants(
    {
      sourceWidth: input.sourceVideoSize.width,
      sourceHeight: input.sourceVideoSize.height,
      geometry: preview,
      expectedOutputWidth: OUTPUT_WIDTH,
      expectedOutputHeight: OUTPUT_HEIGHT,
    },
    { contextLabel: "local-export" }
  );

  const clipDuration = Math.max(0.5, input.clip.endSeconds - input.clip.startSeconds);
  const inputSeekSeconds = Math.max(0, input.clip.startSeconds - FAST_SEEK_CUSHION_SECONDS);
  const exactTrimAfterSeekSeconds = Math.max(0, input.clip.startSeconds - inputSeekSeconds);


  let lastProgressPct = 0;
  const emitProgress = (pct: number) => {
    const next = Math.round(clamp(pct, 0, 100));
    if (next <= lastProgressPct) return;
    lastProgressPct = next;
    input.onProgress?.(lastProgressPct);
  };

  const emitRenderProgress = (renderPct: number) => {
    const safe = clamp(renderPct, 0, 100);
    const span = LOCAL_EXPORT_PROGRESS.renderMax - LOCAL_EXPORT_PROGRESS.preRender;
    const mapped = LOCAL_EXPORT_PROGRESS.preRender + (safe / 100) * span;
    emitProgress(mapped);
  };

  let progressTimeBaselineSeconds: number | null = null;
  let logTimeBaselineSeconds: number | null = null;
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

  const runFfmpegExecWithFallbackProgress = async (args: string[]) => {
    const startPct = Math.max(lastProgressPct, LOCAL_EXPORT_PROGRESS.preRender);
    const startedAt = Date.now();
    const quickRampMs = Math.max(4_000, clipDuration * 2_500);
    const tailTauMs = Math.max(12_000, clipDuration * 5_000);
    const quickTarget = 82;
    const fallbackCeiling = LOCAL_EXPORT_PROGRESS.renderMax - 1;

    resetProgressTimeBaselines();

    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed <= quickRampMs) {
        const linear = clamp(elapsed / quickRampMs, 0, 1);
        const eased = 1 - Math.pow(1 - linear, 3);
        emitProgress(startPct + (quickTarget - startPct) * eased);
        return;
      }

      const tailElapsed = elapsed - quickRampMs;
      const tailEased = 1 - Math.exp(-tailElapsed / tailTauMs);
      emitProgress(quickTarget + (fallbackCeiling - quickTarget) * tailEased);
    }, 250);

    try {
      await ff.exec(args, -1, { signal: input.renderLifecycle?.signal });
    } finally {
      clearInterval(timer);
    }
  };

  const progressHandler = ({ progress, time }: { progress: number; time: number }) => {
    // ffmpeg.wasm progress can be unreliable with input-seeking.
    // Prefer elapsed output time and map it only inside render-stage progress.
    if (Number.isFinite(time) && time > 0) {
      const processedSeconds = normalizeProcessedSeconds(time / 1_000_000, "progress");
      if (processedSeconds > 0) {
        emitRenderProgress((processedSeconds / clipDuration) * 100);
        return;
      }
    }
    if (Number.isFinite(progress) && progress > 0 && progress <= 1.05) {
      emitRenderProgress(progress * 100);
    }
  };
  ff.on("progress", progressHandler);

  const ffmpegLogTail: string[] = [];
  const logHandler = ({ message }: { message: string }) => {
    const text = String(message ?? "").trim();
    if (text) {
      ffmpegLogTail.push(text);
      if (ffmpegLogTail.length > 40) ffmpegLogTail.shift();
    }
    const rawSeconds = parseFfmpegLogProgressSeconds(String(message ?? ""));
    if (rawSeconds == null || rawSeconds <= 0) return;
    const processedSeconds = normalizeProcessedSeconds(rawSeconds, "log");
    if (processedSeconds <= 0) return;
    emitRenderProgress((processedSeconds / clipDuration) * 100);
  };
  ff.on("log", logHandler);

  // Build the video filter chain: scale/pad/crop + optional drawtext subtitle filters
  const baseFilter = preview.filter;

  const buildFfmpegArgs = (
    filter: string,
    seekMode: "hybrid" | "exact",
    extraInputPaths: string[] = []
  ): string[] => {
    const preInputSeek = seekMode === "hybrid" ? ["-ss", String(inputSeekSeconds)] : [];
    const postInputSeekSeconds = seekMode === "hybrid" ? exactTrimAfterSeekSeconds : input.clip.startSeconds;
    // Extra PNG overlay inputs: each needs -loop 1 -i <path>
    const extraInputArgs = extraInputPaths.flatMap((p) => ["-loop", "1", "-i", p]);
    // When we have overlay inputs, we must use -filter_complex instead of -vf
    const filterArgs = extraInputPaths.length > 0
      ? ["-filter_complex", filter, "-map", `[vout]`, "-map", "0:a?"]
      : ["-vf", filter];
    return [
      ...preInputSeek,
      "-i",
      `${mountDir}/${input.sourceFile.name}`,
      ...extraInputArgs,
      "-ss",
      String(postInputSeekSeconds),
      "-t",
      String(clipDuration),
      ...filterArgs,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ];
  };


  const renderWithSeekFallback = async (
    filter: string,
    extraInputPaths: string[] = []
  ): Promise<"hybrid" | "exact"> => {
    try {
      emitProgress(LOCAL_EXPORT_PROGRESS.preRender);
      setBrowserRenderStage(input.renderLifecycle, "rendering");
      await runFfmpegExecWithFallbackProgress(buildFfmpegArgs(filter, "hybrid", extraInputPaths));
      return "hybrid";
    } catch (hybridError) {
      if (isBrowserRenderCanceledError(hybridError) || input.renderLifecycle?.signal?.aborted) {
        throw createBrowserRenderCanceledError();
      }
      console.warn("Hybrid-seek render failed, retrying with exact-seek mode:", hybridError);
      try {
        await ff.deleteFile(outputPath);
      } catch {}
      emitProgress(LOCAL_EXPORT_PROGRESS.preRender);
      await runFfmpegExecWithFallbackProgress(buildFfmpegArgs(filter, "exact", extraInputPaths));
      return "exact";
    }
  };

  let usedSubtitleBurnIn = false;
  let usedSeekMode: "hybrid" | "exact" = "hybrid";

  try {
    emitProgress(LOCAL_EXPORT_PROGRESS.init);
    await ff.createDir(mountDir);
    await ff.mount("WORKERFS" as never, { files: [input.sourceFile] }, mountDir);
    emitProgress(LOCAL_EXPORT_PROGRESS.mounted);

    // Attempt subtitle burn-in using Canvas PNG overlays (pixel-identical to preview)
    const subtitleFrames = await renderSubtitlesToPngs(
      input.subtitleChunks ?? [],
      input.clip,
      input.plan,
      input.editor,
      exactTrimAfterSeekSeconds,
      input.renderLifecycle?.signal
    );

    if (subtitleFrames.length > 0) {
      emitProgress(6);
      // Write each PNG to the VFS
      for (const frame of subtitleFrames) {
        throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
        await ff.writeFile(frame.vfsPath, frame.pngBytes);
      }

      // Build -filter_complex overlay chain:
      //   [0:v] → baseFilter → [base]
      //   [base][1:v] → overlay(enable=between(t,s,e)) → [v0]
      //   [v0][2:v]   → overlay(enable=between(t,s,e)) → [v1]
      //   ...         → [vout]
      const filterParts: string[] = [`[0:v]${baseFilter}[base]`];
      subtitleFrames.forEach((frame, i) => {
        const inLabel  = i === 0 ? "base" : `v${i - 1}`;
        const outLabel = i === subtitleFrames.length - 1 ? "vout" : `v${i}`;
        filterParts.push(
          `[${inLabel}][${i + 1}:v]overlay=enable='between(t,${frame.start.toFixed(3)},${frame.end.toFixed(3)})'[${outLabel}]`
        );
      });
      const overlayFilter = filterParts.join(";");
      const pngPaths = subtitleFrames.map((f) => f.vfsPath);

      try {
        usedSeekMode = await renderWithSeekFallback(overlayFilter, pngPaths);
        usedSubtitleBurnIn = true;
      } catch (err) {
        if (isBrowserRenderCanceledError(err) || input.renderLifecycle?.signal?.aborted) {
          throw createBrowserRenderCanceledError();
        }
        console.warn("PNG overlay subtitle burn-in failed, retrying export without subtitles:", err);
        try { await ff.deleteFile(outputPath); } catch {}
        // Clean up PNGs and fall back to plain render
        for (const frame of subtitleFrames) {
          try { await ff.deleteFile(frame.vfsPath); } catch {}
        }
        usedSeekMode = await renderWithSeekFallback(baseFilter);
      }
    } else {
      usedSeekMode = await renderWithSeekFallback(baseFilter);
    }

    setBrowserRenderStage(input.renderLifecycle, "handoff");
    emitProgress(LOCAL_EXPORT_PROGRESS.readOutput);
    const output = await ff.readFile(outputPath);
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    if (typeof output === "string") {
      throw new Error("FFmpeg returned text output instead of binary video data");
    }
    const data = output instanceof Uint8Array ? new Uint8Array(output) : new Uint8Array(output as Uint8Array);
    if (data.byteLength < 1024) {
      throw new Error("Rendered output is empty. Clip timing may be outside the source video range.");
    }
    emitProgress(LOCAL_EXPORT_PROGRESS.validateOutput);
    throwIfBrowserRenderCanceled(input.renderLifecycle?.signal);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const file = new File([arrayBuffer], outputFilename, { type: "video/mp4" });
    emitProgress(LOCAL_EXPORT_PROGRESS.packaged);

    const ffmpegCommandPreview =
      usedSeekMode === "hybrid"
        ? [
            "ffmpeg",
            "-ss",
            String(inputSeekSeconds),
            "-i",
            input.sourceFilename,
            "-ss",
            String(exactTrimAfterSeekSeconds),
            "-t",
            String(clipDuration),
            "-vf",
            usedSubtitleBurnIn ? `${baseFilter},...drawtext` : baseFilter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            outputFilename,
          ]
        : [
            "ffmpeg",
            "-i",
            input.sourceFilename,
            "-ss",
            String(input.clip.startSeconds),
            "-t",
            String(clipDuration),
            "-vf",
            usedSubtitleBurnIn ? `${baseFilter},...drawtext` : baseFilter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            outputFilename,
          ];

    const effectiveSubtitleStyle = resolveCreatorSubtitleStyle(input.plan.editorPreset.subtitleStyle, input.editor.subtitleStyle);

    const notes = [
      `Local browser render via ffmpeg.wasm (${input.plan.platform})`,
      `Geometry contract checks passed (scaleDelta=${geometryContract.metrics.scaleDeltaPct.toFixed(4)}%, aspectDelta=${geometryContract.metrics.aspectRatioDeltaPct.toFixed(4)}%).`,
      usedSeekMode === "hybrid"
        ? inputSeekSeconds > 0
          ? `Hybrid trim seek enabled: fast pre-seek ${inputSeekSeconds.toFixed(2)}s, exact post-seek ${exactTrimAfterSeekSeconds.toFixed(2)}s.`
          : `Exact trim seek from start: ${exactTrimAfterSeekSeconds.toFixed(2)}s.`
        : `Fallback exact-seek mode used from ${input.clip.startSeconds.toFixed(2)}s for container compatibility.`,
      preview.canvasWidth !== preview.scaledWidth || preview.canvasHeight !== preview.scaledHeight
        ? `Zoom-out/pad mode. Scaled frame ${preview.scaledWidth}x${preview.scaledHeight}, padded canvas ${preview.canvasWidth}x${preview.canvasHeight} @ (${preview.padX}, ${preview.padY}), crop @ (${preview.cropX}, ${preview.cropY}).`
        : `Crop based on zoom/pan. Scaled frame ${preview.scaledWidth}x${preview.scaledHeight}, crop @ (${preview.cropX}, ${preview.cropY}).`,
      input.previewVideoRect
        ? `Preview parity source: video rect ${Math.round(input.previewVideoRect.width)}x${Math.round(input.previewVideoRect.height)} inside viewport ${Math.round(
            input.previewViewport?.width ?? 0
          )}x${Math.round(input.previewViewport?.height ?? 0)}.`
        : "Preview parity source: computed from source dimensions + editor zoom.",
      input.editor.showSubtitles === false
        ? "Rendered without burned subtitles (disabled in the editor)."
        : usedSubtitleBurnIn
        ? `Subtitles burned in at x=${input.editor.subtitleXPositionPct.toFixed(0)}%, y=${input.editor.subtitleYOffsetPct.toFixed(0)}% using ${effectiveSubtitleStyle.preset}.`
        : "Rendered without burned subtitles (subtitle filter unavailable or no subtitle chunks).",
      "Export uses a single outline/shadow pass with subtle fill spreads so wider letters do not duplicate borders.",
      `Letter width scale ${effectiveSubtitleStyle.letterWidth.toFixed(2)}x.`,
      `Subtitle styling uses text border ${effectiveSubtitleStyle.borderWidth.toFixed(1)}px plus shadow ${effectiveSubtitleStyle.shadowDistance.toFixed(1)}px.`,
      effectiveSubtitleStyle.backgroundEnabled
        ? `Subtitle background enabled with ${Math.round(effectiveSubtitleStyle.backgroundOpacity * 100)}% opacity, ${effectiveSubtitleStyle.backgroundRadius.toFixed(0)}px radius, and ${effectiveSubtitleStyle.backgroundPaddingX.toFixed(0)}x${effectiveSubtitleStyle.backgroundPaddingY.toFixed(0)}px padding.`
        : "Subtitle background disabled.",
    ];

    return {
      file,
      ffmpegCommandPreview,
      notes,
      subtitleBurnedIn: usedSubtitleBurnIn,
    };
  } catch (error) {
    if (isBrowserRenderCanceledError(error) || input.renderLifecycle?.signal?.aborted) {
      throw createBrowserRenderCanceledError();
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    const diagnostics = [
      `clip=${input.clip.startSeconds.toFixed(3)}-${input.clip.endSeconds.toFixed(3)} (${clipDuration.toFixed(3)}s)`,
      `seekMode=${usedSeekMode}`,
      `subtitleBurnIn=${usedSubtitleBurnIn}`,
      `subtitleChunks=${input.subtitleChunks?.length ?? 0}`,
      `source=${input.sourceFilename}`,
    ].join(", ");
    const logTail = ffmpegLogTail.slice(-8).join("\n");
    const detail = logTail ? `${diagnostics}\nffmpeg-log-tail:\n${logTail}` : diagnostics;
    throw new Error(`${rawMessage}\n${detail}`);
  } finally {
    try {
      await ff.deleteFile(outputPath);
    } catch {}
    try {
      await ff.unmount(mountDir);
      await ff.deleteDir(mountDir);
    } catch {}
    ff.off("progress", progressHandler);
    ff.off("log", logHandler);
  }
}
