import type {
  CreatorAISuggestionInputSummary,
  CreatorShortExportRecord,
  CreatorShortProjectRecord,
} from "@/lib/creator/storage";

export interface CreatorShortSuggestionGenerationGroup {
  generationId: string;
  generatedAt: number;
  sourceSignature: string;
  inputSummary?: CreatorAISuggestionInputSummary;
  projects: CreatorShortProjectRecord[];
}

export function sortCreatorShortProjects(records: CreatorShortProjectRecord[]): CreatorShortProjectRecord[] {
  return [...records].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function sortCreatorShortExports(records: CreatorShortExportRecord[]): CreatorShortExportRecord[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt);
}

export function groupCreatorShortExportsByProjectId(exports: CreatorShortExportRecord[]): Map<string, CreatorShortExportRecord[]> {
  const map = new Map<string, CreatorShortExportRecord[]>();
  for (const exportRecord of exports) {
    const list = map.get(exportRecord.shortProjectId) ?? [];
    list.push(exportRecord);
    map.set(exportRecord.shortProjectId, list);
  }
  return map;
}

export function getManualCreatorShortProjects(records: CreatorShortProjectRecord[]): CreatorShortProjectRecord[] {
  return records.filter((record) => record.origin !== "ai_suggestion");
}

export function getAiSuggestionCreatorShortProjects(records: CreatorShortProjectRecord[]): CreatorShortProjectRecord[] {
  return records.filter((record) => record.origin === "ai_suggestion");
}

export function groupCreatorShortProjectsBySuggestionGeneration(
  records: CreatorShortProjectRecord[]
): CreatorShortSuggestionGenerationGroup[] {
  const generations = new Map<string, CreatorShortSuggestionGenerationGroup>();

  for (const record of getAiSuggestionCreatorShortProjects(records)) {
    const generationId = record.suggestionGenerationId;
    if (!generationId) continue;

    const existing = generations.get(generationId);
    if (existing) {
      existing.projects.push(record);
      continue;
    }

    generations.set(generationId, {
      generationId,
      generatedAt: record.suggestionGeneratedAt ?? record.updatedAt ?? record.createdAt,
      sourceSignature: record.suggestionSourceSignature ?? "",
      inputSummary: record.suggestionInputSummary,
      projects: [record],
    });
  }

  return [...generations.values()]
    .map((group) => ({
      ...group,
      projects: sortCreatorShortProjects(group.projects),
    }))
    .sort((a, b) => b.generatedAt - a.generatedAt);
}
