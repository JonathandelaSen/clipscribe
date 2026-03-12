import { constants as fsConstants } from "node:fs";
import type { Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import type { EditorResolution } from "./types";
import { EDITOR_PROJECT_WORKSPACE_FILENAME } from "./workspace";

export type InteractiveReadline = ReturnType<typeof createInterface>;

interface InteractiveMenuOption<T> {
  label: string;
  value: T;
  description?: string;
}

interface PathPickerAction {
  type: "navigate" | "select";
  path: string;
}

export interface InteractivePathPickerOption {
  label: string;
  action: PathPickerAction;
  description?: string;
}

interface PathPickerOptions {
  prompt: string;
  currentDirectoryLabel: string;
  startDirectory: string;
  currentDirectorySelectLabel?: string;
  isCurrentDirectorySelectable: (directoryPath: string) => Promise<boolean>;
  isDirectorySelectable?: (directoryPath: string, entry: Dirent) => Promise<boolean>;
  directoryEntrySelectDescription?: string;
  isFileSelectable?: (absoluteFilePath: string, entry: Dirent) => Promise<boolean>;
}

function comparePathNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function shouldHideEntry(entry: Dirent): boolean {
  return entry.name === "node_modules" || entry.name.startsWith(".");
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function askQuestion(rl: InteractiveReadline, prompt: string, fallback?: string): Promise<string> {
  const suffix = fallback == null || fallback === "" ? "" : ` [${fallback}]`;
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || fallback || "";
}

export async function askSelect<T>(
  rl: InteractiveReadline,
  prompt: string,
  options: Array<InteractiveMenuOption<T>>,
  fallback: T
): Promise<T> {
  const fallbackIndex = Math.max(0, options.findIndex((option) => option.value === fallback));
  if (!input.isTTY || !output.isTTY) {
    console.log(prompt);
    options.forEach((option, index) => {
      const description = option.description ? ` - ${option.description}` : "";
      console.log(`  ${index + 1}. ${option.label}${description}`);
    });
    while (true) {
      const answer = await askQuestion(rl, "Choose option number", String(fallbackIndex + 1));
      const parsed = Number(answer);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= options.length) {
        return options[parsed - 1].value;
      }
      console.log(`Choose a number between 1 and ${options.length}.`);
    }
  }

  return new Promise<T>((resolve, reject) => {
    let selectedIndex = fallbackIndex;
    let renderedLineCount = 0;
    const ttyInput = input as typeof input & { isRaw?: boolean; setRawMode?: (value: boolean) => void };
    const previousRawMode = Boolean(ttyInput.isRaw);

    const render = () => {
      const lines = [
        prompt,
        ...options.map((option, index) => {
          const pointer = index === selectedIndex ? ">" : " ";
          const description = option.description ? ` ${option.description}` : "";
          return `${pointer} ${option.label}${description}`;
        }),
        "  Use arrow keys and Enter.",
      ];

      if (renderedLineCount > 0) {
        output.write(`\x1b[${renderedLineCount}A`);
        output.write("\x1b[J");
      }

      output.write(`${lines.join("\n")}\n`);
      renderedLineCount = lines.length;
    };

    const finish = (nextValue: T) => {
      input.off("keypress", onKeypress);
      if (ttyInput.setRawMode) {
        ttyInput.setRawMode(previousRawMode);
      }
      if (renderedLineCount > 0) {
        output.write(`\x1b[${renderedLineCount}A`);
        output.write("\x1b[J");
      }
      const selectedOption = options.find((option) => option.value === nextValue);
      output.write(`${prompt}: ${selectedOption?.label ?? String(nextValue)}\n`);
      resolve(nextValue);
    };

    const cancel = () => {
      input.off("keypress", onKeypress);
      if (ttyInput.setRawMode) {
        ttyInput.setRawMode(previousRawMode);
      }
      if (renderedLineCount > 0) {
        output.write(`\x1b[${renderedLineCount}A`);
        output.write("\x1b[J");
      }
      reject(new Error("Canceled by user."));
    };

    const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cancel();
        return;
      }
      if (key.name === "up" || key.name === "k") {
        selectedIndex = selectedIndex === 0 ? options.length - 1 : selectedIndex - 1;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        selectedIndex = selectedIndex === options.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(options[selectedIndex].value);
      }
    };

    emitKeypressEvents(input);
    if (ttyInput.setRawMode) {
      ttyInput.setRawMode(true);
    }
    input.on("keypress", onKeypress);
    input.resume();
    render();
  });
}

export async function withInteractiveReadline<T>(
  callback: (rl: InteractiveReadline) => Promise<T>
): Promise<T> {
  const rl = createInterface({ input, output });
  try {
    return await callback(rl);
  } finally {
    rl.close();
  }
}

export async function listInteractivePathPickerOptions(
  options: PathPickerOptions
): Promise<InteractivePathPickerOption[]> {
  const currentDirectory = path.resolve(options.startDirectory);
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !shouldHideEntry(entry))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return comparePathNames(left.name, right.name);
    });

  const pickerOptions: InteractivePathPickerOption[] = [];
  if (await options.isCurrentDirectorySelectable(currentDirectory)) {
    pickerOptions.push({
      label: options.currentDirectorySelectLabel ?? `Use ${path.basename(currentDirectory) || currentDirectory}/`,
      description: options.currentDirectoryLabel,
      action: {
        type: "select",
        path: currentDirectory,
      },
    });
  }

  const parentDirectory = path.dirname(currentDirectory);
  if (parentDirectory !== currentDirectory) {
    pickerOptions.push({
      label: "../",
      description: "Go to parent folder",
      action: {
        type: "navigate",
        path: parentDirectory,
      },
    });
  }

  for (const entry of visibleEntries) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      if (options.isDirectorySelectable && (await options.isDirectorySelectable(absolutePath, entry))) {
        pickerOptions.push({
          label: `Use ${entry.name}/`,
          description: options.directoryEntrySelectDescription ?? "Select folder",
          action: {
            type: "select",
            path: absolutePath,
          },
        });
      }
      pickerOptions.push({
        label: `Open ${entry.name}/`,
        description: "Browse folder",
        action: {
          type: "navigate",
          path: absolutePath,
        },
      });
    }
  }

  if (options.isFileSelectable) {
    for (const entry of visibleEntries) {
      if (!entry.isFile()) continue;
      const absolutePath = path.join(currentDirectory, entry.name);
      if (!(await options.isFileSelectable(absolutePath, entry))) continue;
      pickerOptions.push({
        label: entry.name,
        description: "Use file",
        action: {
          type: "select",
          path: absolutePath,
        },
      });
    }
  }

  return pickerOptions;
}

export async function browseForPath(
  rl: InteractiveReadline,
  options: PathPickerOptions
): Promise<string> {
  let currentDirectory = path.resolve(options.startDirectory);

  while (true) {
    const pickerOptions = await listInteractivePathPickerOptions({
      ...options,
      startDirectory: currentDirectory,
    });

    if (pickerOptions.length === 0) {
      throw new Error(`No selectable files or folders were found in ${currentDirectory}.`);
    }

    const selected = await askSelect(
      rl,
      `${options.prompt}\nCurrent folder: ${currentDirectory}`,
      pickerOptions.map((option) => ({
        label: option.label,
        description: option.description,
        value: option.action,
      })),
      pickerOptions[0].action
    );

    if (selected.type === "select") {
      return selected.path;
    }

    currentDirectory = selected.path;
  }
}

export async function promptForBundlePath(
  rl: InteractiveReadline,
  startDirectory = process.cwd()
): Promise<string> {
  return browseForPath(rl, {
    prompt: "Choose a .clipscribe-project bundle to import",
    currentDirectoryLabel: "Select this folder",
    currentDirectorySelectLabel: "Use this bundle folder",
    startDirectory,
    isCurrentDirectorySelectable: async (directoryPath) =>
      isReadableFile(path.join(directoryPath, "manifest.json")),
    isDirectorySelectable: async (directoryPath) =>
      isReadableFile(path.join(directoryPath, "manifest.json")),
    directoryEntrySelectDescription: "Select bundle folder",
  });
}

export async function promptForWorkspaceProjectPath(
  rl: InteractiveReadline,
  startDirectory = process.cwd()
): Promise<string> {
  return browseForPath(rl, {
    prompt: "Choose a workspace folder or project.json to export",
    currentDirectoryLabel: "Select this workspace folder",
    currentDirectorySelectLabel: "Use this workspace folder",
    startDirectory,
    isCurrentDirectorySelectable: async (directoryPath) =>
      isReadableFile(path.join(directoryPath, EDITOR_PROJECT_WORKSPACE_FILENAME)),
    isDirectorySelectable: async (directoryPath) =>
      isReadableFile(path.join(directoryPath, EDITOR_PROJECT_WORKSPACE_FILENAME)),
    directoryEntrySelectDescription: "Select workspace folder",
    isFileSelectable: async (absoluteFilePath, entry) =>
      entry.name === EDITOR_PROJECT_WORKSPACE_FILENAME && isReadableFile(absoluteFilePath),
  });
}

export async function promptForExportResolution(
  rl: InteractiveReadline,
  fallback: EditorResolution
): Promise<EditorResolution> {
  return askSelect(
    rl,
    "Export resolution",
    [
      { label: "720p", value: "720p", description: "Faster preview export" },
      { label: "1080p", value: "1080p", description: "Best default balance" },
      { label: "4K", value: "4K", description: "Largest output size" },
    ],
    fallback
  );
}
