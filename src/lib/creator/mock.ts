import { makeId, type SubtitleChunk } from "@/lib/history";
import { EDITOR_PRESETS } from "@/lib/creator/editor-presets";
import { resolveCreatorSuggestedShort, toCreatorShortPlan, toCreatorViralClip } from "@/lib/creator/shorts-compat";
import {
  clamp,
  secondsToClock,
  type CreatorChapter,
  type CreatorShortRenderRequest,
  type CreatorShortRenderResponse,
  type CreatorShortsGenerateRequest,
  type CreatorShortsGenerateResponse,
  type CreatorSuggestedShort,
  type CreatorVideoInfoGenerateRequest,
  type CreatorVideoInfoGenerateResponse,
} from "@/lib/creator/types";

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "your", "have", "they", "their", "there", "what", "when", "where",
  "which", "would", "could", "should", "about", "into", "then", "than", "them", "were", "been", "will", "just", "really",
  "very", "also", "like", "because", "while", "here", "some", "more", "most", "such", "only", "over", "after", "before",
  "video", "content", "creator", "creators", "audio", "transcript", "subtitles", "subtitle", "shorts", "youtube", "tiktok",
]);

const HOOK_TERMS = [
  "how", "why", "secret", "mistake", "problem", "hack", "tip", "viral", "fast", "easy", "hard", "best", "worst",
  "don\"t", "stop", "look", "crazy", "important", "actually", "truth", "strategy", "algorithm", "growth",
];

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function getRuntimeSeconds(chunks: SubtitleChunk[]): number {
  if (!chunks.length) return 0;
  const lastWithTime = [...chunks].reverse().find((chunk) => chunk.timestamp?.[1] != null || chunk.timestamp?.[0] != null);
  if (!lastWithTime) return 0;
  return Number(lastWithTime.timestamp?.[1] ?? lastWithTime.timestamp?.[0] ?? 0);
}

function extractTopTerms(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function summarizeTranscript(text: string, topTerms: string[]): string {
  const cleaned = normalizeText(text);
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/).find(Boolean) ?? cleaned.slice(0, 180);
  const themes = topTerms.slice(0, 4).join(", ");
  return `${firstSentence.slice(0, 220)}${firstSentence.length > 220 ? "…" : ""} Main themes: ${themes || "general discussion"}.`;
}

function buildChapters(chunks: SubtitleChunk[], runtime: number, topTerms: string[]): CreatorChapter[] {
  if (!chunks.length || runtime <= 0) {
    return [
      {
        id: makeId("chapter"),
        timeSeconds: 0,
        label: "Introduction",
        reason: "Fallback chapter because no timed chunks were available.",
      },
    ];
  }

  const targetChapterCount = clamp(Math.round(runtime / 90), 4, 10);
  const interval = runtime / targetChapterCount;
  const chapters: CreatorChapter[] = [];

  for (let i = 0; i < targetChapterCount; i++) {
    const start = i * interval;
    const chunk = chunks.find((c) => {
      const t = c.timestamp?.[0] ?? 0;
      return t >= start;
    }) ?? chunks[Math.min(i, chunks.length - 1)];

    const snippet = normalizeText(String(chunk.text ?? "")).replace(/[.!?]+$/g, "");
    const labelSeed = snippet.split(/[,.:;-]/)[0]?.trim() || `Segment ${i + 1}`;
    const label = labelSeed.split(" ").slice(0, 6).join(" ");

    chapters.push({
      id: makeId("chapter"),
      timeSeconds: Math.max(0, Math.floor(chunk.timestamp?.[0] ?? start)),
      label: label.charAt(0).toUpperCase() + label.slice(1),
      reason:
        i === 0
          ? "Opening section / setup"
          : i === targetChapterCount - 1
            ? "Closing section / recap"
            : `Likely topic shift based on transcript timing and theme (${topTerms[i % Math.max(topTerms.length, 1)] ?? "topic"})`,
    });
  }

  const deduped: CreatorChapter[] = [];
  const seenTimes = new Set<number>();
  for (const chapter of chapters.sort((a, b) => a.timeSeconds - b.timeSeconds)) {
    if (seenTimes.has(chapter.timeSeconds)) continue;
    seenTimes.add(chapter.timeSeconds);
    deduped.push(chapter);
  }
  if (!seenTimes.has(0)) {
    deduped.unshift({
      id: makeId("chapter"),
      timeSeconds: 0,
      label: "Intro",
      reason: "YouTube chapter best practice: explicit intro anchor",
    });
  }
  return deduped;
}

function chunkWindowDuration(window: SubtitleChunk[]): number {
  if (!window.length) return 0;
  const start = window[0].timestamp?.[0] ?? 0;
  const end = window[window.length - 1].timestamp?.[1] ?? window[window.length - 1].timestamp?.[0] ?? start;
  return Math.max(0, end - start);
}

function scoreWindow(window: SubtitleChunk[], topTerms: string[]): number {
  const text = normalizeText(window.map((c) => String(c.text ?? "")).join(" ")).toLowerCase();
  let score = 0;

  for (const term of HOOK_TERMS) {
    if (text.includes(term)) score += 8;
  }
  for (const term of topTerms.slice(0, 6)) {
    if (term && text.includes(term)) score += 4;
  }
  score += (text.match(/!/g)?.length ?? 0) * 2;
  score += (text.match(/\?/g)?.length ?? 0) * 3;
  score += window.length >= 3 ? 5 : 0;

  const duration = chunkWindowDuration(window);
  if (duration >= 18 && duration <= 45) score += 18;
  else if (duration >= 12 && duration <= 60) score += 8;

  const charCount = text.length;
  if (charCount > 120 && charCount < 500) score += 10;

  return score;
}

function overlap(a: CreatorSuggestedShort, b: CreatorSuggestedShort): boolean {
  return a.startSeconds < b.endSeconds && b.startSeconds < a.endSeconds;
}

function buildSuggestedShorts(chunks: SubtitleChunk[], runtime: number, topTerms: string[]): CreatorSuggestedShort[] {
  if (!chunks.length) return [];

  const candidates: CreatorSuggestedShort[] = [];
  const maxStartIndex = Math.max(0, chunks.length - 2);

  for (let i = 0; i <= maxStartIndex; i++) {
    const window: SubtitleChunk[] = [];
    const sourceChunkIndexes: number[] = [];

    for (let j = i; j < chunks.length && j < i + 8; j++) {
      const chunk = chunks[j];
      window.push(chunk);
      sourceChunkIndexes.push(j);
      const duration = chunkWindowDuration(window);
      if (duration >= 18) {
        if (duration <= 58) {
          const startSeconds = Math.max(0, Math.floor(window[0].timestamp?.[0] ?? 0));
          const endSeconds = Math.ceil(window[window.length - 1].timestamp?.[1] ?? window[window.length - 1].timestamp?.[0] ?? startSeconds + duration);
          const joined = normalizeText(window.map((c) => String(c.text ?? "")).join(" "));
          const titleSeed = joined.split(/(?<=[.!?])\s+/)[0] ?? joined;
          const hook = titleSeed.slice(0, 120);
          const score = scoreWindow(window, topTerms);
          const progress = runtime > 0 ? startSeconds / runtime : 0;
          const boostedScore = score + (progress < 0.2 ? 4 : 0) + (progress > 0.2 && progress < 0.8 ? 3 : 0);
          const keyword = topTerms[(candidates.length + startSeconds) % Math.max(topTerms.length, 1)] ?? "creator";

          candidates.push({
            id: makeId("short"),
            startSeconds,
            endSeconds,
            durationSeconds: Math.max(1, endSeconds - startSeconds),
            score: Math.round(boostedScore),
            title: `Clip cut: ${titleSeed.split(" ").slice(0, 8).join(" ")}`,
            reason: `High hook density and compact narrative window (${sourceChunkIndexes.length} subtitle chunks).`,
            caption: `${hook.slice(0, 90)}${hook.length > 90 ? "…" : ""}\n\n#${keyword.replace(/[^a-z0-9]/gi, "")}`,
            openingText: hook.slice(0, 60),
            endCardText: `Want more ${keyword}? Follow for part 2`,
            sourceChunkIndexes,
            suggestedSubtitleLanguage: "en",
            editorPreset: EDITOR_PRESETS[0],
          });
        }
        break;
      }
    }
  }

  const selected: CreatorSuggestedShort[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds)) {
    if (selected.some((picked) => overlap(picked, candidate))) continue;
    selected.push(candidate);
    if (selected.length >= 6) break;
  }

  if (!selected.length) {
    const firstChunk = chunks[0];
    const startSeconds = Math.floor(firstChunk.timestamp?.[0] ?? 0);
    const endSeconds = Math.ceil(firstChunk.timestamp?.[1] ?? startSeconds + 20);
    selected.push({
      id: makeId("short"),
      startSeconds,
      endSeconds,
      durationSeconds: Math.max(1, endSeconds - startSeconds),
      score: 50,
      title: "Manual-ready opening cut",
      reason: "Fallback short from the opening chunk.",
      caption: "#creator",
      openingText: normalizeText(String(firstChunk.text ?? "Opening line")).slice(0, 60),
      endCardText: "Follow for more",
      sourceChunkIndexes: [0],
      suggestedSubtitleLanguage: "en",
      editorPreset: EDITOR_PRESETS[0],
    });
  }

  return selected.sort((a, b) => a.startSeconds - b.startSeconds);
}

function buildChapterText(chapters: CreatorChapter[]): string {
  return chapters
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((chapter) => `${secondsToClock(chapter.timeSeconds)} ${chapter.label}`)
    .join("\n");
}

function deduceTheme(topTerms: string[]): string {
  if (!topTerms.length) return "General educational / commentary";
  return `Content focused on ${topTerms.slice(0, 3).join(", ")}`;
}

function buildMockAnalysisData(request: CreatorShortsGenerateRequest | CreatorVideoInfoGenerateRequest) {
  const transcriptText = normalizeText(request.transcriptText || request.transcriptChunks.map((c) => String(c.text ?? "")).join(" "));
  const chunks = request.transcriptChunks ?? [];
  const runtimeSeconds = Math.max(1, Math.round(getRuntimeSeconds(chunks) || 1));
  const topTerms = extractTopTerms(transcriptText, 12);
  const chapters = buildChapters(chunks, runtimeSeconds, topTerms);
  const chapterText = buildChapterText(chapters);
  const shorts = buildSuggestedShorts(chunks, runtimeSeconds, topTerms);
  const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
  const speakingRate = runtimeSeconds > 0 ? Math.round((wordCount / runtimeSeconds) * 60) : 0;

  const primaryKeyword = topTerms[0] ?? "content";
  const secondaryKeyword = topTerms[1] ?? "strategy";
  const tertiaryKeyword = topTerms[2] ?? "workflow";

  const videoSummary = summarizeTranscript(transcriptText, topTerms);
  const titleIdeas = [
    `Content Breakdown: ${primaryKeyword} + ${secondaryKeyword}`,
    `The ${primaryKeyword} System Nobody Explains Clearly (${secondaryKeyword} + ${tertiaryKeyword})`,
    `How to Improve ${primaryKeyword} Fast: Real Workflow, Mistakes, and Wins`,
    `${primaryKeyword} vs ${secondaryKeyword}: What Actually Matters in Practice`,
    `I Analyzed This Workflow and Found the Real ${primaryKeyword} Bottleneck`,
  ];

  const hashtags = [primaryKeyword, secondaryKeyword, tertiaryKeyword, "contentcreator", "creatorworkflow"]
    .map((term) => `#${term.replace(/[^a-z0-9]/gi, "")}`)
    .filter((tag, index, arr) => tag.length > 1 && arr.indexOf(tag) === index)
    .slice(0, 8);

  const repeatedTerms = topTerms.slice(0, 8);

  const descriptionLines = [
    `${videoSummary}`,
    "",
    "In this video:",
    ...chapters.slice(0, 6).map((chapter) => `- ${secondsToClock(chapter.timeSeconds)} ${chapter.label}`),
    "",
    "Key takeaways:",
    `- Best moments revolve around ${primaryKeyword}, ${secondaryKeyword}, and ${tertiaryKeyword}`,
    `- Clip candidates already identified for Shorts/Reels/TikTok repurposing`,
    `- Subtitle-ready timestamps extracted from the transcript`,
    "",
    "If this helped, subscribe and comment which clip should become a short first.",
  ];

  return {
    runtimeSeconds,
    wordCount,
    speakingRate,
    repeatedTerms,
    detectedTheme: deduceTheme(topTerms),
    youtube: {
      titleIdeas,
      description: descriptionLines.join("\n"),
      pinnedComment: `What part hit hardest: ${chapters[1]?.label ?? "the main workflow"}? I can break it into a full short next.`,
      hashtags,
      seoKeywords: [primaryKeyword, secondaryKeyword, tertiaryKeyword, ...topTerms.slice(3, 8)],
      thumbnailHooks: [
        `Big ${primaryKeyword} mistake`,
        `${secondaryKeyword} changed everything`,
        `This workflow scales`,
        `Most creators miss this`,
        `Cut this, grow faster`,
      ],
      chapterText,
    },
    content: {
      videoSummary,
      keyMoments: chapters.slice(0, 6).map((chapter) => `${secondsToClock(chapter.timeSeconds)} ${chapter.label}`),
      hookIdeas: [
        `If you are doing ${primaryKeyword} manually, you are burning hours every week.`,
        `The difference between average and high-performing creators is usually one ${secondaryKeyword} decision.`,
        `This is the clip I would post first if I needed growth today.`,
      ],
      ctaIdeas: [
        "Comment the moment you want turned into a short.",
        "Subscribe for the full creator workflow stack.",
        "Follow for the editing system breakdown in the next upload.",
      ],
      repurposeIdeas: [
        `Turn chapter sequence into a carousel/thread about ${primaryKeyword}`,
        `Use top viral clip as a cold-open teaser for the long video`,
        `Split Q&A-style moments into 3 short FAQs for Reels`,
      ],
    },
    chapters,
    shorts,
  };
}

export function generateMockCreatorShorts(request: CreatorShortsGenerateRequest): CreatorShortsGenerateResponse {
  const mock = buildMockAnalysisData(request);
  return {
    ok: true,
    providerMode: "mock",
    model: "mock-chatgpt-creator-v1",
    generatedAt: Date.now(),
    runtimeSeconds: mock.runtimeSeconds,
    shorts: mock.shorts,
    viralClips: mock.shorts.map(toCreatorViralClip),
    shortsPlans: mock.shorts.map(toCreatorShortPlan),
    editorPresets: EDITOR_PRESETS,
  };
}

export function generateMockCreatorVideoInfo(request: CreatorVideoInfoGenerateRequest): CreatorVideoInfoGenerateResponse {
  const mock = buildMockAnalysisData(request);
  return {
    ok: true,
    providerMode: "mock",
    model: "mock-chatgpt-creator-v1",
    generatedAt: Date.now(),
    runtimeSeconds: mock.runtimeSeconds,
    youtube: mock.youtube,
    content: mock.content,
    chapters: mock.chapters,
    insights: {
      transcriptWordCount: mock.wordCount,
      estimatedSpeakingRateWpm: mock.speakingRate,
      repeatedTerms: mock.repeatedTerms,
      detectedTheme: mock.detectedTheme,
    },
  };
}

export function generateMockShortRender(request: CreatorShortRenderRequest): CreatorShortRenderResponse {
  const short = resolveCreatorSuggestedShort({
    short: request.short,
    clip: request.clip,
    plan: request.plan,
  });
  const outputFilename = `${request.filename.replace(/\.[^/.]+$/, "")}__${short.startSeconds}-${short.endSeconds}.mp4`;

  const subtitleText = (request.subtitleChunks ?? [])
    .map((chunk) => String(chunk.text ?? ""))
    .join(" ")
    .slice(0, 80);

  const ffmpegCommandPreview = [
    "ffmpeg",
    "-i",
    request.filename,
    "-ss",
    String(short.startSeconds),
    "-to",
    String(short.endSeconds),
    "-vf",
    `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles=mock.ass`,
    "-c:v",
    "libx264",
    "-crf",
    "20",
    outputFilename,
  ];

  return {
    ok: true,
    providerMode: "mock-render",
    jobId: makeId("renderjob"),
    status: "completed",
    createdAt: Date.now(),
    estimatedSeconds: 0,
    output: {
      filename: outputFilename,
      aspectRatio: "9:16",
      resolution: "1080x1920",
      subtitleBurnedIn: true,
    },
    debugPreview: {
      ffmpegCommandPreview,
      notes: [
        "Mock render response (no real video file generated yet).",
        `Clip duration ${short.durationSeconds}s, subtitle style ${short.editorPreset.subtitleStyle}.`,
        subtitleText ? `Subtitle preview text: ${subtitleText}${subtitleText.length >= 80 ? "…" : ""}` : "No subtitle chunks provided.",
      ],
    },
  };
}
