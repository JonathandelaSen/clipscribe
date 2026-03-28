import test from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_INFO_PROMPT_SLOT_DEFAULTS,
  computePromptCustomizationHash,
  createVideoInfoPromptCustomizationSnapshot,
  mergeVideoInfoPromptProfiles,
  resolveVideoInfoPromptFieldInstruction,
  resolveVideoInfoPromptSlotLine,
  sanitizeVideoInfoPromptProfile,
  selectVideoInfoPromptCustomizationSnapshot,
  summarizeVideoInfoPromptEdits,
} from "../../../src/lib/creator/prompt-customization";

test("sanitizeVideoInfoPromptProfile removes empty instructions and inherit-only slot overrides", () => {
  const profile = sanitizeVideoInfoPromptProfile({
    slotOverrides: {
      persona: { mode: "inherit" },
    },
    globalInstructions: "   ",
    fieldInstructions: {
      titleIdeas: "  Add an emoji only when it helps.  ",
      description: "   ",
    },
  });

  assert.deepEqual(profile, {
    fieldInstructions: {
      titleIdeas: "Add an emoji only when it helps.",
    },
  });
});

test("mergeVideoInfoPromptProfiles layers global defaults with run overrides", () => {
  const merged = mergeVideoInfoPromptProfiles(
    {
      slotOverrides: {
        persona: { mode: "replace", value: "Global persona." },
      },
      globalInstructions: "Global instruction.",
      fieldInstructions: {
        description: "Mention the blog.",
      },
    },
    {
      globalInstructions: "Run-only note.",
      fieldInstructions: {
        titleIdeas: "Use emojis sometimes.",
      },
    }
  );

  assert.deepEqual(merged, {
    slotOverrides: {
      persona: { mode: "replace", value: "Global persona." },
    },
    globalInstructions: "Global instruction.\n\nRun-only note.",
    fieldInstructions: {
      description: "Mention the blog.",
      titleIdeas: "Use emojis sometimes.",
    },
  });
});

test("createVideoInfoPromptCustomizationSnapshot reports run overrides and edited sections", () => {
  const snapshot = createVideoInfoPromptCustomizationSnapshot({
    globalProfile: {
      globalInstructions: "Global instruction.",
    },
    runProfile: {
      fieldInstructions: {
        titleIdeas: "Use emojis sometimes.",
      },
    },
  });

  assert.equal(snapshot?.mode, "run_override");
  assert.equal(snapshot?.hash, computePromptCustomizationHash(snapshot?.effectiveProfile));
  assert.deepEqual(snapshot?.editedSections, ["globalInstructions", "field:titleIdeas"]);
});

test("selectVideoInfoPromptCustomizationSnapshot follows the active editor mode", () => {
  const globalSnapshot = createVideoInfoPromptCustomizationSnapshot({
    globalProfile: {
      globalInstructions: "Global instruction.",
    },
  });
  const runSnapshot = createVideoInfoPromptCustomizationSnapshot({
    globalProfile: {
      globalInstructions: "Global instruction.",
    },
    runProfile: {
      fieldInstructions: {
        titleIdeas: "Use emojis sometimes.",
      },
    },
  });

  assert.equal(
    selectVideoInfoPromptCustomizationSnapshot("global", {
      globalSnapshot,
      runSnapshot,
    }),
    globalSnapshot
  );
  assert.equal(
    selectVideoInfoPromptCustomizationSnapshot("run", {
      globalSnapshot,
      runSnapshot,
    }),
    runSnapshot
  );
  assert.equal(
    selectVideoInfoPromptCustomizationSnapshot("run", {
      globalSnapshot,
    }),
    globalSnapshot
  );
});

test("resolveVideoInfoPromptSlotLine uses defaults unless explicitly replaced or omitted", () => {
  assert.equal(resolveVideoInfoPromptSlotLine("persona", undefined), VIDEO_INFO_PROMPT_SLOT_DEFAULTS.persona);
  assert.equal(
    resolveVideoInfoPromptSlotLine("persona", {
      slotOverrides: {
        persona: { mode: "replace", value: "Custom persona." },
      },
    }),
    "Custom persona."
  );
  assert.equal(
    resolveVideoInfoPromptSlotLine("persona", {
      slotOverrides: {
        persona: { mode: "omit" },
      },
    }),
    undefined
  );
});

test("chapters field keeps the built-in default instruction unless overridden", () => {
  assert.equal(resolveVideoInfoPromptFieldInstruction("chapters", undefined), "Use concrete timestamps for chapters.");
  assert.equal(
    resolveVideoInfoPromptFieldInstruction("chapters", {
      fieldInstructions: {
        chapters: "Use YouTube-style timestamps and shorter labels.",
      },
    }),
    "Use YouTube-style timestamps and shorter labels."
  );
});

test("summarizeVideoInfoPromptEdits returns stable section ids", () => {
  assert.deepEqual(
    summarizeVideoInfoPromptEdits({
      slotOverrides: {
        persona: { mode: "replace", value: "Custom persona." },
      },
      globalInstructions: "Add a CTA.",
      fieldInstructions: {
        description: "Mention the blog.",
      },
    }),
    ["base:persona", "globalInstructions", "field:description"]
  );
});
