import { useState, useEffect, useRef, useCallback } from "react";

export interface TranslatorProgress {
  file: string;
  name: string;
  progress: number;
  status: string;
}

export function useTranslator() {
  const [isTranslating, setIsTranslating] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelProgressItems, setModelProgressItems] = useState<TranslatorProgress[]>([]);
  const [translationProgress, setTranslationProgress] = useState<number>(0);
  const [translatedChunks, setTranslatedChunks] = useState<SubtitleChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const worker = useRef<Worker | null>(null);

  const initWorker = useCallback(() => {
    if (worker.current) return;
    
    worker.current = new Worker(new URL("../lib/translator.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.current.addEventListener("message", (e) => {
      const { status, data, output, error, progress } = e.data;

      switch (status) {
        case "progress":
          setIsModelLoading(true);
          setModelProgressItems((prev) => {
            const items = [...prev];
            const idx = items.findIndex((item) => item.file === data.file);
            if (idx !== -1) {
              items[idx] = data;
            } else {
              items.push(data);
            }
            return items;
          });
          break;
        case "ready":
          setIsModelLoading(false);
          setModelProgressItems([]); // Loading complete
          break;
        case "chunk_progress":
          setTranslationProgress(progress);
          break;
        case "complete":
          setIsTranslating(false);
          setTranslationProgress(100);
          setTranslatedChunks(output);
          break;
        case "error":
          setIsTranslating(false);
          setIsModelLoading(false);
          setError(error);
          console.error("Translator worker error:", error);
          break;
      }
    });
  }, []);

  useEffect(() => {
    initWorker();
    return () => {
      // Don't auto-terminate on unmount due to strict mode, model loading takes time.
    };
  }, [initWorker]);

  const translateChunks = (chunks: SubtitleChunk[], targetLanguage: string, sourceLanguage: string = "es") => {
    initWorker();
    setIsTranslating(true);
    setTranslationProgress(0);
    setError(null);
    setTranslatedChunks(null);
    setModelProgressItems([]);
    
    worker.current?.postMessage({
      type: "translate",
      chunks,
      sourceLanguage,
      targetLanguage
    });
  };

  const stopTranslation = () => {
    if (worker.current) {
      worker.current.terminate();
      worker.current = null;
    }
    setIsTranslating(false);
    setIsModelLoading(false);
    setModelProgressItems([]);
    setTranslationProgress(0);
  };

  return { 
    isTranslating, 
    isModelLoading, 
    modelProgressItems, 
    translationProgress, 
    translatedChunks, 
    error, 
    translateChunks,
    stopTranslation,
    setTranslatedChunks // Useful to reset state after download
  };
}
