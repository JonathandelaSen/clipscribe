import type { ComposerExportSettings, ComposerQuality, ComposerRatio } from "../types";

export interface ComposerExportPreset {
  width: number;
  height: number;
  resolution: string;
  crf: number;
  audioBitrateKbps: number;
}

const PRESET_MATRIX: Record<ComposerRatio, Record<ComposerQuality, ComposerExportPreset>> = {
  "9:16": {
    low: { width: 540, height: 960, resolution: "540x960", crf: 28, audioBitrateKbps: 96 },
    medium: { width: 720, height: 1280, resolution: "720x1280", crf: 24, audioBitrateKbps: 128 },
    high: { width: 1080, height: 1920, resolution: "1080x1920", crf: 20, audioBitrateKbps: 192 },
  },
  "1:1": {
    low: { width: 540, height: 540, resolution: "540x540", crf: 28, audioBitrateKbps: 96 },
    medium: { width: 720, height: 720, resolution: "720x720", crf: 24, audioBitrateKbps: 128 },
    high: { width: 1080, height: 1080, resolution: "1080x1080", crf: 20, audioBitrateKbps: 192 },
  },
  "16:9": {
    low: { width: 960, height: 540, resolution: "960x540", crf: 28, audioBitrateKbps: 96 },
    medium: { width: 1280, height: 720, resolution: "1280x720", crf: 24, audioBitrateKbps: 128 },
    high: { width: 1920, height: 1080, resolution: "1920x1080", crf: 20, audioBitrateKbps: 192 },
  },
};

export function getComposerExportPreset(settings: ComposerExportSettings): ComposerExportPreset {
  return PRESET_MATRIX[settings.ratio][settings.quality];
}
