import { useCallback, useEffect, useRef, useState } from "react";

import { submitVoiceoverJob, pollVoiceoverJobStatus, fetchVoiceoverJobResult, type VoiceoverClientResult } from "@/lib/voiceover/client";
import type { VoiceoverGenerateRequest, VoiceoverJobStatus } from "@/lib/voiceover/types";

export function useProjectVoiceoverGenerator() {
  const [isGeneratingVoiceover, setIsGeneratingVoiceover] = useState(false);
  const [voiceoverError, setVoiceoverError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<VoiceoverJobStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const cleanupIntervals = useCallback(() => {
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
  }, []);

  useEffect(() => {
    return cleanupIntervals;
  }, [cleanupIntervals]);

  const generateVoiceover = async (
    payload: VoiceoverGenerateRequest,
    options: { elevenLabsApiKey?: string; geminiApiKey?: string; openAIApiKey?: string }
  ): Promise<string> => {
    setIsGeneratingVoiceover(true);
    setVoiceoverError(null);
    try {
      const jobId = await submitVoiceoverJob(payload, options);
      setActiveJobId(jobId);
      setJobStatus("pending");
      setElapsedSeconds(0);
      return jobId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voiceover generation submission failed";
      setVoiceoverError(message);
      setIsGeneratingVoiceover(false);
      throw error;
    }
  };

  const pollVoiceoverJob = useCallback(
    async (
      jobId: string,
      payload: VoiceoverGenerateRequest,
      onComplete: (result: VoiceoverClientResult) => void,
      onError: (error: string) => void
    ) => {
      setActiveJobId(jobId);
      setIsGeneratingVoiceover(true);
      setVoiceoverError(null);

      // Iniciar contador de tiempo si no está iniciado
      if (!elapsedIntervalRef.current) {
        elapsedIntervalRef.current = setInterval(() => {
          setElapsedSeconds((s) => s + 1);
        }, 1000);
      }

      const poll = async () => {
        try {
          const statusResult = await pollVoiceoverJobStatus(jobId);
          setJobStatus(statusResult.status);

          if (statusResult.status === "completed") {
            cleanupIntervals();
            const result = await fetchVoiceoverJobResult(jobId, payload);
            setIsGeneratingVoiceover(false);
            setActiveJobId(null);
            onComplete(result);
          } else if (statusResult.status === "failed" || statusResult.status === "interrupted") {
            cleanupIntervals();
            const errorMessage = statusResult.error || `Voiceover generation ${statusResult.status}`;
            setVoiceoverError(errorMessage);
            setIsGeneratingVoiceover(false);
            setActiveJobId(null);
            onError(errorMessage);
          } else {
            // "pending"
            pollTimeoutRef.current = setTimeout(poll, 4000);
          }
        } catch (err) {
          cleanupIntervals();
          const message = err instanceof Error ? err.message : "Failed to poll job status";
          setVoiceoverError(message);
          setIsGeneratingVoiceover(false);
          setActiveJobId(null);
          onError(message);
        }
      };

      // Poll inicial inmediato
      poll();
    },
    [cleanupIntervals]
  );

  const resetGenerator = useCallback(() => {
    cleanupIntervals();
    setActiveJobId(null);
    setJobStatus(null);
    setIsGeneratingVoiceover(false);
    setVoiceoverError(null);
    setElapsedSeconds(0);
  }, [cleanupIntervals]);

  return {
    isGeneratingVoiceover,
    voiceoverError,
    activeJobId,
    jobStatus,
    elapsedSeconds,
    generateVoiceover,
    pollVoiceoverJob,
    resetGenerator,
  };
}
