import { pipeline, env } from "@huggingface/transformers";
import { configureWorkerTransformersEnv } from "@/lib/transcriber/core/transformers-env";
import type { SubtitleChunk } from "@/lib/history";

// Configurations for Transformers.js
configureWorkerTransformersEnv(env, self);

type WorkerProgressPayload = Record<string, unknown>;

type TranslateMessage = {
  type: "translate";
  chunks: SubtitleChunk[];
  sourceLanguage: string;
  targetLanguage: string;
};

type TranslationResult = {
  translation_text: string;
};

type TranslatorPipeline = (input: string) => Promise<TranslationResult[]>;

const createTranslationPipeline = pipeline as unknown as (
  task: "translation",
  modelName: string,
  options: {
    progress_callback: (progress: WorkerProgressPayload) => void;
    device: "wasm";
    dtype: "q4";
  }
) => Promise<TranslatorPipeline>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class TranslatorSingleton {
  static task = "translation" as const;
  static instances: Record<string, TranslatorPipeline> = {};

  static async getInstance(
    src: string,
    tgt: string,
    progress_callback: (progress: WorkerProgressPayload) => void
  ): Promise<TranslatorPipeline> {
    const modelName = `Xenova/opus-mt-${src}-${tgt}`;

    if (!this.instances[modelName]) {
      this.instances[modelName] = await createTranslationPipeline(this.task, modelName, {
        progress_callback,
        device: "wasm",
        dtype: "q4",
      });
    }
    return this.instances[modelName];
  }
}

self.addEventListener("message", async (event: MessageEvent<TranslateMessage>) => {
  const { type, chunks, sourceLanguage, targetLanguage } = event.data;

  if (type === "translate") {
    try {
      const translator = await TranslatorSingleton.getInstance(sourceLanguage, targetLanguage, (progress) => {
        self.postMessage({ status: "progress", data: progress });
      });

      self.postMessage({ status: "ready" });

      const totalChunks = chunks.length;
      let chunksProcessed = 0;
      const translatedChunks: SubtitleChunk[] = [];

      for (const chunk of chunks) {
        // opus-mt translates implicitly based on the loaded model
        const output = await translator(chunk.text);

        translatedChunks.push({
          ...chunk,
          text: output[0].translation_text,
        });

        chunksProcessed++;
        self.postMessage({
          status: "chunk_progress",
          progress: Math.min(100, Math.round((chunksProcessed / totalChunks) * 100)),
        });
      }

      self.postMessage({ status: "complete", output: translatedChunks });
    } catch (error: unknown) {
      self.postMessage({ status: "error", error: getErrorMessage(error) });
    }
  }
});
