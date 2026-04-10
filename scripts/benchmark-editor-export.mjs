import { mkdtemp, rm } from "node:fs/promises";
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

async function detectEncoderArgs() {
  const result = await run(ffmpegPath, ["-hide_banner", "-encoders"]);
  if (result.code === 0 && /h264_videotoolbox/.test(`${result.stdout}\n${result.stderr}`)) {
    return [
      {
        label: "libx264",
        args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"],
      },
      {
        label: "h264_videotoolbox",
        args: ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-allow_sw", "1", "-prio_speed", "1"],
      },
    ];
  }
  return [
    {
      label: "libx264",
      args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"],
    },
  ];
}

async function buildStillPng(outputPath) {
  const result = await run(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=color=0x1f2937:size=1920x1080:d=1",
    "-frames:v",
    "1",
    "-y",
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(`Failed to build still image.\n${result.stderr}`);
  }
}

async function buildOverlayPng(outputPath) {
  const result = await run(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=color=black@0.0:size=640x180:d=1",
    "-vf",
    "format=rgba,drawbox=x=0:y=0:w=640:h=180:color=0x22d3ee@0.55:t=fill",
    "-frames:v",
    "1",
    "-y",
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(`Failed to build overlay image.\n${result.stderr}`);
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clipscribe-editor-bench-"));
  try {
    const encoders = await detectEncoderArgs();
    const stillPath = path.join(tempRoot, "still.png");
    const overlayPath = path.join(tempRoot, "overlay.png");

    await buildStillPng(stillPath);
    await buildOverlayPng(overlayPath);

    const sharedArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      stillPath,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=20",
      "-t",
      "20",
      "-shortest",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
    ];

    const results = [];
    for (const encoder of encoders) {
      const stillOutput = path.join(tempRoot, `still-audio-${encoder.label}.mp4`);
      const overlayOutput = path.join(tempRoot, `still-audio-overlay-${encoder.label}.mp4`);
      const stillAudio = await benchmarkCase(`still_audio_20s:${encoder.label}`, [
        ...sharedArgs,
        "-vf",
        "scale=1920:1080,format=yuv420p",
        ...encoder.args,
        "-y",
        stillOutput,
      ]);

      const stillAudioOverlay = await benchmarkCase(`still_audio_overlay_20s:${encoder.label}`, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        stillPath,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=20",
        "-loop",
        "1",
        "-i",
        overlayPath,
        "-filter_complex",
        "[0:v]scale=1920:1080,format=yuv420p[img];color=c=black:s=1920x1080:d=20[base];[base][img]overlay=shortest=1[tmp];[tmp][2:v]overlay=x=640:y=830[v]",
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-t",
        "20",
        "-shortest",
        ...encoder.args,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-y",
        overlayOutput,
      ]);
      results.push(stillAudio, stillAudioOverlay);
    }

    console.log(
      JSON.stringify(
        {
          encoders: encoders.map((encoder) => encoder.label),
          results,
        },
        null,
        2
      )
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
