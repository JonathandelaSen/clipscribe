import path from "node:path";

export type NodeBinaryName = "ffmpeg" | "ffprobe";

function readOptionalPackage(packageName: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(packageName);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

export function getBundledBinaryPath(binaryName: NodeBinaryName): string | null {
  if (binaryName === "ffmpeg") {
    const packagedPath = readOptionalPackage("ffmpeg-static");
    return typeof packagedPath === "string" && packagedPath.trim() ? path.resolve(packagedPath) : null;
  }

  const packagedModule = readOptionalPackage("ffprobe-static");
  if (
    packagedModule &&
    typeof packagedModule === "object" &&
    "path" in packagedModule &&
    typeof packagedModule.path === "string" &&
    packagedModule.path.trim()
  ) {
    return path.resolve(packagedModule.path);
  }

  return null;
}

export function buildMissingBinaryMessage(binaryName: NodeBinaryName): string {
  const label = binaryName === "ffmpeg" ? "export timeline projects" : "import timeline bundles";
  return `${binaryName} is required to ${label} from the CLI. Install project dependencies with npm install or place ${binaryName} on PATH.`;
}

export function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
