import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorProjectBundleFromCliOptions,
  getCreateTimelineProjectBundleHelpText,
  normalizeCliPathInput,
  normalizeCreateTimelineProjectBundleCliInput,
  parseCreateTimelineProjectBundleArgs,
} from "../../../src/lib/editor/bundle-cli";

test("CLI parsing and normalization maps repeated flags into ordered clip options", () => {
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--name",
    "Launch Cut",
    "--aspect",
    "9:16",
    "--video",
    "./media/intro.mp4",
    "--video",
    "./media/outro.mov",
    "--reverse",
    "2",
    "--video-trim",
    "1:1.5:4.25",
    "--video-volume",
    "2:0.4",
    "--video-muted",
    "1",
    "--video-clone-to-fill",
    "2",
    "--video-trim-final-to-audio",
    "--audio",
    "./audio/bed.mp3",
    "--audio-start",
    "2.5",
    "--audio-trim",
    "0.75:12",
    "--audio-volume",
    "0.65",
    "--audio-muted",
    "--audio-trim-final-to-video",
    "--output",
    "./dist",
  ]);

  const normalized = normalizeCreateTimelineProjectBundleCliInput(parsed, "/repo");

  assert.equal(normalized.name, "Launch Cut");
  assert.equal(normalized.aspectRatio, "9:16");
  assert.equal(normalized.outputDirectory, "./dist");
  assert.deepEqual(
    normalized.videoClips.map((clip) => ({
      sourcePath: clip.sourcePath,
      label: clip.label,
      trimStartSeconds: clip.trimStartSeconds,
      trimEndSeconds: clip.trimEndSeconds,
      reverse: clip.reverse,
      volume: clip.volume,
      muted: clip.muted,
    })),
    [
      {
        sourcePath: "./media/intro.mp4",
        label: "intro",
        trimStartSeconds: 1.5,
        trimEndSeconds: 4.25,
        reverse: false,
        volume: 1,
        muted: true,
      },
      {
        sourcePath: "./media/outro.mov",
        label: "outro",
        trimStartSeconds: 0,
        trimEndSeconds: null,
        reverse: true,
        volume: 0.4,
        muted: false,
      },
    ]
  );
  assert.deepEqual(normalized.audioItem, {
    sourcePath: "./audio/bed.mp3",
    trimStartSeconds: 0.75,
    trimEndSeconds: 12,
    startOffsetSeconds: 2.5,
    volume: 0.65,
    muted: true,
  });
  assert.equal(normalized.videoCloneToFillIndex, 2);
  assert.equal(normalized.videoTrimFinalToAudio, true);
  assert.equal(normalized.audioTrimFinalToVideo, true);
});

test("CLI normalization rejects clip indexes that are outside the provided video range", () => {
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--video",
    "./media/intro.mp4",
    "--video",
    "./media/outro.mov",
    "--reverse",
    "3",
  ]);

  assert.throws(
    () => normalizeCreateTimelineProjectBundleCliInput(parsed, "/repo"),
    /references video 3, but only 2 video clips were provided/
  );
});

test("CLI normalization requires audio when cloning a video clip to fill the track", () => {
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--video",
    "./media/intro.mp4",
    "--video-clone-to-fill",
    "1",
  ]);

  assert.throws(
    () => normalizeCreateTimelineProjectBundleCliInput(parsed, "/repo"),
    /--video-clone-to-fill requires --audio/
  );
});

test("CLI normalization requires at least one video path when not interactive", () => {
  const parsed = parseCreateTimelineProjectBundleArgs(["--name", "No Clips"]);

  assert.throws(
    () => normalizeCreateTimelineProjectBundleCliInput(parsed, "/repo"),
    /At least one --video path is required unless you use --interactive/
  );
});

test("CLI path normalization strips wrapping quotes and shell-escaped spaces", () => {
  assert.equal(
    normalizeCliPathInput('"/Users/jon/Documents/AI\\ engineering\\ 7/Video_Generation_From_Prompt.mp4"', "--video"),
    "/Users/jon/Documents/AI engineering 7/Video_Generation_From_Prompt.mp4"
  );
  assert.equal(
    normalizeCliPathInput("/Users/jon/Documents/My\\ Folder/Exports", "--output"),
    "/Users/jon/Documents/My Folder/Exports"
  );
});

test("create bundle help text lists the track fill and match options", () => {
  const helpText = getCreateTimelineProjectBundleHelpText();

  assert.match(helpText, /--video-clone-to-fill <i>/);
  assert.match(helpText, /--video-trim-final-to-audio/);
  assert.match(helpText, /--audio-trim-final-to-video/);
});

test("bundle builder creates stable media paths and deduplicates repeated source files", () => {
  const built = buildEditorProjectBundleFromCliOptions({
    interactive: false,
    name: "Client Cut",
    aspectRatio: "16:9",
    outputDirectory: "./out",
    videoClips: [
      {
        sourcePath: "/videos/intro clip.mp4",
        label: "Intro",
        trimStartSeconds: 0,
        trimEndSeconds: null,
        reverse: false,
        volume: 1,
        muted: false,
      },
      {
        sourcePath: "/videos/intro clip.mp4",
        label: "Intro Alt",
        trimStartSeconds: 1,
        trimEndSeconds: 4,
        reverse: true,
        volume: 0.7,
        muted: false,
      },
    ],
    audioItem: {
      sourcePath: "/audio/bed track.mp3",
      trimStartSeconds: 0,
      trimEndSeconds: null,
      startOffsetSeconds: 0,
      volume: 1,
      muted: false,
    },
  });

  assert.equal(built.bundleDirectoryName, "client-cut.clipscribe-project");
  assert.deepEqual(
    built.copyPlan,
    [
      {
        sourcePath: "/videos/intro clip.mp4",
        bundlePath: "media/asset-01-intro-clip.mp4",
      },
      {
        sourcePath: "/audio/bed track.mp3",
        bundlePath: "media/asset-02-bed-track.mp3",
      },
    ]
  );
  assert.equal(built.manifest.videoClips[0]?.path, "media/asset-01-intro-clip.mp4");
  assert.equal(built.manifest.videoClips[1]?.path, "media/asset-01-intro-clip.mp4");
  assert.equal(built.manifest.audioItem?.path, "media/asset-02-bed-track.mp3");
});
