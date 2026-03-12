import { stderr } from "node:process";

export interface CliProgressBar {
  set(current: number, message?: string): void;
  tick(message?: string): void;
  setPercent(percent: number, message?: string): void;
  complete(message?: string): void;
  fail(message?: string): void;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return `${"=".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
}

export function createCliProgressBar(input: {
  label: string;
  total?: number;
  stream?: NodeJS.WriteStream;
}): CliProgressBar {
  const stream = input.stream ?? stderr;
  const isTTY = Boolean(stream.isTTY);
  const total = typeof input.total === "number" && input.total > 0 ? input.total : undefined;
  const barWidth = 24;
  let current = 0;
  let lastPercent = -1;
  let isFinished = false;

  const render = (percent: number, message?: string, forceNewline = false) => {
    const safePercent = Math.round(clampNumber(percent, 0, 100));
    const suffix = message ? ` ${message}` : "";

    if (!isTTY) {
      if (!forceNewline && lastPercent >= 0 && safePercent < lastPercent + 5 && safePercent < 100) return;
      stream.write(`${input.label} ${safePercent}%${suffix}\n`);
      lastPercent = safePercent;
      return;
    }

    const line = `${input.label} [${formatBar(safePercent, barWidth)}] ${String(safePercent).padStart(3, " ")}%${suffix}`;
    stream.write(`\r\x1b[2K${line}`);
    lastPercent = safePercent;
    if (forceNewline) {
      stream.write("\n");
    }
  };

  return {
    set(nextCurrent, message) {
      if (isFinished) return;
      current = total ? clampNumber(nextCurrent, 0, total) : Math.max(0, nextCurrent);
      const percent = total ? (current / total) * 100 : current;
      render(percent, message);
    },
    tick(message) {
      this.set(current + 1, message);
    },
    setPercent(percent, message) {
      if (isFinished) return;
      render(percent, message);
    },
    complete(message) {
      if (isFinished) return;
      isFinished = true;
      current = total ?? 100;
      render(100, message, true);
    },
    fail(message) {
      if (isFinished) return;
      isFinished = true;
      render(total ? (current / total) * 100 : current, message, true);
    },
  };
}
