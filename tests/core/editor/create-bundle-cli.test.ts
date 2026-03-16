import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeCreateTimelineProjectBundleCliInput,
  parseCreateTimelineProjectBundleArgs,
  type CreateTimelineProjectBundleAudioInput,
  type CreateTimelineProjectBundleOptions,
  type CreateTimelineProjectBundleVideoInput,
} from "../../../src/lib/editor/bundle-cli";
import {
  promptCreateTimelineProjectBundleOptions,
  resolveCreateTimelineProjectBundleOptions,
} from "../../../src/lib/editor/create-bundle-cli";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-create-bundle-cli-test-"));
}

function createVideoClip(
  sourcePath: string,
  label: string,
  durationSeconds: number | null
): CreateTimelineProjectBundleVideoInput {
  return {
    sourcePath,
    label,
    trimStartSeconds: 0,
    trimEndSeconds: durationSeconds,
    reverse: false,
    volume: 1,
    muted: false,
  };
}

function createAudioItem(sourcePath: string, durationSeconds: number | null): CreateTimelineProjectBundleAudioInput {
  return {
    sourcePath,
    trimStartSeconds: 0,
    trimEndSeconds: durationSeconds,
    startOffsetSeconds: 0,
    volume: 1,
    muted: false,
  };
}

function createBundleOptions(
  overrides: Partial<CreateTimelineProjectBundleOptions> = {}
): CreateTimelineProjectBundleOptions {
  return {
    interactive: false,
    name: "CLI Demo",
    aspectRatio: "16:9",
    outputDirectory: "/repo/out",
    videoClips: [
      createVideoClip("/repo/intro.mp4", "Intro", 10),
      createVideoClip("/repo/outro.mp4", "Outro", 20),
    ],
    audioItem: undefined,
    videoCloneToFillIndex: undefined,
    videoTrimFinalToAudio: false,
    audioTrimFinalToVideo: false,
    ...overrides,
  };
}

test("resolveCreateTimelineProjectBundleOptions clones the selected video clip until video reaches audio", async () => {
  const resolved = await resolveCreateTimelineProjectBundleOptions(
    createBundleOptions({
      audioItem: createAudioItem("/repo/bed.mp3", 55),
      videoCloneToFillIndex: 2,
    })
  );

  assert.equal(resolved.videoClips.length, 4);
  assert.deepEqual(
    resolved.videoClips.map((clip) => ({ sourcePath: clip.sourcePath, trimEndSeconds: clip.trimEndSeconds })),
    [
      { sourcePath: "/repo/intro.mp4", trimEndSeconds: 10 },
      { sourcePath: "/repo/outro.mp4", trimEndSeconds: 20 },
      { sourcePath: "/repo/outro.mp4", trimEndSeconds: 20 },
      { sourcePath: "/repo/outro.mp4", trimEndSeconds: 20 },
    ]
  );
});

test("resolveCreateTimelineProjectBundleOptions trims the final video clip to match audio", async () => {
  const resolved = await resolveCreateTimelineProjectBundleOptions(
    createBundleOptions({
      audioItem: createAudioItem("/repo/bed.mp3", 25),
      videoTrimFinalToAudio: true,
    })
  );

  assert.deepEqual(
    resolved.videoClips.map((clip) => clip.trimEndSeconds),
    [10, 15]
  );
});

test("resolveCreateTimelineProjectBundleOptions trims audio to match the final video length", async () => {
  const resolved = await resolveCreateTimelineProjectBundleOptions(
    createBundleOptions({
      audioItem: createAudioItem("/repo/bed.mp3", 55),
      audioTrimFinalToVideo: true,
    })
  );

  assert.equal(resolved.audioItem?.trimEndSeconds, 30);
});

test("resolveCreateTimelineProjectBundleOptions keeps tracks unchanged when no trim is needed", async () => {
  const options = createBundleOptions({
    audioItem: createAudioItem("/repo/bed.mp3", 30),
    videoTrimFinalToAudio: true,
    audioTrimFinalToVideo: true,
  });
  const resolved = await resolveCreateTimelineProjectBundleOptions(options);

  assert.deepEqual(resolved.videoClips, options.videoClips);
  assert.deepEqual(resolved.audioItem, options.audioItem);
});

test("resolveCreateTimelineProjectBundleOptions auto-probes full-source media when fill or match needs duration", async () => {
  const probeCalls: string[] = [];
  const resolved = await resolveCreateTimelineProjectBundleOptions(
    createBundleOptions({
      videoClips: [
        createVideoClip("/repo/intro.mp4", "Intro", 10),
        createVideoClip("/repo/outro.mp4", "Outro", null),
      ],
      audioItem: createAudioItem("/repo/bed.mp3", null),
      videoCloneToFillIndex: 2,
    }),
    {
      probeMedia: async (filePath) => {
        probeCalls.push(filePath);
        if (filePath === "/repo/outro.mp4") {
          return {
            kind: "video",
            filename: "outro.mp4",
            mimeType: "video/mp4",
            sizeBytes: 10,
            durationSeconds: 20,
            width: 1920,
            height: 1080,
            hasAudio: true,
          };
        }
        return {
          kind: "audio",
          filename: "bed.mp3",
          mimeType: "audio/mpeg",
          sizeBytes: 10,
          durationSeconds: 55,
          hasAudio: true,
        };
      },
    }
  );

  assert.equal(resolved.videoClips.length, 4);
  assert.deepEqual(probeCalls, ["/repo/bed.mp3", "/repo/outro.mp4"]);
});

test("full prompting treats a folder video input as a media browser start point", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const selectedVideoPath = path.join(tempDir, "picked.mp4");
  let browserInput: { startDirectory: string; kind: "video" | "audio" } | undefined;

  const options = await promptCreateTimelineProjectBundleOptions(
    createBundleOptions({
      videoClips: [],
      audioItem: undefined,
    }),
    {
      mode: "full",
      includeOutputDirectoryPrompt: false,
      promptApi: {
        promptTextValue: async ({ message, initial }) => {
          if (message === "Video clip 1 path or folder") {
            return tempDir;
          }
          if (message === "Optional audio file or folder path (leave blank to skip)") {
            return "";
          }
          return initial ?? "Prompted";
        },
        promptConfirmValue: async ({ message, initial }) => {
          if (message === "Add another video clip?") {
            return false;
          }
          return initial;
        },
        promptNumberValue: async ({ initial }) => initial,
        promptSelectValue: async <T>({ choices, initial }: { choices: Array<{ value: T }>; initial?: T }) =>
          (initial ?? choices[0]?.value) as T,
        promptForMediaPath: async (input) => {
          browserInput = input;
          return selectedVideoPath;
        },
      },
    }
  );

  assert.deepEqual(browserInput, {
    startDirectory: tempDir,
    kind: "video",
  });
  assert.equal(options.videoClips[0]?.sourcePath, selectedVideoPath);
});

test("missing-only prompting lets audio use a folder input for browsing", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const selectedAudioPath = path.join(tempDir, "picked.mp3");
  let browserInput: { startDirectory: string; kind: "video" | "audio" } | undefined;
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--name",
    "Prompted",
    "--aspect",
    "16:9",
    "--video",
    "/repo/source.mp4",
  ]);
  const baseOptions = normalizeCreateTimelineProjectBundleCliInput({ ...parsed, interactive: true }, "/repo");

  const options = await promptCreateTimelineProjectBundleOptions(baseOptions, {
    mode: "missing-only",
    includeOutputDirectoryPrompt: false,
    parsedInput: parsed,
    promptApi: {
      promptTextValue: async ({ message, initial }) => {
        if (message === "Optional audio file or folder path (leave blank to skip)") {
          return tempDir;
        }
        return initial ?? "";
      },
      promptConfirmValue: async ({ initial }) => initial,
      promptNumberValue: async ({ initial }) => initial,
      promptSelectValue: async <T>({ choices, initial }: { choices: Array<{ value: T }>; initial?: T }) =>
        (initial ?? choices[0]?.value) as T,
      promptForMediaPath: async (input) => {
        browserInput = input;
        return selectedAudioPath;
      },
    },
  });

  assert.deepEqual(browserInput, {
    startDirectory: tempDir,
    kind: "audio",
  });
  assert.equal(options.audioItem?.sourcePath, selectedAudioPath);
});

test("missing-only prompting asks for track adjustments after audio is added", async () => {
  const messages: string[] = [];
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--name",
    "Prompted",
    "--aspect",
    "16:9",
    "--video",
    "/repo/source.mp4",
  ]);
  const baseOptions = normalizeCreateTimelineProjectBundleCliInput({ ...parsed, interactive: true }, "/repo");

  await promptCreateTimelineProjectBundleOptions(baseOptions, {
    mode: "missing-only",
    includeOutputDirectoryPrompt: false,
    parsedInput: parsed,
    promptApi: {
      promptTextValue: async ({ message, initial }) => {
        messages.push(message);
        if (message === "Optional audio file or folder path (leave blank to skip)") {
          return "/repo/bed.mp3";
        }
        return initial ?? "";
      },
      promptConfirmValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptNumberValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptSelectValue: async <T>({
        message,
        choices,
        initial,
      }: {
        message: string;
        choices: Array<{ value: T }>;
        initial?: T;
      }) => {
        messages.push(message);
        return (initial ?? choices[0]?.value) as T;
      },
    },
  });

  assert.ok(messages.indexOf("Video fill behavior") > messages.indexOf("Mute the audio track?"));
  assert.ok(messages.includes("Trim the final video clip to audio length?"));
  assert.ok(messages.includes("Trim audio to the final video length?"));
});

test("missing-only prompting skips track adjustments when no audio item is configured", async () => {
  const messages: string[] = [];
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--name",
    "Prompted",
    "--aspect",
    "16:9",
    "--video",
    "/repo/source.mp4",
  ]);
  const baseOptions = normalizeCreateTimelineProjectBundleCliInput({ ...parsed, interactive: true }, "/repo");

  await promptCreateTimelineProjectBundleOptions(baseOptions, {
    mode: "missing-only",
    includeOutputDirectoryPrompt: false,
    parsedInput: parsed,
    promptApi: {
      promptTextValue: async ({ message, initial }) => {
        messages.push(message);
        if (message === "Optional audio file or folder path (leave blank to skip)") {
          return "";
        }
        return initial ?? "";
      },
      promptConfirmValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptNumberValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptSelectValue: async <T>({
        message,
        choices,
        initial,
      }: {
        message: string;
        choices: Array<{ value: T }>;
        initial?: T;
      }) => {
        messages.push(message);
        return (initial ?? choices[0]?.value) as T;
      },
    },
  });

  assert.ok(!messages.includes("Video fill behavior"));
  assert.ok(!messages.includes("Trim the final video clip to audio length?"));
  assert.ok(!messages.includes("Trim audio to the final video length?"));
});

test("missing-only prompting does not re-ask track adjustments already supplied by flags", async () => {
  const messages: string[] = [];
  const parsed = parseCreateTimelineProjectBundleArgs([
    "--name",
    "Prompted",
    "--aspect",
    "16:9",
    "--video",
    "/repo/source.mp4",
    "--audio",
    "/repo/bed.mp3",
    "--video-clone-to-fill",
    "1",
    "--video-trim-final-to-audio",
    "--audio-trim-final-to-video",
  ]);
  const baseOptions = normalizeCreateTimelineProjectBundleCliInput({ ...parsed, interactive: true }, "/repo");

  await promptCreateTimelineProjectBundleOptions(baseOptions, {
    mode: "missing-only",
    includeOutputDirectoryPrompt: false,
    parsedInput: parsed,
    promptApi: {
      promptTextValue: async ({ message, initial }) => {
        messages.push(message);
        return initial ?? "";
      },
      promptConfirmValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptNumberValue: async ({ message, initial }) => {
        messages.push(message);
        return initial;
      },
      promptSelectValue: async <T>({
        message,
        choices,
        initial,
      }: {
        message: string;
        choices: Array<{ value: T }>;
        initial?: T;
      }) => {
        messages.push(message);
        return (initial ?? choices[0]?.value) as T;
      },
    },
  });

  assert.deepEqual(messages, []);
});
