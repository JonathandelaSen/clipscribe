"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Link as LinkIcon, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface YouTubeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onImport: (url: string, signal: AbortSignal) => Promise<void>;
}

export function YouTubeImportDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onImport,
}: YouTubeImportDialogProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) return;
    setError(null);
    setIsSubmitting(false);
    controllerRef.current = null;
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("Pega una URL de YouTube para continuar.");
      return;
    }

    try {
      const parsed = new URL(trimmedUrl);
      if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error("La URL debe empezar por http:// o https://.");
      }
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "La URL no es válida.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsSubmitting(true);
    setError(null);

    try {
      await onImport(trimmedUrl, controller.signal);
      setUrl("");
      onOpenChange(false);
    } catch (importError) {
      if (controller.signal.aborted) {
        setError("Importación cancelada.");
      } else {
        setError(importError instanceof Error ? importError.message : "No se pudo importar el vídeo.");
      }
    } finally {
      controllerRef.current = null;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent
        className="border-white/10 bg-zinc-950 text-white sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <LinkIcon className="h-5 w-5 text-cyan-200" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-white/55">{description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={isSubmitting}
          />

          <Alert className="border-white/10 bg-white/[0.03] text-white/70">
            <AlertCircle className="text-cyan-200" />
            <AlertDescription>
              Solo vídeo individual público o unlisted. Shorts y enlaces `youtu.be` también valen.
            </AlertDescription>
          </Alert>

          {error ? (
            <Alert variant="destructive" className="border-red-400/30 bg-red-500/10 text-red-100">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            {isSubmitting ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                onClick={() => controllerRef.current?.abort()}
              >
                Cancelar importación
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl text-white/60 hover:bg-white/10 hover:text-white"
                onClick={() => onOpenChange(false)}
              >
                Cerrar
              </Button>
            )}

            <Button
              type="submit"
              className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
