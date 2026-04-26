import type { CreatorLLMRunRecord } from "@/lib/creator/types";

export type AiRunsWorkbenchSort = "newest" | "oldest" | "slowest" | "fastest" | "tokens";

export interface AiRunsWorkbenchFilters {
  projectId?: string | null;
  feature?: "all" | CreatorLLMRunRecord["feature"];
  provider?: "all" | CreatorLLMRunRecord["provider"];
  status?: "all" | CreatorLLMRunRecord["status"];
  model?: string;
  q?: string;
  sort?: AiRunsWorkbenchSort;
}

export interface AiRunsWorkbenchMetrics {
  totalRuns: number;
  errorRuns: number;
  successRuns: number;
  errorRate: number;
  uniqueModels: number;
  averageDurationMs: number | null;
  totalTokens: number;
}

export interface AiRunDiffItem {
  path: string;
  kind: "added" | "removed" | "changed";
  beforeType: string;
  afterType: string;
  beforePreview: string;
  afterPreview: string;
}

function normalizeSearchToken(value: string): string {
  return value.trim().toLowerCase();
}

function valueType(value: unknown): string {
  if (value == null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function previewValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `Object(${keys.length})`;
  }
  return String(value);
}

function buildSearchHaystack(run: CreatorLLMRunRecord): string {
  const summary = run.inputSummary;
  return [
    run.id,
    run.projectId,
    run.feature,
    run.provider,
    run.status,
    run.operation,
    run.model,
    run.promptVersion,
    run.requestFingerprint,
    run.apiKeySource,
    run.estimatedCostSource,
    run.errorCode,
    run.errorMessage,
    summary.projectId,
    summary.sourceAssetId,
    summary.transcriptId,
    summary.subtitleId,
    summary.niche,
    summary.audience,
    summary.tone,
    summary.transcriptVersionLabel,
    summary.subtitleVersionLabel,
    summary.videoInfoBlocks?.join(" "),
    summary.imageAspectRatio,
    summary.imageSize,
    summary.imageQuality,
    summary.imageFormat,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function sortAiRunsWorkbenchRecords(
  runs: CreatorLLMRunRecord[],
  sort: AiRunsWorkbenchSort = "newest"
): CreatorLLMRunRecord[] {
  return [...runs].sort((left, right) => {
    switch (sort) {
      case "oldest":
        return left.startedAt - right.startedAt;
      case "slowest":
        return (right.durationMs ?? 0) - (left.durationMs ?? 0);
      case "fastest":
        return (left.durationMs ?? 0) - (right.durationMs ?? 0);
      case "tokens":
        return (right.usage?.totalTokens ?? 0) - (left.usage?.totalTokens ?? 0);
      case "newest":
      default:
        return right.startedAt - left.startedAt;
    }
  });
}

export function filterAiRunsWorkbenchRecords(
  runs: CreatorLLMRunRecord[],
  filters: AiRunsWorkbenchFilters
): CreatorLLMRunRecord[] {
  const query = normalizeSearchToken(filters.q ?? "");

  return sortAiRunsWorkbenchRecords(
    runs.filter((run) => {
      if (filters.projectId && run.projectId !== filters.projectId) return false;
      if (filters.feature && filters.feature !== "all" && run.feature !== filters.feature) return false;
      if (filters.provider && filters.provider !== "all" && run.provider !== filters.provider) return false;
      if (filters.status && filters.status !== "all" && run.status !== filters.status) return false;
      if (filters.model && filters.model !== "all" && run.model !== filters.model) return false;
      if (query && !buildSearchHaystack(run).includes(query)) return false;
      return true;
    }),
    filters.sort
  );
}

export function computeAiRunsWorkbenchMetrics(runs: CreatorLLMRunRecord[]): AiRunsWorkbenchMetrics {
  const totalRuns = runs.length;
  const errorRuns = runs.filter(
    (run) =>
      run.status === "provider_error" ||
      run.status === "parse_error" ||
      run.status === "validation_error"
  ).length;
  const successRuns = runs.filter((run) => run.status === "success").length;
  const settledRuns = successRuns + errorRuns;
  const totalDuration = runs.reduce((sum, run) => sum + (run.durationMs ?? 0), 0);
  const durationCount = runs.filter((run) => Number.isFinite(run.durationMs)).length;
  const totalTokens = runs.reduce((sum, run) => sum + (run.usage?.totalTokens ?? 0), 0);
  const uniqueModels = new Set(runs.map((run) => run.model).filter(Boolean)).size;

  return {
    totalRuns,
    errorRuns,
    successRuns,
    errorRate: settledRuns > 0 ? errorRuns / settledRuns : 0,
    uniqueModels,
    averageDurationMs: durationCount > 0 ? totalDuration / durationCount : null,
    totalTokens,
  };
}

export function collectAiRunDiffItems(
  before: unknown,
  after: unknown,
  options: {
    maxItems?: number;
    maxDepth?: number;
  } = {}
): AiRunDiffItem[] {
  const maxItems = options.maxItems ?? 80;
  const maxDepth = options.maxDepth ?? 6;
  const items: AiRunDiffItem[] = [];

  const visit = (left: unknown, right: unknown, path: string, depth: number) => {
    if (items.length >= maxItems) return;

    const leftType = valueType(left);
    const rightType = valueType(right);

    if (left === undefined && right !== undefined) {
      items.push({
        path,
        kind: "added",
        beforeType: "undefined",
        afterType: rightType,
        beforePreview: "undefined",
        afterPreview: previewValue(right),
      });
      return;
    }

    if (left !== undefined && right === undefined) {
      items.push({
        path,
        kind: "removed",
        beforeType: leftType,
        afterType: "undefined",
        beforePreview: previewValue(left),
        afterPreview: "undefined",
      });
      return;
    }

    if (leftType !== rightType) {
      items.push({
        path,
        kind: "changed",
        beforeType: leftType,
        afterType: rightType,
        beforePreview: previewValue(left),
        afterPreview: previewValue(right),
      });
      return;
    }

    if (depth >= maxDepth) {
      if (JSON.stringify(left) !== JSON.stringify(right)) {
        items.push({
          path,
          kind: "changed",
          beforeType: leftType,
          afterType: rightType,
          beforePreview: previewValue(left),
          afterPreview: previewValue(right),
        });
      }
      return;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        items.push({
          path: `${path}.length`,
          kind: "changed",
          beforeType: "number",
          afterType: "number",
          beforePreview: String(left.length),
          afterPreview: String(right.length),
        });
      }

      const total = Math.max(left.length, right.length);
      for (let index = 0; index < total; index += 1) {
        visit(left[index], right[index], `${path}[${index}]`, depth + 1);
        if (items.length >= maxItems) return;
      }
      return;
    }

    if (left && right && typeof left === "object" && typeof right === "object") {
      const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
      for (const key of keys) {
        const nextPath = path ? `${path}.${key}` : key;
        visit((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], nextPath, depth + 1);
        if (items.length >= maxItems) return;
      }
      return;
    }

    if (left !== right) {
      items.push({
        path,
        kind: "changed",
        beforeType: leftType,
        afterType: rightType,
        beforePreview: previewValue(left),
        afterPreview: previewValue(right),
      });
    }
  };

  visit(before, after, "root", 0);
  return items;
}
