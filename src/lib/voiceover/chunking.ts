/**
 * Text chunking for Gemini TTS.
 *
 * Splits long scripts into chunks that fit within the Gemini TTS text-field
 * limit (~4 000 bytes). The default target is 1 500 chars, well under the byte
 * ceiling even for multi-byte UTF-8 text.
 *
 * Splitting priority:
 *   1. Paragraph boundaries (\n\n)
 *   2. Sentence boundaries (. ? ! followed by whitespace)
 *   3. Clause boundaries (, ; — –)
 *   4. Word boundaries (last resort)
 *
 * A trailing "runt" chunk (< 10 % of maxChars) is merged into the previous
 * chunk to avoid wasting an API call on a tiny fragment.
 */

export interface TextChunk {
  /** 0-based index within the result array. */
  index: number;
  /** The chunk content. */
  text: string;
  /** text.length */
  charCount: number;
  /** Character offset in the original script where this chunk starts. */
  startOffset: number;
  /** Character offset in the original script where this chunk ends (exclusive). */
  endOffset: number;
}

export interface ChunkingResult {
  chunks: TextChunk[];
  totalChars: number;
  /** `true` when the text was split into more than one chunk. */
  needsChunking: boolean;
}

export const DEFAULT_CHUNK_MAX_CHARS = 1500;
const RUNT_THRESHOLD_RATIO = 0.1; // 10 %

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Split a string by a regex, keeping the separator at the end of each piece. */
function splitKeepingSeparator(text: string, re: RegExp): string[] {
  const pieces: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(re)) {
    const end = match.index + match[0].length;
    pieces.push(text.slice(lastIndex, end));
    lastIndex = end;
  }

  // Remainder after last match.
  if (lastIndex < text.length) {
    pieces.push(text.slice(lastIndex));
  }

  return pieces;
}

/**
 * Split a single paragraph into sentence-sized pieces.
 * Sentences end with `.` `?` or `!` followed by whitespace or EOL.
 */
function splitBySentence(text: string): string[] {
  // Match sentence-ending punctuation followed by whitespace.
  return splitKeepingSeparator(text, /[.!?]+[\s]+/g).filter(Boolean);
}

/**
 * Split a very long sentence by clause punctuation (, ; — –).
 */
function splitByClause(text: string): string[] {
  return splitKeepingSeparator(text, /[,;]\s+|[\s]+[—–]\s+/g).filter(Boolean);
}

/**
 * Hard-split a piece that still exceeds maxChars at the nearest word boundary
 * before the limit. Never cuts mid-word.
 */
function splitByWordBoundary(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let cut = maxChars;
    // Walk back to find a space.
    while (cut > 0 && remaining[cut] !== " ") {
      cut -= 1;
    }
    // If no space found in the first maxChars chars, force-cut (edge case).
    if (cut === 0) cut = maxChars;

    pieces.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }

  if (remaining.length > 0) {
    pieces.push(remaining);
  }

  return pieces;
}

/**
 * Ensure every piece in `segments` fits within `maxChars` by progressively
 * sub-splitting with finer-grained strategies.
 */
function fitSegments(segments: string[], maxChars: number): string[] {
  let pieces = segments;

  // Pass 1: split over-long segments by sentence.
  pieces = pieces.flatMap((segment) =>
    segment.length > maxChars ? splitBySentence(segment) : [segment],
  );

  // Pass 2: split remaining over-long segments by clause.
  pieces = pieces.flatMap((segment) =>
    segment.length > maxChars ? splitByClause(segment) : [segment],
  );

  // Pass 3: hard split by word boundary.
  pieces = pieces.flatMap((segment) =>
    segment.length > maxChars ? splitByWordBoundary(segment, maxChars) : [segment],
  );

  return pieces;
}

/**
 * Greedily accumulate `segments` into chunks of at most `maxChars`, joining
 * with `joiner`.
 */
function greedyAccumulate(segments: string[], maxChars: number, joiner: string): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const segment of segments) {
    if (current.length === 0) {
      current = segment;
      continue;
    }

    const joined = current + joiner + segment;
    if (joined.length <= maxChars) {
      current = joined;
    } else {
      chunks.push(current);
      current = segment;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Split `text` into chunks safe for Gemini TTS.
 *
 * @param text     The full script text.
 * @param maxChars Maximum characters per chunk (default 1 500).
 */
export function chunkScriptText(
  text: string,
  maxChars: number = DEFAULT_CHUNK_MAX_CHARS,
): ChunkingResult {
  const trimmed = text.trim();
  const totalChars = trimmed.length;

  if (totalChars === 0) {
    return { chunks: [], totalChars: 0, needsChunking: false };
  }

  if (totalChars <= maxChars) {
    return {
      chunks: [
        {
          index: 0,
          text: trimmed,
          charCount: totalChars,
          startOffset: 0,
          endOffset: totalChars,
        },
      ],
      totalChars,
      needsChunking: false,
    };
  }

  // --- Step 1: split by paragraphs (\n\n) ---
  const paragraphs = trimmed.split(/\n\n+/).filter(Boolean);

  // --- Step 2: ensure every paragraph fits (sentence → clause → word) ---
  const fittedParagraphs = fitSegments(paragraphs, maxChars);

  // --- Step 3: greedily accumulate into chunks ---
  const rawChunks = greedyAccumulate(fittedParagraphs, maxChars, "\n\n");

  // --- Step 4: merge trailing runt ---
  const runtThreshold = Math.floor(maxChars * RUNT_THRESHOLD_RATIO);
  if (
    rawChunks.length >= 2 &&
    rawChunks[rawChunks.length - 1]!.length < runtThreshold
  ) {
    const runt = rawChunks.pop()!;
    rawChunks[rawChunks.length - 1] += "\n\n" + runt;
  }

  // --- Step 5: build TextChunk objects with offsets ---
  const chunks: TextChunk[] = [];
  let offset = 0;

  for (let i = 0; i < rawChunks.length; i++) {
    const chunkText = rawChunks[i]!;
    // Find the actual position in the trimmed text. We search from the
    // current offset to handle repeated paragraphs correctly.
    const startOffset = trimmed.indexOf(chunkText.slice(0, 60), offset);
    const resolvedStart = startOffset >= 0 ? startOffset : offset;
    const endOffset = resolvedStart + chunkText.length;

    chunks.push({
      index: i,
      text: chunkText,
      charCount: chunkText.length,
      startOffset: resolvedStart,
      endOffset,
    });

    offset = endOffset;
  }

  return {
    chunks,
    totalChars,
    needsChunking: chunks.length > 1,
  };
}
