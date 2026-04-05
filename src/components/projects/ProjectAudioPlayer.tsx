"use client";

import { useEffect, useMemo } from "react";

import { cn } from "@/lib/utils";

type ProjectAudioPlayerProps = {
  file?: File | null;
  className?: string;
};

export function ProjectAudioPlayer({ file, className }: ProjectAudioPlayerProps) {
  const audioUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  return (
    audioUrl ? (
      <audio
        key={audioUrl}
        controls
        preload="metadata"
        src={audioUrl}
        className={cn("block h-12 w-full bg-transparent [color-scheme:dark]", className)}
      />
    ) : (
      <div className={cn("px-4 py-3 text-sm text-white/40", className)}>Playback unavailable</div>
    )
  );
}
