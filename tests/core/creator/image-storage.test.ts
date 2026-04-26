import test from "node:test";
import assert from "node:assert/strict";

import {
  appendProjectImageRecord,
  buildProjectImageRecord,
  removeProjectImageRecord,
  resolveProjectImageHistory,
} from "../../../src/lib/creator/image-storage";
import type { CreatorImageGenerateRequest, CreatorImageGenerateResponse } from "../../../src/lib/creator/types";

const request: CreatorImageGenerateRequest = {
  projectId: "project_1",
  prompt: "A cinematic product shot",
  aspectRatio: "1:1",
  quality: "low",
  outputFormat: "png",
  count: 1,
  generationConfig: {
    provider: "openai",
    model: "gpt-image-2",
  },
  promptCustomization: {
    mode: "global_customized",
    hash: "pc_demo",
    editedSections: ["globalInstructions"],
    effectiveProfile: {
      globalInstructions: "Use soft light.",
    },
  },
};

const response: CreatorImageGenerateResponse = {
  ok: true,
  providerMode: "openai",
  model: "gpt-image-2",
  generatedAt: 123,
  runtimeSeconds: 1,
  prompt: request.prompt,
  promptPreview: "Effective prompt text",
  aspectRatio: "1:1",
  size: "1024x1024",
  quality: "low",
  outputFormat: "png",
  images: [
    {
      id: "image_1",
      base64: "large-base64",
      mimeType: "image/png",
      filename: "image.png",
    },
  ],
};

test("buildProjectImageRecord stores asset references and prompt metadata without blobs", () => {
  const record = buildProjectImageRecord({
    request,
    response,
    assetIds: ["asset_1"],
    estimatedCostUsd: 0.006,
    estimatedCostSource: "estimated",
  });

  assert.equal(record.generatedAt, 123);
  assert.deepEqual(record.assetIds, ["asset_1"]);
  assert.equal(record.inputSummary.provider, "openai");
  assert.equal(record.inputSummary.model, "gpt-image-2");
  assert.equal(record.inputSummary.promptCustomizationHash, "pc_demo");
  assert.equal(record.inputSummary.promptPreview, "Effective prompt text");
  assert.equal(JSON.stringify(record).includes("large-base64"), false);
});

test("project image history helpers append, cap, resolve, and remove records", () => {
  const first = buildProjectImageRecord({ request, response: { ...response, generatedAt: 1 }, assetIds: ["a"] });
  const second = buildProjectImageRecord({ request, response: { ...response, generatedAt: 2 }, assetIds: ["b"] });

  const history = appendProjectImageRecord([first], second);
  assert.deepEqual(resolveProjectImageHistory({ aiImageHistory: history }).map((record) => record.assetIds[0]), ["b", "a"]);
  assert.deepEqual(removeProjectImageRecord(history, second.id), [first]);
});
