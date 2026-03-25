import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function buildAssDocument() {
  const lines = [];
  for (let index = 0; index < 20; index += 1) {
    const startSeconds = index;
    const endSeconds = Math.min(20, startSeconds + 0.8);
    lines.push(
      `Dialogue: 0,0:00:${String(startSeconds).padStart(2, "0")}.00,0:00:${String(Math.floor(endSeconds)).padStart(2, "0")}.${String(Math.round((endSeconds % 1) * 100)).padStart(2, "0")},Default,,0,0,0,,{\\an5\\pos(540,1498)}Subtitle line ${index + 1}`
    );
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    "Style: Default,Inter,56,&H00FFFFFF,&H00FFFFFF,&H002A2A2A,&HAD000000,-1,0,0,0,104,100,0,0,1,3,2.2,5,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...lines,
    "",
  ].join("\n");
}

async function detectEncoder() {
  const result = await run(ffmpegPath, ["-hide_banner", "-encoders"]);
  if (result.code === 0 && /h264_videotoolbox/.test(`${result.stdout}\n${result.stderr}`)) {
    return ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-allow_sw", "1", "-prio_speed", "1"];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"];
}

async function buildOverlayPng(outputPath, input = {}) {
  const width = input.width ?? 1080;
  const height = input.height ?? 1920;
  const drawboxX = input.drawboxX ?? 120;
  const drawboxY = input.drawboxY ?? 1450;
  const drawboxWidth = input.drawboxWidth ?? 840;
  const drawboxHeight = input.drawboxHeight ?? 180;
  const opacity = input.opacity ?? 0.45;
  const result = await run(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=color=black@0.0:size=${width}x${height}:d=1`,
    "-vf",
    `format=rgba,drawbox=x=${drawboxX}:y=${drawboxY}:w=${drawboxWidth}:h=${drawboxHeight}:color=white@${opacity}:t=fill`,
    "-frames:v",
    "1",
    "-y",
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(`Failed to build overlay PNG.\n${result.stderr}`);
  }
}

async function benchmarkCase(label, args) {
  const startedAt = performance.now();
  const result = await run(ffmpegPath, args);
  const elapsedMs = performance.now() - startedAt;
  if (result.code !== 0) {
    throw new Error(`${label} failed.\n${result.stderr}`);
  }
  return {
    label,
    elapsedMs: Number(elapsedMs.toFixed(2)),
  };
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clipscribe-short-bench-"));
  try {
    const encoderArgs = await detectEncoder();
    const assPath = path.join(tempRoot, "subtitles.ass");
    const overlayPath = path.join(tempRoot, "overlay.png");
    const legacyOverlayPath = path.join(tempRoot, "legacy-intro-outro.png");
    const boundedOverlayPath = path.join(tempRoot, "bounded-intro-outro.png");
    const bareOutput = path.join(tempRoot, "bare.mp4");
    const assOutput = path.join(tempRoot, "fast-ass.mp4");
    const legacyTitleOutput = path.join(tempRoot, "legacy-intro-outro.mp4");
    const boundedTitleOutput = path.join(tempRoot, "bounded-intro-outro.mp4");
    const parityOutput = path.join(tempRoot, "png-parity.mp4");

    await mkdir(tempRoot, { recursive: true });
    await writeFile(assPath, buildAssDocument(), "utf8");
    await buildOverlayPng(overlayPath);
    await buildOverlayPng(legacyOverlayPath);
    await buildOverlayPng(boundedOverlayPath, {
      width: 760,
      height: 260,
      drawboxX: 0,
      drawboxY: 0,
      drawboxWidth: 760,
      drawboxHeight: 260,
      opacity: 0.55,
    });

    const bare = await benchmarkCase("bare_20s", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=3840x2160:rate=30",
      "-t",
      "20",
      "-vf",
      "scale=1080:1920,crop=1080:1920,format=yuv420p",
      ...encoderArgs,
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      bareOutput,
    ]);

    const fastAss = await benchmarkCase("fast_ass_20_events", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=3840x2160:rate=30",
      "-t",
      "20",
      "-vf",
      `scale=1080:1920,crop=1080:1920,format=yuv420p,ass=${assPath}`,
      ...encoderArgs,
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      assOutput,
    ]);

    const legacyIntroOutro = await benchmarkCase("legacy_fullscreen_intro_outro", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=3840x2160:rate=30",
      "-loop",
      "1",
      "-i",
      legacyOverlayPath,
      "-loop",
      "1",
      "-i",
      legacyOverlayPath,
      "-t",
      "20",
      "-filter_complex",
      "[0:v]scale=1080:1920,crop=1080:1920,format=yuv420p[base];[base][1:v]overlay=enable='between(t,0,3)'[v1];[v1][2:v]overlay=enable='between(t,17,20)'[v2]",
      "-map",
      "[v2]",
      ...encoderArgs,
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      legacyTitleOutput,
    ]);

    const boundedIntroOutro = await benchmarkCase("bounded_intro_outro", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=3840x2160:rate=30",
      "-loop",
      "1",
      "-i",
      boundedOverlayPath,
      "-loop",
      "1",
      "-i",
      boundedOverlayPath,
      "-t",
      "20",
      "-filter_complex",
      "[0:v]scale=1080:1920,crop=1080:1920,format=yuv420p[base];[base][1:v]overlay=x=160:y=320:enable='between(t,0,3)'[v1];[v1][2:v]overlay=x=160:y=1320:enable='between(t,17,20)'[v2]",
      "-map",
      "[v2]",
      ...encoderArgs,
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      boundedTitleOutput,
    ]);

    const parityArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=3840x2160:rate=30",
    ];
    for (let index = 0; index < 20; index += 1) {
      parityArgs.push("-loop", "1", "-i", overlayPath);
    }
    const filterParts = ["[0:v]scale=1080:1920,crop=1080:1920,format=yuv420p[base]"];
    let currentLabel = "base";
    for (let index = 0; index < 20; index += 1) {
      const outLabel = `overlay_${index}`;
      const start = Number(index.toFixed(3));
      const end = Number(Math.min(20, start + 0.8).toFixed(3));
      filterParts.push(
        `[${currentLabel}][${index + 1}:v]overlay=enable='between(t,${start},${end})'[${outLabel}]`
      );
      currentLabel = outLabel;
    }
    parityArgs.push(
      "-t",
      "20",
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      `[${currentLabel}]`,
      ...encoderArgs,
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      parityOutput
    );

    const pngParity = await benchmarkCase("png_parity_20_overlays", parityArgs);
    const rows = [bare, fastAss, legacyIntroOutro, boundedIntroOutro, pngParity];

    console.log("Short export benchmark results:");
    for (const row of rows) {
      console.log(`${row.label.padEnd(24)} ${row.elapsedMs.toFixed(2)}ms`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
