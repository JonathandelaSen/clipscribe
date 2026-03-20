import type { CreatorVerticalEditorPreset, ShortsPlatform } from "@/lib/creator/types";

export const EDITOR_PRESETS: CreatorVerticalEditorPreset[] = [
  {
    platform: "youtube_shorts",
    aspectRatio: "9:16",
    resolution: "1080x1920",
    subtitleStyle: "bold_pop",
    safeTopPct: 10,
    safeBottomPct: 16,
    targetDurationRange: [20, 55],
  },
  {
    platform: "tiktok",
    aspectRatio: "9:16",
    resolution: "1080x1920",
    subtitleStyle: "creator_neon",
    safeTopPct: 8,
    safeBottomPct: 20,
    targetDurationRange: [15, 45],
  },
  {
    platform: "instagram_reels",
    aspectRatio: "9:16",
    resolution: "1080x1920",
    subtitleStyle: "clean_caption",
    safeTopPct: 9,
    safeBottomPct: 18,
    targetDurationRange: [15, 60],
  },
];

export function getEditorPresetForPlatform(platform: ShortsPlatform): CreatorVerticalEditorPreset {
  return EDITOR_PRESETS.find((preset) => preset.platform === platform) ?? EDITOR_PRESETS[0];
}
