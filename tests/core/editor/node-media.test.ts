import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeMediaFileWithFfprobe } from "../../../src/lib/editor/node-media";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-node-media-test-"));
}

test("probeMediaFileWithFfprobe falls back to the bundled binary when ffprobe is missing on PATH", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const mediaPath = path.join(tempDir, "clip.mp4");
  await writeFile(mediaPath, "video", "utf8");
  const attemptedCommands: string[] = [];

  const result = await probeMediaFileWithFfprobe(mediaPath, {
    ffprobePath: "/mock/bin/ffprobe",
    commandRunner: async (command) => {
      attemptedCommands.push(command);
      if (command === "ffprobe") {
        const error = new Error("spawn ffprobe ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: "video",
              width: 1280,
              height: 720,
              duration: "4.25",
            },
            {
              codec_type: "audio",
              duration: "4.25",
            },
          ],
          format: {
            duration: "4.25",
          },
        }),
        stderr: "",
      };
    },
  });

  assert.deepEqual(attemptedCommands, ["ffprobe", "/mock/bin/ffprobe"]);
  assert.equal(result.kind, "video");
  assert.equal(result.durationSeconds, 4.25);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.equal(result.hasAudio, true);
});

test("probeMediaFileWithFfprobe fails clearly when ffprobe is unavailable", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const mediaPath = path.join(tempDir, "clip.mp4");
  await writeFile(mediaPath, "video", "utf8");

  await assert.rejects(
    () =>
      probeMediaFileWithFfprobe(mediaPath, {
        ffprobePath: "",
        commandRunner: async () => {
          const error = new Error("spawn ffprobe ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
      }),
    /ffprobe is required to import timeline bundles/
  );
});
