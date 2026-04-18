import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { importProjectYouTubeVideo } from "../../../src/lib/server/project-youtube-import";

function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-youtube-import-test-"));
}

test("importProjectYouTubeVideo rejects playlist URLs before invoking yt-dlp", async () => {
  await assert.rejects(
    () =>
      importProjectYouTubeVideo(
        {
          url: "https://www.youtube.com/watch?v=abc123&list=PL123",
        },
        {
          commandRunner: async () => {
            throw new Error("runner should not be called");
          },
        }
      ),
    /Playlist URLs are not supported yet/
  );
});

test("importProjectYouTubeVideo explains when yt-dlp is missing", async () => {
  await assert.rejects(
    () =>
      importProjectYouTubeVideo(
        {
          url: "https://www.youtube.com/watch?v=abc123",
        },
        {
          commandRunner: async () => {
            const error = new Error("spawn yt-dlp ENOENT") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          },
        }
      ),
    /yt-dlp is required to import YouTube videos locally/
  );
});

test("importProjectYouTubeVideo downloads, normalizes and returns MP4 metadata", async () => {
  const tempRoot = await createTempDirectory();

  const result = await importProjectYouTubeVideo(
    {
      url: "https://youtu.be/abc123",
    },
    {
      tempDirFactory: async () => tempRoot,
      commandRunner: async (_command, args) => {
        if (args.includes("--dump-single-json")) {
          return {
            code: 0,
            stdout: JSON.stringify({
              id: "abc123",
              title: "My Imported Clip",
              channel: "ClipScribe Channel",
            }),
            stderr: "",
          };
        }

        if (args.includes("--paths")) {
          const downloadDir = args[args.indexOf("--paths") + 1]!;
          await mkdir(downloadDir, { recursive: true });
          await writeFile(path.join(downloadDir, "download.webm"), "webm-bytes", "utf8");
          return {
            code: 0,
            stdout: "",
            stderr: "",
          };
        }

        const outputPath = args[args.length - 1]!;
        await writeFile(outputPath, "mp4-bytes", "utf8");
        return {
          code: 0,
          stdout: "",
          stderr: "",
        };
      },
      probeMediaFile: async () => ({
        kind: "video",
        filename: "normalized-source.mp4",
        mimeType: "video/mp4",
        sizeBytes: 9,
        durationSeconds: 12.5,
        width: 1280,
        height: 720,
        hasAudio: true,
      }),
    }
  );

  assert.equal(result.videoId, "abc123");
  assert.equal(result.title, "My Imported Clip");
  assert.equal(result.channelTitle, "ClipScribe Channel");
  assert.equal(result.filename, "My-Imported-Clip.mp4");
  assert.equal(result.mimeType, "video/mp4");
  assert.equal(result.sizeBytes, 9);
  assert.equal(result.durationSeconds, 12.5);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.equal(result.bytes.byteLength, 9);
  await assert.rejects(() => access(tempRoot));
});
