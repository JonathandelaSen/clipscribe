export type ComposerBinTab = "media" | "drafts" | "project";
export type ComposerInspectorTab = "clip" | "audio" | "export";

export interface ComposerWorkspacePrefs {
  leftPanelSizePct: number;
  rightPanelSizePct: number;
  bottomPanelSizePct: number;
  collapsedPanels: {
    left: boolean;
    right: boolean;
  };
  timelineZoom: number;
  activeInspectorTab: ComposerInspectorTab;
  activeBinTab: ComposerBinTab;
}

export type ComposerHorizontalLayout = Record<string, number> & {
  "composer-bin": number;
  "composer-center": number;
  "composer-inspector": number;
};

export type ComposerVerticalLayout = Record<string, number> & {
  "composer-viewer": number;
  "composer-timeline": number;
};

export const COMPOSER_WORKSPACE_PREFS_STORAGE_KEY = "clipscribe:composer-workspace:v2";

const DEFAULT_PREFS: ComposerWorkspacePrefs = {
  leftPanelSizePct: 18,
  rightPanelSizePct: 22,
  bottomPanelSizePct: 34,
  collapsedPanels: {
    left: false,
    right: false,
  },
  timelineZoom: 96,
  activeInspectorTab: "clip",
  activeBinTab: "media",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(value: number): number {
  return Number(value.toFixed(3));
}

function isBinTab(value: unknown): value is ComposerBinTab {
  return value === "media" || value === "drafts" || value === "project";
}

function isInspectorTab(value: unknown): value is ComposerInspectorTab {
  return value === "clip" || value === "audio" || value === "export";
}

export function getDefaultComposerWorkspacePrefs(viewportWidth?: number): ComposerWorkspacePrefs {
  if (typeof viewportWidth === "number" && viewportWidth < 1280) {
    return {
      ...DEFAULT_PREFS,
      collapsedPanels: {
        left: false,
        right: true,
      },
    };
  }
  return DEFAULT_PREFS;
}

export function normalizeComposerWorkspacePrefs(
  input: Partial<ComposerWorkspacePrefs> | null | undefined,
  viewportWidth?: number
): ComposerWorkspacePrefs {
  const defaults = getDefaultComposerWorkspacePrefs(viewportWidth);

  return {
    leftPanelSizePct: clamp(Number(input?.leftPanelSizePct ?? defaults.leftPanelSizePct), 14, 28),
    rightPanelSizePct: clamp(Number(input?.rightPanelSizePct ?? defaults.rightPanelSizePct), 16, 30),
    bottomPanelSizePct: clamp(Number(input?.bottomPanelSizePct ?? defaults.bottomPanelSizePct), 24, 55),
    collapsedPanels: {
      left: Boolean(input?.collapsedPanels?.left ?? defaults.collapsedPanels.left),
      right: Boolean(input?.collapsedPanels?.right ?? defaults.collapsedPanels.right),
    },
    timelineZoom: clamp(Number(input?.timelineZoom ?? defaults.timelineZoom), 48, 220),
    activeInspectorTab: isInspectorTab(input?.activeInspectorTab)
      ? input.activeInspectorTab
      : defaults.activeInspectorTab,
    activeBinTab: isBinTab(input?.activeBinTab) ? input.activeBinTab : defaults.activeBinTab,
  };
}

export function buildComposerHorizontalLayout(
  prefs: ComposerWorkspacePrefs
): ComposerHorizontalLayout {
  const left = prefs.collapsedPanels.left ? 0 : prefs.leftPanelSizePct;
  const right = prefs.collapsedPanels.right ? 0 : prefs.rightPanelSizePct;
  const center = Math.max(0, 100 - left - right);

  return {
    "composer-bin": round3(left),
    "composer-center": round3(center),
    "composer-inspector": round3(right),
  };
}

export function buildComposerVerticalLayout(
  prefs: ComposerWorkspacePrefs
): ComposerVerticalLayout {
  return {
    "composer-viewer": round3(100 - prefs.bottomPanelSizePct),
    "composer-timeline": round3(prefs.bottomPanelSizePct),
  };
}

export function applyComposerHorizontalLayoutToPrefs(
  layout: Record<string, number>,
  previous: ComposerWorkspacePrefs
): ComposerWorkspacePrefs {
  const leftSize = Number(layout["composer-bin"] ?? 0);
  const rightSize = Number(layout["composer-inspector"] ?? 0);
  const leftCollapsed = leftSize <= 0.1;
  const rightCollapsed = rightSize <= 0.1;

  return normalizeComposerWorkspacePrefs({
    ...previous,
    leftPanelSizePct: leftCollapsed ? previous.leftPanelSizePct : leftSize,
    rightPanelSizePct: rightCollapsed ? previous.rightPanelSizePct : rightSize,
    collapsedPanels: {
      left: leftCollapsed,
      right: rightCollapsed,
    },
  });
}

export function applyComposerVerticalLayoutToPrefs(
  layout: Record<string, number>,
  previous: ComposerWorkspacePrefs
): ComposerWorkspacePrefs {
  return normalizeComposerWorkspacePrefs({
    ...previous,
    bottomPanelSizePct: Number(layout["composer-timeline"] ?? previous.bottomPanelSizePct),
  });
}

export function parseComposerWorkspacePrefs(
  rawValue: string | null | undefined,
  viewportWidth?: number
): ComposerWorkspacePrefs {
  if (!rawValue) return getDefaultComposerWorkspacePrefs(viewportWidth);

  try {
    const parsed = JSON.parse(rawValue) as Partial<ComposerWorkspacePrefs>;
    return normalizeComposerWorkspacePrefs(parsed, viewportWidth);
  } catch {
    return getDefaultComposerWorkspacePrefs(viewportWidth);
  }
}

export function serializeComposerWorkspacePrefs(value: ComposerWorkspacePrefs): string {
  return JSON.stringify(normalizeComposerWorkspacePrefs(value));
}
