import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listInteractivePathPickerOptions } from "../../../src/lib/editor/node-interactive";

async function createTempDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "clipscribe-node-interactive-test-"));
}

test("bundle picker lists current-folder selection and hides node_modules", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await mkdir(path.join(tempDir, "node_modules"), { recursive: true });
  await mkdir(path.join(tempDir, "nested"), { recursive: true });
  await writeFile(path.join(tempDir, "manifest.json"), "{}", "utf8");

  const options = await listInteractivePathPickerOptions({
    prompt: "Choose bundle",
    currentDirectoryLabel: "Select this folder",
    currentDirectorySelectLabel: "Use this bundle folder",
    startDirectory: tempDir,
    isCurrentDirectorySelectable: async (directoryPath) => directoryPath === tempDir,
  });

  assert.equal(options[0]?.action.type, "select");
  assert.equal(options[0]?.action.path, tempDir);
  assert.ok(options.some((option) => option.label === "Open nested/"));
  assert.ok(options.every((option) => option.label !== "node_modules/"));
});

test("workspace picker includes project.json files as selectable entries", async (t) => {
  const tempDir = await createTempDirectory();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await mkdir(path.join(tempDir, "exports"), { recursive: true });
  await mkdir(path.join(tempDir, "demo.clipscribe-project"), { recursive: true });
  await writeFile(path.join(tempDir, "project.json"), "{}", "utf8");
  await writeFile(path.join(tempDir, "demo.clipscribe-project", "project.json"), "{}", "utf8");
  await writeFile(path.join(tempDir, "notes.txt"), "ignore", "utf8");

  const options = await listInteractivePathPickerOptions({
    prompt: "Choose workspace",
    currentDirectoryLabel: "Select this workspace folder",
    currentDirectorySelectLabel: "Use this workspace folder",
    startDirectory: tempDir,
    isCurrentDirectorySelectable: async () => true,
    isDirectorySelectable: async (absoluteDirectoryPath) =>
      path.basename(absoluteDirectoryPath) === "demo.clipscribe-project",
    directoryEntrySelectDescription: "Select workspace folder",
    isFileSelectable: async (absoluteFilePath) => path.basename(absoluteFilePath) === "project.json",
  });

  assert.equal(options[0]?.action.path, tempDir);
  assert.ok(options.some((option) => option.label === "Use demo.clipscribe-project/"));
  assert.ok(options.some((option) => option.label === "Open demo.clipscribe-project/"));
  assert.ok(options.some((option) => option.action.path === path.join(tempDir, "project.json")));
  assert.ok(options.every((option) => option.action.path !== path.join(tempDir, "notes.txt")));
});
