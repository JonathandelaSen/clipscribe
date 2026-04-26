import type {
  VoiceoverApiKeySource,
  VoiceoverGenerateRequest,
  VoiceoverGenerateResult,
  VoiceoverProviderAdapter,
  VoiceoverProviderId,
} from "@/lib/voiceover/types";

import { VoiceoverError } from "./errors";
import { elevenLabsVoiceoverAdapter } from "./elevenlabs";
import { geminiVoiceoverAdapter } from "./gemini";

const PROVIDERS: Partial<Record<VoiceoverProviderId, VoiceoverProviderAdapter>> = {
  elevenlabs: elevenLabsVoiceoverAdapter,
  gemini: geminiVoiceoverAdapter,
};

export async function generateProjectVoiceover(
  request: VoiceoverGenerateRequest,
  options: {
    apiKey: string;
    apiKeySource: VoiceoverApiKeySource;
    signal?: AbortSignal;
  }
): Promise<VoiceoverGenerateResult> {
  const provider = PROVIDERS[request.provider];
  if (!provider) {
    throw new VoiceoverError(`${request.provider} voiceover generation is not implemented yet.`, {
      status: 501,
      code: "provider_not_implemented",
    });
  }

  return provider.generate({
    ...request,
    apiKey: options.apiKey,
    apiKeySource: options.apiKeySource,
    signal: options.signal,
  });
}
