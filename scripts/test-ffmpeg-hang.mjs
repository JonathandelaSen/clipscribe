import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("close", resolve);
    child.on("error", reject);
  });
}

async function testHungFfmpeg() {
  const overlayInputArgs = ["-loop", "1", "-i", "overlay.png"];
  
  // create dummy atlas png
  await run(ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=black@0.0:s=1080x3840:d=1,format=rgba", "-frames:v", "1", "overlay.png"]);

  const ffmpegArgs = [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc2=size=1080x1920:rate=30",
    ...overlayInputArgs,
    "-t", "5",
    "-filter_complex", "[1:v]crop=1080:1920:0:'between(t,1,2)*1920'[cropped];[0:v][cropped]overlay=x=0:y=0:enable='between(t,0,5)'[out]",
    "-map", "[out]",
    "output.mp4"
  ];
  
  console.log("running ffmpeg...");
  await run(ffmpegPath, ffmpegArgs);
  console.log("done!");
}

testHungFfmpeg().catch(console.error);
