import { pipeline, env } from "@huggingface/transformers";
import { configureWorkerTransformersEnv } from "@/lib/transcriber/core/transformers-env";

// Configurations for Transformers.js
configureWorkerTransformersEnv(env, self);

type WorkerProgressPayload = Record<string, unknown>;

type TranscribeMessage = {
  type: "transcribe";
  audio: Float32Array;
  duration: number;
  language?: string;
};

type WhisperGenerate = (this: WhisperModel, ...args: unknown[]) => Promise<unknown>;

type WhisperModel = {
  generate: WhisperGenerate;
  _original_generate?: WhisperGenerate;
};

type WhisperOutput = {
  language?: string;
};

type WhisperPipelineOptions = {
  task: "transcribe";
  chunk_length_s: number;
  stride_length_s: number;
  return_timestamps: true | "word";
  language?: string;
};

type WhisperPipeline = ((audio: Float32Array, options: WhisperPipelineOptions) => Promise<WhisperOutput | WhisperOutput[]>) & {
  model: WhisperModel;
};

const createWhisperPipeline = pipeline as unknown as (
  task: "automatic-speech-recognition",
  modelName: string,
  options: {
    progress_callback: (progress: WorkerProgressPayload) => void;
    device: "webgpu" | "wasm";
    dtype: {
      encoder_model: "fp32";
      decoder_model_merged: "q4";
    };
  }
) => Promise<WhisperPipeline>;

function hasWebGpuSupport(workerNavigator: Navigator): boolean {
  return "gpu" in workerNavigator;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDetectedLanguage(output: WhisperOutput | WhisperOutput[], fallbackLanguage?: string): string {
  const primaryOutput = Array.isArray(output) ? output[0] : output;
  if (primaryOutput?.language) {
    return primaryOutput.language;
  }
  return fallbackLanguage || "unknown";
}

class PipelineSingleton {
  static task = "automatic-speech-recognition" as const;
  static models = [
    "onnx-community/whisper-base_timestamped",
    "onnx-community/whisper-tiny_timestamped",
  ] as const;
  static instance: WhisperPipeline | null = null;
  static model: string | null = null;

  static async getInstance(progress_callback: (progress: WorkerProgressPayload) => void): Promise<WhisperPipeline> {
    if (this.instance === null) {
      const device = hasWebGpuSupport(navigator) ? "webgpu" : "wasm";
      let lastError: unknown = null;

      for (const modelName of this.models) {
        try {
          this.instance = await createWhisperPipeline(this.task, modelName, {
            progress_callback,
            device,
            dtype: {
              encoder_model: "fp32",
              decoder_model_merged: "q4",
            },
          });
          this.model = modelName;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (this.instance === null) {
        throw lastError instanceof Error ? lastError : new Error("Failed to load a Whisper transcription model.");
      }
    }
    return this.instance;
  }
}

self.addEventListener("message", async (event: MessageEvent<TranscribeMessage>) => {
  const { type, audio, duration, language } = event.data;

  if (type === "transcribe") {
    try {
      const transcriber = await PipelineSingleton.getInstance((progress) => {
        self.postMessage({ status: "progress", data: progress });
      });

      self.postMessage({ status: "ready" });
      self.postMessage({
        status: "info",
        message: `Starting transcription of ${Math.round(duration)}s audio on ${hasWebGpuSupport(navigator) ? "WebGPU" : "WASM"} using ${PipelineSingleton.model ?? "Whisper"}.`,
      });

      // Transformers.js chunking jump is (chunk_length - 2 * stride_length)
      const jump = 30 - (2 * 5); // 20s
      const totalChunks = Math.ceil(duration / jump);
      let chunksProcessed = 0;

      // Monkey-patch generate to track chunk progress
      const originalGenerate = transcriber.model._original_generate ?? transcriber.model.generate;
      transcriber.model._original_generate = originalGenerate;
      transcriber.model.generate = async function (...args: unknown[]) {
        const result = await originalGenerate.apply(this, args);
        chunksProcessed++;
        self.postMessage({
          status: "chunk_progress",
          progress: Math.min(100, Math.round((chunksProcessed / totalChunks) * 100)),
        });
        return result;
      };

      const options: WhisperPipelineOptions = {
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: "word",
      };

      if (language) {
        options.language = language;
      }

      const output = await transcriber(audio, options);

      const detectedLanguage = getDetectedLanguage(output, language);
      self.postMessage({ status: "info", message: `Transcription complete. Language: ${detectedLanguage}` });

      self.postMessage({ status: "complete", output });
    } catch (error: unknown) {
      self.postMessage({ status: "error", error: getErrorMessage(error) });
    }
  }
});
