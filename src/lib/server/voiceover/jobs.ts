import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VoiceoverApiKeySource, VoiceoverGenerateRequest, VoiceoverGenerateResponseMeta, VoiceoverGenerateResult } from "@/lib/voiceover/types";
import { generateProjectVoiceover } from "./service";
import { voiceoverJobRepository, type VoiceoverJobModel } from "./repository";
import { VoiceoverError } from "./errors";

const JOBS_DIR = path.join(process.cwd(), ".data", "voiceover-jobs");

/**
 * Cleanup de jobs viejos (> 1 hora) para no acumular basura en disco.
 * Esto se llama periódicamente cuando se envían nuevos jobs.
 */
function cleanupOldJobs() {
  try {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const oldJobs = voiceoverJobRepository.findOldJobs(ONE_HOUR_MS);
    
    for (const job of oldJobs) {
      if (job.audioFilename) {
        const audioPath = path.join(JOBS_DIR, job.audioFilename);
        if (fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      }
      voiceoverJobRepository.delete(job.id);
    }
  } catch (err) {
    console.error("Failed to cleanup old voiceover jobs:", err);
  }
}

export function submitVoiceoverJob(
  request: VoiceoverGenerateRequest,
  options: {
    apiKey: string;
    apiKeySource: VoiceoverApiKeySource;
  }
): string {
  const jobId = randomUUID();
  
  const job: VoiceoverJobModel = {
    id: jobId,
    projectId: request.projectId,
    status: "pending",
    request,
    createdAt: Date.now(),
  };

  voiceoverJobRepository.create(job);

  // Ejecución en background: IIFE asíncrona
  void (async () => {
    try {
      // Llamamos al servicio original, que hace el fetch síncrono al proveedor.
      // Si el servidor crashea durante esta espera, este promise morirá.
      // El repositorio en el siguiente arranque lo marcará como "interrupted".
      const result = await generateProjectVoiceover(request, {
        apiKey: options.apiKey,
        apiKeySource: options.apiKeySource,
      });

      // Guardar el audio en disco
      const audioFilename = `${jobId}.${result.extension}`;
      const audioPath = path.join(JOBS_DIR, audioFilename);
      fs.writeFileSync(audioPath, Buffer.from(result.bytes));

      const resultMeta: VoiceoverGenerateResponseMeta = {
        provider: result.provider,
        model: result.model,
        voiceId: result.voiceId,
        voiceName: result.voiceName,
        languageCode: result.languageCode,
        speakerMode: result.speakerMode,
        speakers: result.speakers,
        speed: result.speed,
        outputFormat: result.outputFormat,
        apiKeySource: result.apiKeySource,
        maskedApiKey: result.maskedApiKey,
        filename: result.filename,
        mimeType: result.mimeType,
        extension: result.extension,
        usage: result.usage,
      };

      // Actualizar SQLite
      voiceoverJobRepository.markCompleted(jobId, resultMeta, audioFilename);
    } catch (error) {
      console.error(`Background Voiceover Job ${jobId} failed:`, error);
      const errorMessage = error instanceof VoiceoverError 
        ? error.message 
        : error instanceof Error ? error.message : "Voiceover generation failed";
      
      voiceoverJobRepository.updateStatus(jobId, "failed", errorMessage);
    }
  })();

  // Aprovechamos para limpiar jobs viejos asíncronamente
  setTimeout(cleanupOldJobs, 1000);

  return jobId;
}

export function getVoiceoverJobStatus(jobId: string): VoiceoverJobModel | null {
  return voiceoverJobRepository.getById(jobId);
}

export function consumeVoiceoverJobResult(jobId: string): VoiceoverGenerateResult {
  const job = voiceoverJobRepository.getById(jobId);
  if (!job) {
    throw new VoiceoverError("Job not found", { status: 404, code: "job_not_found" });
  }
  if (job.status !== "completed" || !job.resultMeta || !job.audioFilename) {
    throw new VoiceoverError("Job is not ready", { status: 409, code: "job_not_ready" });
  }

  const audioPath = path.join(JOBS_DIR, job.audioFilename);
  if (!fs.existsSync(audioPath)) {
    throw new VoiceoverError("Audio file missing on server", { status: 500, code: "missing_audio_file" });
  }

  const bytes = new Uint8Array(fs.readFileSync(audioPath));

  return {
    ...job.resultMeta,
    bytes,
  };
}
