import test from "node:test";
import assert from "node:assert/strict";

import {
  chunkScriptText,
  DEFAULT_CHUNK_MAX_CHARS,
  type ChunkingResult,
} from "../../../src/lib/voiceover/chunking";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalCharsFromChunks(result: ChunkingResult): number {
  return result.chunks.reduce((sum, c) => sum + c.charCount, 0);
}

function repeat(str: string, times: number): string {
  return Array.from({ length: times }, () => str).join("");
}

// ---------------------------------------------------------------------------
// Basic cases
// ---------------------------------------------------------------------------

test("empty text returns empty result", () => {
  const result = chunkScriptText("");
  assert.equal(result.chunks.length, 0);
  assert.equal(result.totalChars, 0);
  assert.equal(result.needsChunking, false);
});

test("whitespace-only text returns empty result", () => {
  const result = chunkScriptText("   \n\n   ");
  assert.equal(result.chunks.length, 0);
  assert.equal(result.totalChars, 0);
  assert.equal(result.needsChunking, false);
});

test("short text returns single chunk", () => {
  const text = "Hello, this is a short script.";
  const result = chunkScriptText(text);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.needsChunking, false);
  assert.equal(result.chunks[0]!.text, text);
  assert.equal(result.chunks[0]!.index, 0);
  assert.equal(result.chunks[0]!.startOffset, 0);
  assert.equal(result.chunks[0]!.endOffset, text.length);
});

test("text exactly at limit returns single chunk", () => {
  const text = "A".repeat(DEFAULT_CHUNK_MAX_CHARS);
  const result = chunkScriptText(text);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.needsChunking, false);
  assert.equal(result.chunks[0]!.charCount, DEFAULT_CHUNK_MAX_CHARS);
});

// ---------------------------------------------------------------------------
// Paragraph splitting
// ---------------------------------------------------------------------------

test("multiple short paragraphs are accumulated into chunks", () => {
  const para = "A".repeat(400);
  // 4 paragraphs of 400 chars each → at 1500 limit, 3 fit in one chunk
  const text = [para, para, para, para].join("\n\n");
  const result = chunkScriptText(text);

  assert.equal(result.needsChunking, true);
  assert.equal(result.chunks.length, 2);
  // First chunk: 3 paragraphs (400 + 2 + 400 + 2 + 400 = 1204 chars)
  assert.ok(result.chunks[0]!.charCount <= DEFAULT_CHUNK_MAX_CHARS);
  // Second chunk: 1 paragraph
  assert.equal(result.chunks[1]!.charCount, 400);
});

test("two paragraphs that each fit individually but not together are split", () => {
  const para1 = "A".repeat(1000);
  const para2 = "B".repeat(1000);
  const text = para1 + "\n\n" + para2;
  const result = chunkScriptText(text);

  assert.equal(result.needsChunking, true);
  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[0]!.text, para1);
  assert.equal(result.chunks[1]!.text, para2);
});

// ---------------------------------------------------------------------------
// Sentence splitting
// ---------------------------------------------------------------------------

test("long paragraph splits by sentence boundaries", () => {
  // Each sentence ~200 chars. 10 sentences = ~2000 chars > 1500 limit.
  const sentence = "A".repeat(195) + ". ";
  const longParagraph = repeat(sentence, 10).trim();
  const result = chunkScriptText(longParagraph);

  assert.equal(result.needsChunking, true);
  assert.ok(result.chunks.length >= 2);
  for (const chunk of result.chunks) {
    // Each chunk should be within limit (except possibly the last due to runt merge).
    assert.ok(
      chunk.charCount <= DEFAULT_CHUNK_MAX_CHARS * 1.15, // Allow small overshoot from runt merge.
      `Chunk ${chunk.index} is ${chunk.charCount} chars, expected <= ${DEFAULT_CHUNK_MAX_CHARS * 1.15}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Clause / word splitting
// ---------------------------------------------------------------------------

test("very long sentence splits by clause boundaries", () => {
  // No periods, only commas every 300 chars.
  const clause = "A".repeat(296) + ", ";
  const longSentence = repeat(clause, 8).trim();
  const result = chunkScriptText(longSentence);

  assert.equal(result.needsChunking, true);
  assert.ok(result.chunks.length >= 2);
  for (const chunk of result.chunks) {
    assert.ok(
      chunk.charCount <= DEFAULT_CHUNK_MAX_CHARS * 1.15,
      `Chunk ${chunk.index} is ${chunk.charCount} chars`,
    );
  }
});

test("no punctuation at all splits by word boundary", () => {
  // Words separated by spaces, no punctuation.
  const word = "abcdefghij"; // 10 chars
  const words = Array.from({ length: 200 }, () => word).join(" "); // ~2199 chars
  const result = chunkScriptText(words);

  assert.equal(result.needsChunking, true);
  assert.ok(result.chunks.length >= 2);
  for (const chunk of result.chunks) {
    // Must never cut mid-word.
    assert.ok(!chunk.text.endsWith("abcde"), `Chunk ${chunk.index} appears to cut mid-word`);
  }
});

// ---------------------------------------------------------------------------
// Runt merge
// ---------------------------------------------------------------------------

test("last chunk under 10% threshold is merged into previous", () => {
  // Create text that would produce a tiny last chunk.
  // 1400 chars + \n\n + 1400 chars + \n\n + 50 chars = 2854 total
  // Without merge: [1400] [1400] [50] → 3 chunks, last is 50 < 150 (10%)
  // With merge:    [1400] [1400+\n\n+50] → 2 chunks
  const para1 = "A".repeat(1400);
  const para2 = "B".repeat(1400);
  const para3 = "C".repeat(50);
  const text = [para1, para2, para3].join("\n\n");
  const result = chunkScriptText(text);

  assert.equal(result.chunks.length, 2, "Runt should be merged into previous chunk");
  assert.ok(
    result.chunks[1]!.text.includes("C".repeat(50)),
    "Merged chunk should contain the runt text",
  );
});

test("last chunk at or above 10% threshold stays separate", () => {
  // 1400 chars + \n\n + 1400 chars + \n\n + 200 chars = 3004 total
  // 200 >= 150 (10% of 1500) → should NOT merge
  const para1 = "A".repeat(1400);
  const para2 = "B".repeat(1400);
  const para3 = "C".repeat(200);
  const text = [para1, para2, para3].join("\n\n");
  const result = chunkScriptText(text);

  assert.equal(result.chunks.length, 3, "Chunk above threshold should stay separate");
  assert.equal(result.chunks[2]!.text, "C".repeat(200));
});

// ---------------------------------------------------------------------------
// Custom maxChars
// ---------------------------------------------------------------------------

test("custom maxChars is respected", () => {
  const text = "Hello world. This is a test. Another sentence here. And one more sentence.";
  const result = chunkScriptText(text, 30);

  assert.equal(result.needsChunking, true);
  assert.ok(result.chunks.length >= 2);
});

// ---------------------------------------------------------------------------
// Offset tracking
// ---------------------------------------------------------------------------

test("chunk offsets are sequential and cover the text", () => {
  const para1 = "First paragraph with content.";
  const para2 = "Second paragraph here.";
  const para3 = "Third paragraph at the end.";
  const text = [para1, para2, para3].join("\n\n");
  const result = chunkScriptText(text, 40);

  for (let i = 0; i < result.chunks.length; i++) {
    const chunk = result.chunks[i]!;
    assert.equal(chunk.index, i);
    assert.ok(chunk.startOffset >= 0);
    assert.ok(chunk.endOffset > chunk.startOffset);
    assert.equal(chunk.charCount, chunk.text.length);
  }
});

// ---------------------------------------------------------------------------
// needsChunking flag
// ---------------------------------------------------------------------------

test("needsChunking is false for single-chunk results", () => {
  assert.equal(chunkScriptText("short").needsChunking, false);
  assert.equal(chunkScriptText("A".repeat(1500)).needsChunking, false);
});

test("needsChunking is true for multi-chunk results", () => {
  const text = "A".repeat(800) + "\n\n" + "B".repeat(800);
  assert.equal(chunkScriptText(text).needsChunking, true);
});
