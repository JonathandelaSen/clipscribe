import type { SubtitleChunk } from "../../../history";
import {
  secondsToClock,
  type CreatorGenerationSourceInput,
} from "../../../creator/types";

export function getRuntimeSeconds(request: CreatorGenerationSourceInput): number {
  const lastChunk = [...request.transcriptChunks].reverse().find((chunk) => {
    return typeof chunk.timestamp?.[1] === "number" || typeof chunk.timestamp?.[0] === "number";
  });
  const value = lastChunk?.timestamp?.[1] ?? lastChunk?.timestamp?.[0] ?? 0;
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

export function buildTimedTranscriptLines(chunks: SubtitleChunk[]): string {
  return chunks
    .map((chunk) => {
      const start = chunk.timestamp?.[0] == null ? "00:00" : secondsToClock(chunk.timestamp[0]);
      const end = chunk.timestamp?.[1] == null ? start : secondsToClock(chunk.timestamp[1]);
      return `[${start}-${end}] ${String(chunk.text ?? "").trim()}`;
    })
    .join("\n");
}
