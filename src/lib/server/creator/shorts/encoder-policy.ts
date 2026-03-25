export interface CreatorVideoEncoderSelection {
  codec: string;
  encoderUsed: string;
  isHardwareAccelerated: boolean;
  outputArgs: string[];
}

const HARDWARE_ENCODER_PRIORITY: Array<{
  encoder: string;
  outputArgs: string[];
}> = [
  {
    encoder: "h264_videotoolbox",
    outputArgs: ["-c:v", "h264_videotoolbox", "-b:v", "8M", "-allow_sw", "1", "-prio_speed", "1"],
  },
];

const SOFTWARE_FALLBACK: CreatorVideoEncoderSelection = {
  codec: "libx264",
  encoderUsed: "libx264",
  isHardwareAccelerated: false,
  outputArgs: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"],
};

export function selectCreatorVideoEncoderFromFfmpegOutput(output: string): CreatorVideoEncoderSelection {
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
        outputArgs: [...candidate.outputArgs],
      };
    }
  }

  return {
    ...SOFTWARE_FALLBACK,
    outputArgs: [...SOFTWARE_FALLBACK.outputArgs],
  };
}

export function getCreatorSoftwareFallbackEncoder(): CreatorVideoEncoderSelection {
  return {
    ...SOFTWARE_FALLBACK,
    outputArgs: [...SOFTWARE_FALLBACK.outputArgs],
  };
}
