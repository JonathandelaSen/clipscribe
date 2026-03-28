import type {
  CreatorPromptCustomizationMode,
  CreatorPromptSlotOverride,
  CreatorPromptSlotOverrideMode,
  CreatorVideoInfoBlock,
  CreatorVideoInfoPromptCustomizationSnapshot,
  CreatorVideoInfoPromptProfile,
  CreatorVideoInfoPromptSlot,
} from "@/lib/creator/types";

export const VIDEO_INFO_PROMPT_SLOT_ORDER: CreatorVideoInfoPromptSlot[] = [
  "persona",
];

export const VIDEO_INFO_PROMPT_FIELD_ORDER: CreatorVideoInfoBlock[] = [
  "titleIdeas",
  "description",
  "pinnedComment",
  "hashtags",
  "thumbnailHooks",
  "chapters",
  "contentPack",
  "insights",
];

export const VIDEO_INFO_PROMPT_SLOT_DEFAULTS: Record<CreatorVideoInfoPromptSlot, string> = {
  persona: "You are a senior YouTube strategist focused on long-form packaging and SEO.",
};

export const VIDEO_INFO_PROMPT_FIELD_DEFAULTS: Partial<Record<CreatorVideoInfoBlock, string>> = {
  chapters: "Use concrete timestamps for chapters.",
};

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeSlotOverride(value: unknown): CreatorPromptSlotOverride | undefined {
  if (!isRecord(value)) return undefined;
  const mode = value.mode;
  if (mode !== "inherit" && mode !== "replace" && mode !== "omit") {
    return undefined;
  }

  if (mode === "replace") {
    const nextValue = sanitizeText(typeof value.value === "string" ? value.value : undefined);
    if (!nextValue) return undefined;
    return {
      mode,
      value: nextValue,
    };
  }

  return { mode };
}

function isNonDefaultSlotOverride(
  value: CreatorPromptSlotOverride | undefined
): value is CreatorPromptSlotOverride {
  return !!value && value.mode !== "inherit";
}

export function sanitizeVideoInfoPromptProfile(
  profile: unknown
): CreatorVideoInfoPromptProfile | undefined {
  if (!isRecord(profile)) return undefined;

  const slotOverrides: Partial<Record<CreatorVideoInfoPromptSlot, CreatorPromptSlotOverride>> = {};
  const rawSlotOverrides = isRecord(profile.slotOverrides) ? profile.slotOverrides : {};
  for (const slot of VIDEO_INFO_PROMPT_SLOT_ORDER) {
    const nextValue = sanitizeSlotOverride(rawSlotOverrides[slot]);
    if (isNonDefaultSlotOverride(nextValue)) {
      slotOverrides[slot] = nextValue;
    }
  }

  const fieldInstructions: Partial<Record<CreatorVideoInfoBlock, string>> = {};
  const rawFieldInstructions = isRecord(profile.fieldInstructions) ? profile.fieldInstructions : {};
  for (const block of VIDEO_INFO_PROMPT_FIELD_ORDER) {
    const nextValue = sanitizeText(typeof rawFieldInstructions[block] === "string" ? rawFieldInstructions[block] : undefined);
    if (nextValue) {
      fieldInstructions[block] = nextValue;
    }
  }

  const globalInstructions = sanitizeText(
    typeof profile.globalInstructions === "string" ? profile.globalInstructions : undefined
  );

  const normalized: CreatorVideoInfoPromptProfile = {};
  if (Object.keys(slotOverrides).length > 0) {
    normalized.slotOverrides = slotOverrides;
  }
  if (globalInstructions) {
    normalized.globalInstructions = globalInstructions;
  }
  if (Object.keys(fieldInstructions).length > 0) {
    normalized.fieldInstructions = fieldInstructions;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function mergeVideoInfoPromptProfiles(
  baseProfile: CreatorVideoInfoPromptProfile | undefined,
  overrideProfile: CreatorVideoInfoPromptProfile | undefined
): CreatorVideoInfoPromptProfile | undefined {
  const base = sanitizeVideoInfoPromptProfile(baseProfile);
  const override = sanitizeVideoInfoPromptProfile(overrideProfile);
  const slotOverrides: Partial<Record<CreatorVideoInfoPromptSlot, CreatorPromptSlotOverride>> = {};
  const fieldInstructions: Partial<Record<CreatorVideoInfoBlock, string>> = {};

  for (const slot of VIDEO_INFO_PROMPT_SLOT_ORDER) {
    const overrideValue = override?.slotOverrides?.[slot];
    const nextValue = overrideValue ?? base?.slotOverrides?.[slot];
    if (nextValue && nextValue.mode !== "inherit") {
      slotOverrides[slot] = nextValue;
    }
  }

  for (const block of VIDEO_INFO_PROMPT_FIELD_ORDER) {
    const overrideValue = override?.fieldInstructions?.[block];
    const nextValue = overrideValue ?? base?.fieldInstructions?.[block];
    if (nextValue) {
      fieldInstructions[block] = nextValue;
    }
  }

  const instructions = [base?.globalInstructions, override?.globalInstructions].filter(Boolean).join("\n\n").trim();
  const merged: CreatorVideoInfoPromptProfile = {};
  if (Object.keys(slotOverrides).length > 0) {
    merged.slotOverrides = slotOverrides;
  }
  if (instructions) {
    merged.globalInstructions = instructions;
  }
  if (Object.keys(fieldInstructions).length > 0) {
    merged.fieldInstructions = fieldInstructions;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function hasCustomizedVideoInfoPromptProfile(
  profile: CreatorVideoInfoPromptProfile | undefined
): boolean {
  return !!sanitizeVideoInfoPromptProfile(profile);
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computePromptCustomizationHash(value: unknown): string | undefined {
  if (value == null) return undefined;
  const serialized = stableJsonStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pc_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function summarizeVideoInfoPromptEdits(
  profile: CreatorVideoInfoPromptProfile | undefined
): string[] {
  const sanitized = sanitizeVideoInfoPromptProfile(profile);
  if (!sanitized) return [];

  const sections: string[] = [];
  for (const slot of VIDEO_INFO_PROMPT_SLOT_ORDER) {
    if (sanitized.slotOverrides?.[slot]) {
      sections.push(`base:${slot}`);
    }
  }
  if (sanitized.globalInstructions) {
    sections.push("globalInstructions");
  }
  for (const block of VIDEO_INFO_PROMPT_FIELD_ORDER) {
    if (sanitized.fieldInstructions?.[block]) {
      sections.push(`field:${block}`);
    }
  }
  return sections;
}

export function createVideoInfoPromptCustomizationSnapshot(input: {
  globalProfile?: CreatorVideoInfoPromptProfile;
  runProfile?: CreatorVideoInfoPromptProfile;
}): CreatorVideoInfoPromptCustomizationSnapshot | undefined {
  const hasRunProfile = hasCustomizedVideoInfoPromptProfile(input.runProfile);
  const hasGlobalProfile = hasCustomizedVideoInfoPromptProfile(input.globalProfile);

  const mode: CreatorPromptCustomizationMode = hasRunProfile
    ? "run_override"
    : hasGlobalProfile
      ? "global_customized"
      : "default";

  if (mode === "default") {
    return undefined;
  }

  const effectiveProfile = hasRunProfile
    ? mergeVideoInfoPromptProfiles(input.globalProfile, input.runProfile)
    : sanitizeVideoInfoPromptProfile(input.globalProfile);

  if (!effectiveProfile) {
    return undefined;
  }

  return {
    mode,
    effectiveProfile,
    hash: computePromptCustomizationHash(effectiveProfile),
    editedSections: summarizeVideoInfoPromptEdits(effectiveProfile),
  };
}

export function resolveVideoInfoPromptSlotLine(
  slot: CreatorVideoInfoPromptSlot,
  profile: CreatorVideoInfoPromptProfile | undefined
): string | undefined {
  const override = profile?.slotOverrides?.[slot];
  if (override?.mode === "omit") return undefined;
  if (override?.mode === "replace") return override.value;
  return VIDEO_INFO_PROMPT_SLOT_DEFAULTS[slot];
}

export function resolveVideoInfoPromptFieldInstruction(
  block: CreatorVideoInfoBlock,
  profile: CreatorVideoInfoPromptProfile | undefined
): string | undefined {
  return profile?.fieldInstructions?.[block] ?? VIDEO_INFO_PROMPT_FIELD_DEFAULTS[block];
}

export function createEmptyVideoInfoPromptProfile(): CreatorVideoInfoPromptProfile {
  return {};
}

export function createEmptyPromptSlotOverride(mode: CreatorPromptSlotOverrideMode = "inherit"): CreatorPromptSlotOverride {
  return { mode };
}
