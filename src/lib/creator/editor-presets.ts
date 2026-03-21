import type { CreatorVerticalEditorPreset } from "@/lib/creator/types";

export const EDITOR_PRESETS: CreatorVerticalEditorPreset[] = [
  {
    aspectRatio: "9:16",
    resolution: "1080x1920",
    subtitleStyle: "bold_pop",
    safeTopPct: 10,
    safeBottomPct: 16,
    targetDurationRange: [15, 60],
  },
];
