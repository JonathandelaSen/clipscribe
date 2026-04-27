import { spawn } from "node:child_process";

import { getBundledBinaryPath, isEnoentError } from "@/lib/editor/node-binaries";
import type {
  VoiceoverGeminiGenerationConfig,
  VoiceoverProviderAdapter,
  VoiceoverSpeakerConfig,
  VoiceoverUsageSummary,
} from "@/lib/voiceover/types";
import {
  buildProjectVoiceoverFilename,
  DEFAULT_GEMINI_TTS_VOICE,
  estimateGeminiTtsCostUsd,
  resolveVoiceoverOutputFileInfo,
} from "@/lib/voiceover/utils";

import { VoiceoverError } from "./errors";

const GEMINI_TTS_SAMPLE_RATE = 24000;
const GEMINI_TTS_CHANNELS = 1;
const GEMINI_TTS_SAMPLE_WIDTH_BYTES = 2;

type LooseRecord = Record<string, unknown>;

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object";
}

function pickFiniteInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function readGeminiUsageMetadata(payload: unknown): GeminiUsageMetadata | undefined {
  if (!isRecord(payload) || !isRecord(payload.usageMetadata)) return undefined;
  const usage = payload.usageMetadata;
  return {
    promptTokenCount: pickFiniteInteger(usage.promptTokenCount),
    candidatesTokenCount: pickFiniteInteger(usage.candidatesTokenCount),
    totalTokenCount: pickFiniteInteger(usage.totalTokenCount),
  };
}

function buildGeminiUsageSummary(input: {
  scriptText: string;
  usageMetadata?: GeminiUsageMetadata;
}): VoiceoverUsageSummary {
  const promptTokens = input.usageMetadata?.promptTokenCount;
  const completionTokens = input.usageMetadata?.candidatesTokenCount;
  const totalTokens = input.usageMetadata?.totalTokenCount;
  const estimatedCostUsd = estimateGeminiTtsCostUsd({
    promptTokens,
    completionTokens,
  });

  return {
    billedCharacters: input.scriptText.length,
    source: input.usageMetadata ? "provider" : "estimated",
    estimatedCostUsd,
    estimatedCostSource: estimatedCostUsd == null ? "unavailable" : "estimated",
    estimatedCreditsMin: 0,
    estimatedCreditsMax: 0,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function extractGeminiErrorMessage(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!isRecord(payload)) return "";
  const error = isRecord(payload.error) ? payload.error : null;
  if (typeof error?.message === "string") return error.message.trim();
  if (typeof payload.message === "string") return payload.message.trim();
  return "";
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toGeminiError(status: number, payload: unknown): VoiceoverError {
  const providerMessage = extractGeminiErrorMessage(payload);
  if (status === 401 || status === 403) {
    return new VoiceoverError("Gemini rejected the API key available for Voiceover. Check Creator settings or GEMINI_API_KEY.", {
      status,
      code: "gemini_auth_error",
    });
  }
  if (status === 429) {
    return new VoiceoverError(providerMessage || "Gemini rejected the request because of quota or rate limits.", {
      status: 429,
      code: "gemini_rate_limited",
    });
  }
  if (status >= 500) {
    return new VoiceoverError("Gemini TTS is temporarily unavailable. Please retry in a moment.", {
      status: 502,
      code: "gemini_unavailable",
    });
  }

  return new VoiceoverError(providerMessage || `Gemini TTS request failed (${status}).`, {
    status: status >= 400 && status < 500 ? status : 502,
    code: "gemini_request_failed",
  });
}

function readInlineAudioData(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "";

  for (const candidate of payload.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue;
    for (const part of candidate.content.parts) {
      if (!isRecord(part)) continue;
      const inlineData = isRecord(part.inlineData) ? part.inlineData : isRecord(part.inline_data) ? part.inline_data : null;
      const data = inlineData?.data;
      if (typeof data === "string" && data.trim()) {
        return data.trim();
      }
    }
  }

  return "";
}

function writePcmAsWav(pcm: Uint8Array): Uint8Array {
  const dataLength = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, GEMINI_TTS_CHANNELS, true);
  view.setUint32(24, GEMINI_TTS_SAMPLE_RATE, true);
  view.setUint32(28, GEMINI_TTS_SAMPLE_RATE * GEMINI_TTS_CHANNELS * GEMINI_TTS_SAMPLE_WIDTH_BYTES, true);
  view.setUint16(32, GEMINI_TTS_CHANNELS * GEMINI_TTS_SAMPLE_WIDTH_BYTES, true);
  view.setUint16(34, GEMINI_TTS_SAMPLE_WIDTH_BYTES * 8, true);
  writeAscii(36, "data");
  view.setUint32(40, dataLength, true);

  const output = new Uint8Array(44 + dataLength);
  output.set(new Uint8Array(header), 0);
  output.set(pcm, 44);
  return output;
}

async function transcodePcmToMp3(pcm: Uint8Array): Promise<Uint8Array> {
  const command = getBundledBinaryPath("ffmpeg") ?? "ffmpeg";
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "s16le",
    "-ar",
    String(GEMINI_TTS_SAMPLE_RATE),
    "-ac",
    String(GEMINI_TTS_CHANNELS),
    "-i",
    "pipe:0",
    "-f",
    "mp3",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "pipe:1",
  ];

  return new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (isEnoentError(error)) {
        reject(
          new VoiceoverError("ffmpeg is required to export Gemini TTS as MP3. Install dependencies or choose WAV.", {
            status: 500,
            code: "missing_ffmpeg",
          })
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new VoiceoverError(stderr.trim() || "ffmpeg failed while converting Gemini TTS audio.", {
            status: 500,
            code: "gemini_audio_transcode_failed",
          })
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(stdoutChunks)));
    });

    child.stdin.end(Buffer.from(pcm));
  });
}

function describeGeminiPacing(speed?: number): string | null {
  if (speed == null || !Number.isFinite(speed)) return null;
  if (speed < 0.75) return `Pacing: Speak very slowly and clearly. Target pace multiplier: ${speed}.`;
  if (speed < 0.95) return `Pacing: Speak slower than normal with deliberate pauses. Target pace multiplier: ${speed}.`;
  if (speed <= 1.05) return `Pacing: Speak at a natural normal pace. Target pace multiplier: ${speed}.`;
  if (speed <= 1.35) return `Pacing: Speak a little faster than normal while keeping pronunciation clear. Target pace multiplier: ${speed}.`;
  if (speed <= 1.75) return `Pacing: Speak fast and energetic, but do not rush words together. Target pace multiplier: ${speed}.`;
  return `Pacing: Speak very fast while preserving intelligibility. Target pace multiplier: ${speed}.`;
}

function buildGeminiPrompt(scriptText: string, stylePrompt?: string, speed?: number): string {
  const trimmedStyle = stylePrompt?.trim() ?? "";
  const pacing = describeGeminiPacing(speed);
  if (!trimmedStyle && !pacing) {
    return `Synthesize speech from the transcript below.\n\n### TRANSCRIPT\n${scriptText}`;
  }

  return [
    "Synthesize speech from the transcript below. Follow the director's notes, but only speak the transcript.",
    "",
    "### DIRECTOR'S NOTES",
    ...[trimmedStyle, pacing].filter(Boolean),
    "",
    "### TRANSCRIPT",
    scriptText,
  ].join("\n");
}

function buildVoiceConfig(voiceName: string) {
  return {
    prebuiltVoiceConfig: {
      voiceName,
    },
  };
}

function normalizeSpeakers(speakers?: VoiceoverSpeakerConfig[]): VoiceoverSpeakerConfig[] {
  const fallback: VoiceoverSpeakerConfig[] = [
    { speaker: "Speaker1", voiceName: DEFAULT_GEMINI_TTS_VOICE },
    { speaker: "Speaker2", voiceName: "Puck" },
  ];
  if (!Array.isArray(speakers)) return fallback;
  const normalized = speakers
    .slice(0, 2)
    .map((speaker, index) => ({
      speaker: speaker.speaker?.trim() || fallback[index]!.speaker,
      voiceName: speaker.voiceName?.trim() || fallback[index]!.voiceName,
    }))
    .filter((speaker) => speaker.speaker && speaker.voiceName);

  return normalized.length === 2 ? normalized : fallback;
}

function buildSpeechConfig(input: {
  voiceName: string;
  languageCode?: string;
  speakerMode?: "single" | "multi";
  speakers?: VoiceoverSpeakerConfig[];
}) {
  const base = input.languageCode
    ? {
        languageCode: input.languageCode,
      }
    : {};
  if (input.speakerMode === "multi") {
    return {
      ...base,
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: normalizeSpeakers(input.speakers).map((speaker) => ({
          speaker: speaker.speaker,
          voiceConfig: buildVoiceConfig(speaker.voiceName),
        })),
      },
    };
  }

  return {
    ...base,
    voiceConfig: buildVoiceConfig(input.voiceName),
  };
}

function buildGenerationConfig(input: {
  voiceName: string;
  languageCode?: string;
  speakerMode?: "single" | "multi";
  speakers?: VoiceoverSpeakerConfig[];
  generationConfig?: VoiceoverGeminiGenerationConfig;
}) {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: buildSpeechConfig(input),
    ...(input.generationConfig?.temperature != null ? { temperature: input.generationConfig.temperature } : undefined),
    ...(input.generationConfig?.topP != null ? { topP: input.generationConfig.topP } : undefined),
    ...(input.generationConfig?.topK != null ? { topK: input.generationConfig.topK } : undefined),
    ...(input.generationConfig?.seed != null ? { seed: input.generationConfig.seed } : undefined),
    ...(input.generationConfig?.candidateCount != null ? { candidateCount: input.generationConfig.candidateCount } : undefined),
    ...(input.generationConfig?.maxOutputTokens != null ? { maxOutputTokens: input.generationConfig.maxOutputTokens } : undefined),
    ...(input.generationConfig?.stopSequences?.length ? { stopSequences: input.generationConfig.stopSequences } : undefined),
  };
}

export const geminiVoiceoverAdapter: VoiceoverProviderAdapter = {
  id: "gemini",

  async generate(input) {
    const voiceName = input.voiceName?.trim() || DEFAULT_GEMINI_TTS_VOICE;
    const speakerMode = input.speakerMode === "multi" ? "multi" : "single";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: buildGeminiPrompt(input.scriptText, input.stylePrompt, input.speed),
                },
              ],
            },
          ],
          generationConfig: buildGenerationConfig({
            voiceName,
            languageCode: input.languageCode,
            speakerMode,
            speakers: input.speakers,
            generationConfig: input.generationConfig,
          }),
          model: input.model,
        }),
        cache: "no-store",
        signal: input.signal,
      }
    );
    const responseText = await response.text();
    const payload = responseText ? safeJsonParse(responseText) : null;

    if (!response.ok) {
      throw toGeminiError(response.status, payload ?? responseText);
    }

    const base64Audio = readInlineAudioData(payload);
    if (!base64Audio) {
      throw new VoiceoverError("Gemini TTS returned no audio. Retry the generation; preview TTS can occasionally return text only.", {
        status: 502,
        code: "gemini_audio_missing",
      });
    }

    const pcm = new Uint8Array(Buffer.from(base64Audio, "base64"));
    if (pcm.byteLength === 0) {
      throw new VoiceoverError("Gemini TTS returned empty audio.", {
        status: 502,
        code: "gemini_audio_empty",
      });
    }

    const bytes = input.outputFormat === "wav" ? writePcmAsWav(pcm) : await transcodePcmToMp3(pcm);
    const { extension, mimeType } = resolveVoiceoverOutputFileInfo(input.outputFormat);

    return {
      bytes,
      provider: "gemini",
      model: input.model,
      voiceId: voiceName,
      voiceName,
      languageCode: input.languageCode,
      speakerMode,
      speakers: speakerMode === "multi" ? normalizeSpeakers(input.speakers) : undefined,
      speed: input.speed,
      outputFormat: input.outputFormat,
      mimeType,
      extension,
      usage: buildGeminiUsageSummary({
        scriptText: input.scriptText,
        usageMetadata: readGeminiUsageMetadata(payload),
      }),
      filename: buildProjectVoiceoverFilename({
        projectName: input.projectId,
        provider: "gemini",
        outputFormat: input.outputFormat,
      }),
    };
  },
};
