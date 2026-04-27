import { useState } from "react";

import { requestProjectVoiceoverAudio, type VoiceoverClientResult } from "@/lib/voiceover/client";
import type { VoiceoverGenerateRequest } from "@/lib/voiceover/types";

export function useProjectVoiceoverGenerator() {
  const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);

  const generateVoiceover = async (
    payload: VoiceoverGenerateRequest,
    options: { elevenLabsApiKey?: string; geminiApiKey?: string; openAIApiKey?: string }
  ): Promise<VoiceoverClientResult> => {
    setIsGeneratingVoiceover(true);
    setVoiceoverError(null);
    try {
      return await requestProjectVoiceoverAudio(payload, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voiceover generation failed";
      setVoiceoverError(message);
      throw error;
    } finally {
      setIsGeneratingVoiceover(false);
    }
  };

  return {
    isGeneratingVoiceover,
    voiceoverError,
    generateVoiceover,
  };
}
