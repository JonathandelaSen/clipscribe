import type { SubtitleChunk } from "@/lib/history";

import type { CreatorSubtitleTimingMode } from "../types";

const MAX_PAIR_GAP_SECONDS = 0.55;

function normalizeWhitespace(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{¿¡])\s+/g, "$1")
    .trim();
}

function isFiniteTimestamp(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeWordChunks(chunks: SubtitleChunk[]): SubtitleChunk[] {
  return chunks.flatMap((chunk) => {
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1];
    const text = normalizeWhitespace(String(chunk.text ?? ""));
    if (!text || !isFiniteTimestamp(start)) return [];
    const safeEnd = isFiniteTimestamp(end) && end > start ? end : start;
    return [{
      text,
      timestamp: [start, safeEnd] as [number, number],
    }];
  });
}

function hasSentenceBoundary(text: string) {
  return /[.!?…]["')\]}]*$/.test(text.trim());
}

export function buildPopCaptionChunks(
  wordChunks: SubtitleChunk[],
  mode: CreatorSubtitleTimingMode
): SubtitleChunk[] {
  if (mode === "segment") return wordChunks;

  const words = normalizeWordChunks(wordChunks);
  if (mode === "word") return words;

  const grouped: SubtitleChunk[] = [];
  let current: SubtitleChunk[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const start = current[0]?.timestamp?.[0];
    const end = current[current.length - 1]?.timestamp?.[1];
    if (!isFiniteTimestamp(start) || !isFiniteTimestamp(end) || end < start) {
      current = [];
      return;
    }
    grouped.push({
      text: normalizeWhitespace(current.map((chunk) => chunk.text).join(" ")),
      timestamp: [start, end],
    });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (!previous) {
      current.push(word);
      if (hasSentenceBoundary(word.text)) flush();
      continue;
    }

    const currentStart = word.timestamp?.[0];
    const previousEnd = previous.timestamp?.[1];
    const gapSeconds =
      isFiniteTimestamp(currentStart) && isFiniteTimestamp(previousEnd) ? currentStart - previousEnd : 0;

    if (gapSeconds > MAX_PAIR_GAP_SECONDS || hasSentenceBoundary(previous.text)) {
      flush();
    }

    current.push(word);
    if (current.length >= 2 || hasSentenceBoundary(word.text)) {
      flush();
    }
  }

  flush();
  return grouped;
}
