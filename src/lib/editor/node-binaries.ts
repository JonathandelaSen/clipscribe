import { accessSync, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

export type NodeBinaryName = "ffmpeg" | "ffprobe";

function isUsableBinaryPath(candidatePath: string | null | undefined): candidatePath is string {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    return false;
  }

  try {
    accessSync(candidatePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getFirstUsableBinaryPath(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (isUsableBinaryPath(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function readOptionalFfmpegStaticPackage(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packagedPath = require("ffmpeg-static") as unknown;
    return typeof packagedPath === "string" && packagedPath.trim() ? packagedPath : null;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

function readOptionalFfprobeStaticPackage():
  | {
      path: string;
    }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packagedModule = require("ffprobe-static") as unknown;
    if (
      packagedModule &&
      typeof packagedModule === "object" &&
      "path" in packagedModule &&
      typeof packagedModule.path === "string" &&
      packagedModule.path.trim()
    ) {
      return {
        path: packagedModule.path,
      };
    }
    return null;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

function getBundledFfmpegBinaryPath() {
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return getFirstUsableBinaryPath([
    process.env.FFMPEG_BIN,
    readOptionalFfmpegStaticPackage(),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", executableName),
  ]);
}

function getBundledFfprobeBinaryPath() {
  const executableName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return getFirstUsableBinaryPath([
    readOptionalFfprobeStaticPackage()?.path,
    path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", os.platform(), os.arch(), executableName),
  ]);
}

export function getBundledBinaryPath(binaryName: NodeBinaryName): string | null {
  if (binaryName === "ffmpeg") {
    return getBundledFfmpegBinaryPath();
  }

  return getBundledFfprobeBinaryPath();
}

export function buildMissingBinaryMessage(binaryName: NodeBinaryName): string {
  const label = binaryName === "ffmpeg" ? "export timeline projects" : "import timeline bundles";
  return `${binaryName} is required to ${label} from the CLI. Install project dependencies with npm install or place ${binaryName} on PATH.`;
}

export function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
