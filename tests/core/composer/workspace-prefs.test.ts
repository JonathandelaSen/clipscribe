import test from "node:test";
import assert from "node:assert/strict";

import {
  applyComposerHorizontalLayoutToPrefs,
  applyComposerVerticalLayoutToPrefs,
  buildComposerHorizontalLayout,
  buildComposerVerticalLayout,
  COMPOSER_WORKSPACE_PREFS_STORAGE_KEY,
  getDefaultComposerWorkspacePrefs,
  normalizeComposerWorkspacePrefs,
  parseComposerWorkspacePrefs,
  serializeComposerWorkspacePrefs,
} from "../../../src/lib/composer/core/workspace-prefs";

test("getDefaultComposerWorkspacePrefs collapses right panel on narrower desktop widths", () => {
  const desktop = getDefaultComposerWorkspacePrefs(1440);
  const compact = getDefaultComposerWorkspacePrefs(1180);

  assert.equal(desktop.collapsedPanels.right, false);
  assert.equal(compact.collapsedPanels.right, true);
});

test("normalizeComposerWorkspacePrefs clamps panel sizes and timeline zoom", () => {
  const normalized = normalizeComposerWorkspacePrefs({
    leftPanelSizePct: 2,
    rightPanelSizePct: 99,
    bottomPanelSizePct: 90,
    timelineZoom: 500,
  });

  assert.equal(normalized.leftPanelSizePct, 14);
  assert.equal(normalized.rightPanelSizePct, 30);
  assert.equal(normalized.bottomPanelSizePct, 55);
  assert.equal(normalized.timelineZoom, 220);
});

test("buildComposerHorizontalLayout maps open panels into percentage layout", () => {
  const layout = buildComposerHorizontalLayout(getDefaultComposerWorkspacePrefs(1440));

  assert.deepEqual(layout, {
    "composer-bin": 18,
    "composer-center": 60,
    "composer-inspector": 22,
  });
});

test("buildComposerHorizontalLayout recovers space when the left panel is collapsed", () => {
  const layout = buildComposerHorizontalLayout({
    ...getDefaultComposerWorkspacePrefs(1440),
    collapsedPanels: {
      left: true,
      right: false,
    },
  });

  assert.deepEqual(layout, {
    "composer-bin": 0,
    "composer-center": 78,
    "composer-inspector": 22,
  });
});

test("buildComposerHorizontalLayout recovers space when the right panel is collapsed", () => {
  const layout = buildComposerHorizontalLayout({
    ...getDefaultComposerWorkspacePrefs(1440),
    collapsedPanels: {
      left: false,
      right: true,
    },
  });

  assert.deepEqual(layout, {
    "composer-bin": 18,
    "composer-center": 82,
    "composer-inspector": 0,
  });
});

test("buildComposerVerticalLayout maps timeline split from bottomPanelSizePct", () => {
  const layout = buildComposerVerticalLayout(getDefaultComposerWorkspacePrefs(1440));

  assert.deepEqual(layout, {
    "composer-viewer": 66,
    "composer-timeline": 34,
  });
});

test("applyComposerHorizontalLayoutToPrefs preserves stored sizes while marking collapsed panels", () => {
  const previous = {
    ...getDefaultComposerWorkspacePrefs(1440),
    leftPanelSizePct: 20,
    rightPanelSizePct: 24,
  };

  const next = applyComposerHorizontalLayoutToPrefs(
    {
      "composer-bin": 0,
      "composer-center": 76,
      "composer-inspector": 24,
    },
    previous
  );

  assert.equal(next.leftPanelSizePct, 20);
  assert.equal(next.rightPanelSizePct, 24);
  assert.equal(next.collapsedPanels.left, true);
  assert.equal(next.collapsedPanels.right, false);
});

test("applyComposerVerticalLayoutToPrefs reads the timeline panel percentage", () => {
  const next = applyComposerVerticalLayoutToPrefs(
    {
      "composer-viewer": 62,
      "composer-timeline": 38,
    },
    getDefaultComposerWorkspacePrefs(1440)
  );

  assert.equal(next.bottomPanelSizePct, 38);
});

test("parse and serialize workspace prefs produce stable values", () => {
  const serialized = serializeComposerWorkspacePrefs({
    leftPanelSizePct: 20,
    rightPanelSizePct: 24,
    bottomPanelSizePct: 36,
    collapsedPanels: { left: true, right: false },
    timelineZoom: 88,
    activeInspectorTab: "audio",
    activeBinTab: "drafts",
  });

  const parsed = parseComposerWorkspacePrefs(serialized);

  assert.equal(parsed.leftPanelSizePct, 20);
  assert.equal(parsed.rightPanelSizePct, 24);
  assert.equal(parsed.bottomPanelSizePct, 36);
  assert.equal(parsed.collapsedPanels.left, true);
  assert.equal(parsed.activeInspectorTab, "audio");
  assert.equal(parsed.activeBinTab, "drafts");
});

test("workspace prefs storage key is versioned to invalidate broken layout state", () => {
  assert.equal(COMPOSER_WORKSPACE_PREFS_STORAGE_KEY, "clipscribe:composer-workspace:v2");
});
