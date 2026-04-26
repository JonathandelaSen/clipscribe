import type {
  CreatorImageGenerateRequest,
  CreatorImageGenerateResponse,
  CreatorImageProjectRecord,
} from "@/lib/creator/types";
import type { ContentProjectRecord } from "@/lib/projects/types";

const MAX_IMAGE_HISTORY = 40;

function makeImageRecordId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `imagegen_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildProjectImageRecord(input: {
  request: CreatorImageGenerateRequest;
  response: CreatorImageGenerateResponse;
  assetIds: string[];
  estimatedCostUsd?: number | null;
  estimatedCostSource?: CreatorImageProjectRecord["inputSummary"]["estimatedCostSource"];
}): CreatorImageProjectRecord {
  return {
    id: makeImageRecordId(),
    generatedAt: input.response.generatedAt,
    assetIds: input.assetIds,
    inputSummary: {
      provider: input.response.providerMode === "openai" || input.response.providerMode === "gemini" ? input.response.providerMode : undefined,
      model: input.response.model,
      promptCustomizationMode: input.request.promptCustomization?.mode ?? "default",
      promptCustomizationHash: input.request.promptCustomization?.hash,
      promptEditedSections: input.request.promptCustomization?.editedSections?.slice() ?? [],
      promptPreview: input.response.promptPreview,
      aspectRatio: input.response.aspectRatio,
      size: input.response.size,
      quality: input.response.quality,
      outputFormat: input.response.outputFormat,
      count: input.response.images.length,
      estimatedCostUsd: input.estimatedCostUsd,
      estimatedCostSource: input.estimatedCostSource,
    },
  };
}

export function resolveProjectImageHistory(
  project: Pick<ContentProjectRecord, "aiImageHistory"> | null | undefined
): CreatorImageProjectRecord[] {
  return project?.aiImageHistory?.length ? project.aiImageHistory : [];
}

export function appendProjectImageRecord(
  existing: CreatorImageProjectRecord[],
  newRecord: CreatorImageProjectRecord
): CreatorImageProjectRecord[] {
  const updated = [newRecord, ...existing.filter((record) => record.id !== newRecord.id)];
  return updated.slice(0, MAX_IMAGE_HISTORY);
}

export function removeProjectImageRecord(
  existing: CreatorImageProjectRecord[],
  recordId: string
): CreatorImageProjectRecord[] {
  return existing.filter((record) => record.id !== recordId);
}
