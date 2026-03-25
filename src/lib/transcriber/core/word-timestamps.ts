import type { SubtitleChunk } from "@/lib/history";

const MAX_SEGMENT_WORDS = 8;
const MAX_SEGMENT_DURATION_SECONDS = 3.2;
const MAX_WORD_GAP_SECONDS = 0.65;

function normalizeWhitespace(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{¿¡])\s+/g, "$1")
    .trim();
}

function hasSentenceBoundary(text: string) {
  return /[.!?…]["')\]}]*$/.test(text.trim());
}

function hasSoftBoundary(text: string) {
  return /[,;:]["')\]}]*$/.test(text.trim());
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

export function buildTranscriptChunksFromWordChunks(wordChunks: SubtitleChunk[]): SubtitleChunk[] {
  const words = normalizeWordChunks(wordChunks);
  if (words.length === 0) return [];

  const grouped: SubtitleChunk[] = [];
  let currentWords: SubtitleChunk[] = [];

  const flush = () => {
    if (currentWords.length === 0) return;
    const start = currentWords[0]?.timestamp?.[0];
    const end = currentWords[currentWords.length - 1]?.timestamp?.[1];
    if (!isFiniteTimestamp(start) || !isFiniteTimestamp(end) || end < start) {
      currentWords = [];
      return;
    }
    grouped.push({
      text: normalizeWhitespace(currentWords.map((chunk) => chunk.text).join(" ")),
      timestamp: [start, end],
    });
    currentWords = [];
  };

  for (const word of words) {
    const previous = currentWords[currentWords.length - 1];
    if (!previous) {
      currentWords.push(word);
      continue;
    }

    const currentStart = word.timestamp?.[0];
    const previousEnd = previous.timestamp?.[1];
    const segmentStart = currentWords[0]?.timestamp?.[0];
    const gapSeconds =
      isFiniteTimestamp(currentStart) && isFiniteTimestamp(previousEnd) ? currentStart - previousEnd : 0;
    const segmentDurationSeconds =
      isFiniteTimestamp(currentStart) && isFiniteTimestamp(segmentStart) ? currentStart - segmentStart : 0;

    const shouldBreak =
      gapSeconds > MAX_WORD_GAP_SECONDS ||
      currentWords.length >= MAX_SEGMENT_WORDS ||
      segmentDurationSeconds >= MAX_SEGMENT_DURATION_SECONDS ||
      hasSentenceBoundary(previous.text) ||
      (currentWords.length >= 4 && hasSoftBoundary(previous.text));

    if (shouldBreak) {
      flush();
    }

    currentWords.push(word);
  }

  flush();
  return grouped;
}
