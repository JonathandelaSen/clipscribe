import test from "node:test";
import assert from "node:assert/strict";

import {
  assertExportGeometryInvariants,
  checkExportGeometryInvariants,
} from "../../../src/lib/creator/core/export-contracts";
import { buildCanonicalShortExportGeometry } from "../../../src/lib/creator/core/export-geometry";

type GeometryCase = {
  name: string;
  sourceWidth: number;
  sourceHeight: number;
  editor: { zoom: number; panX: number; panY: number };
};

const matrixCases: GeometryCase[] = [
  {
    name: "landscape source + default zoom",
    sourceWidth: 1920,
    sourceHeight: 1080,
    editor: { zoom: 1, panX: 0, panY: 0 },
  },
  {
    name: "landscape source + zoom-out pad mode",
    sourceWidth: 1920,
    sourceHeight: 1080,
    editor: { zoom: 0.5, panX: 0, panY: 120 },
  },
  {
    name: "portrait source",
    sourceWidth: 1080,
    sourceHeight: 1920,
    editor: { zoom: 1.1, panX: 60, panY: -60 },
  },
  {
    name: "square source",
    sourceWidth: 1080,
    sourceHeight: 1080,
    editor: { zoom: 1.2, panX: 220, panY: -160 },
  },
  {
    name: "extreme pan/zoom bounds",
    sourceWidth: 3840,
    sourceHeight: 2160,
    editor: { zoom: 2.6, panX: 900, panY: -900 },
  },
];

for (const item of matrixCases) {
  test(`checkExportGeometryInvariants passes for ${item.name}`, () => {
    const geometry = buildCanonicalShortExportGeometry({
      sourceWidth: item.sourceWidth,
      sourceHeight: item.sourceHeight,
      editor: item.editor,
    });

    const result = checkExportGeometryInvariants({
      sourceWidth: item.sourceWidth,
      sourceHeight: item.sourceHeight,
      geometry,
    });

    assert.equal(result.ok, true);
    assert.equal(geometry.outputWidth, 1080);
    assert.equal(geometry.outputHeight, 1920);
  });
}

test("assertExportGeometryInvariants accepts canonical short geometry", () => {
  const geometry = buildCanonicalShortExportGeometry({
    sourceWidth: 1920,
    sourceHeight: 1080,
    editor: { zoom: 1.35, panX: 240, panY: -120 },
  });

  assert.doesNotThrow(() =>
    assertExportGeometryInvariants(
      {
        sourceWidth: 1920,
        sourceHeight: 1080,
        geometry,
      },
      { contextLabel: "test-case" }
    )
  );
});
