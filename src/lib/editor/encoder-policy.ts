export interface EditorVideoEncoderSelection {
  codec: string;
  encoderUsed: string;
  isHardwareAccelerated: boolean;
  outputArgs: string[];
}

const HARDWARE_ENCODER_PRIORITY: Array<{
  encoder: string;
  bitrateByResolution: Record<"720p" | "1080p" | "4K", string>;
  extraArgs: string[];
}> = [
  {
    encoder: "h264_videotoolbox",
    bitrateByResolution: {
      "720p": "5M",
      "1080p": "8M",
      "4K": "20M",
    },
    extraArgs: ["-allow_sw", "1", "-prio_speed", "1"],
  },
] as const;

const SOFTWARE_FALLBACK_BY_RESOLUTION: Record<"720p" | "1080p" | "4K", string[]> = {
  "720p": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"],
  "1080p": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"],
  "4K": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24"],
};

export function selectEditorVideoEncoderFromFfmpegOutput(
  output: string,
  resolution: "720p" | "1080p" | "4K"
): EditorVideoEncoderSelection {
  const availableEncoders = new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[1] ?? "")
      .filter(Boolean)
  );

  for (const candidate of HARDWARE_ENCODER_PRIORITY) {
    if (availableEncoders.has(candidate.encoder)) {
      return {
        codec: candidate.encoder,
        encoderUsed: candidate.encoder,
        isHardwareAccelerated: true,
        outputArgs: [
          "-c:v",
          candidate.encoder,
          "-b:v",
          candidate.bitrateByResolution[resolution],
          ...candidate.extraArgs,
        ],
      };
    }
  }

  return getEditorSoftwareFallbackEncoder(resolution);
}

export function getEditorSoftwareFallbackEncoder(
  resolution: "720p" | "1080p" | "4K"
): EditorVideoEncoderSelection {
  const outputArgs = SOFTWARE_FALLBACK_BY_RESOLUTION[resolution];
  return {
    codec: "libx264",
    encoderUsed: "libx264",
    isHardwareAccelerated: false,
    outputArgs: [...outputArgs],
  };
}
