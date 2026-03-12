import { constants as fsConstants } from "node:fs";
import type { Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

import prompts, { type Choice } from "prompts";

import type { EditorResolution } from "./types";

const EDITOR_PROJECT_WORKSPACE_FILENAME = "project.json";

interface InteractiveMenuOption<T> {
  title: string;
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

function throwCanceled(): never {
  throw new Error("Canceled by user.");
}

function getSelectInitialIndex<T>(options: readonly InteractiveMenuOption<T>[], fallback?: T): number | undefined {
  if (fallback === undefined) return undefined;
  const index = options.findIndex((option) => Object.is(option.value, fallback));
  return index >= 0 ? index : undefined;
}

function createPromptOptions() {
  return {
    onCancel: () => throwCanceled(),
  };
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function promptTextValue(input: {
  message: string;
  initial?: string;
  validate?: (value: string) => true | string;
}): Promise<string> {
  const result = await prompts(
    {
      type: "text",
      name: "value",
      message: input.message,
      initial: input.initial,
      validate: input.validate,
    },
    createPromptOptions()
  );

  return typeof result.value === "string" ? result.value : input.initial ?? "";
}

export async function promptConfirmValue(input: {
  message: string;
  initial: boolean;
}): Promise<boolean> {
  const result = await prompts(
    {
      type: "confirm",
      name: "value",
      message: input.message,
      initial: input.initial,
    },
    createPromptOptions()
  );

  return typeof result.value === "boolean" ? result.value : input.initial;
}

export async function promptSelectValue<T>(input: {
  message: string;
  choices: Array<InteractiveMenuOption<T>>;
  initial?: T;
}): Promise<T> {
  const promptChoices: Choice[] = input.choices.map((choice) => ({
    title: choice.title,
    value: choice.value,
    description: choice.description,
  }));

  const result = await prompts(
    {
      type: "select",
      name: "value",
      message: input.message,
      choices: promptChoices,
      initial: getSelectInitialIndex(input.choices, input.initial),
    },
    createPromptOptions()
  );

  if (!("value" in result)) {
    throwCanceled();
  }
  return result.value as T;
}

export function validatePromptNumberValue(
  value: number | "" | null | undefined,
  input: {
    initial: number;
    min?: number;
    max?: number;
    integer?: boolean;
  }
): true | string {
  // prompts validates the placeholder as "" until the user types, even when Enter will later
  // resolve to the numeric initial value.
  if (value === "" || value == null) {
    return true;
  }
  if (!Number.isFinite(value)) return "Enter a valid number.";
  if (typeof input.min === "number" && value < input.min) {
    return `Enter a number greater than or equal to ${input.min}.`;
  }
  if (typeof input.max === "number" && value > input.max) {
    return `Enter a number less than or equal to ${input.max}.`;
  }
  if (input.integer && !Number.isInteger(value)) {
    return "Enter a whole number.";
  }
  return true;
}

export async function promptNumberValue(input: {
  message: string;
  initial: number;
  min?: number;
  max?: number;
  integer?: boolean;
}): Promise<number> {
  const result = await prompts(
    {
      type: "number",
      name: "value",
      message: input.message,
      initial: input.initial,
      min: input.min,
      max: input.max,
      float: !input.integer,
      validate: (value) => validatePromptNumberValue(value, input),
    },
    createPromptOptions()
  );

  return typeof result.value === "number" ? result.value : input.initial;
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

export async function browseForPath(options: PathPickerOptions): Promise<string> {
  let currentDirectory = path.resolve(options.startDirectory);

  while (true) {
    const pickerOptions = await listInteractivePathPickerOptions({
      ...options,
      startDirectory: currentDirectory,
    });

    if (pickerOptions.length === 0) {
      throw new Error(`No selectable files or folders were found in ${currentDirectory}.`);
    }

    const selected = await promptSelectValue<PathPickerAction>({
      message: `${options.prompt}\nCurrent folder: ${currentDirectory}`,
      choices: pickerOptions.map((option) => ({
        title: option.label,
        description: option.description,
        value: option.action,
      })),
      initial: pickerOptions[0]?.action,
    });

    if (selected.type === "select") {
      return selected.path;
    }

    currentDirectory = selected.path;
  }
}

export async function promptForBundlePath(startDirectory = process.cwd()): Promise<string> {
  return browseForPath({
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

export async function promptForWorkspaceProjectPath(startDirectory = process.cwd()): Promise<string> {
  return browseForPath({
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

export async function promptForExportResolution(fallback: EditorResolution): Promise<EditorResolution> {
  return promptSelectValue<EditorResolution>({
    message: "Export resolution",
    choices: [
      { title: "720p", value: "720p", description: "Faster preview export" },
      { title: "1080p", value: "1080p", description: "Best default balance" },
      { title: "4K", value: "4K", description: "Largest output size" },
    ],
    initial: fallback,
  });
}
