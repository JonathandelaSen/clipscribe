import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreatorReactiveOverlayAudioAnalysis,
  createDefaultCreatorReactiveOverlay,
  resolveCreatorReactiveOverlayExportFps,
  resolveCreatorReactiveOverlayFrame,
  resolveCreatorReactiveOverlayRect,
} from "../../../src/lib/creator/reactive-overlays";

test("buildCreatorReactiveOverlayAudioAnalysis follows the selected short window", () => {
  const analysis = buildCreatorReactiveOverlayAudioAnalysis({
    clipStartSeconds: 1,
    clipDurationSeconds: 2,
    decodedSamples: new Float32Array([0.1, 0.2, 1, 1, 0.3, 0.3]),
    sampleRate: 2,
    sampleRateHz: 2,
  });

  assert.equal(analysis.values.length, 4);
  assert.ok(analysis.values[0]! > analysis.values[2]!);
  assert.ok(analysis.values[1]! > analysis.values[3]!);
});

test("resolveCreatorReactiveOverlayFrame is stable for all presets", () => {
  const analysis = {
    durationSeconds: 2,
    sampleRateHz: 60,
    values: new Float32Array(Array.from({ length: 120 }, (_, index) => (index % 3 === 0 ? 0.9 : 0.25))),
  };

  for (const presetId of ["waveform_line", "equalizer_bars", "pulse_ring"] as const) {
    const overlay = createDefaultCreatorReactiveOverlay({
      id: `overlay_${presetId}`,
      presetId,
      startOffsetSeconds: 0,
      durationSeconds: 2,
    });
    const rect = resolveCreatorReactiveOverlayRect({
      overlay,
      frameWidth: 1080,
      frameHeight: 1920,
    });
    const frame = resolveCreatorReactiveOverlayFrame({
      overlay,
      rect,
      analysis,
      projectTimeSeconds: 0.75,
      localTimeSeconds: 0.75,
    });

    assert.ok(frame.width > 0);
    assert.ok(frame.height > 0);
    assert.equal(frame.kind, presetId);
  }
});

test("resolveCreatorReactiveOverlayExportFps lowers export density for long overlays", () => {
  assert.equal(
    resolveCreatorReactiveOverlayExportFps([{ durationSeconds: 3 }]),
    15
  );
  assert.equal(
    resolveCreatorReactiveOverlayExportFps([{ durationSeconds: 12 }]),
    10
  );
  assert.equal(
    resolveCreatorReactiveOverlayExportFps([{ durationSeconds: 24 }]),
    8
  );
  assert.equal(
    resolveCreatorReactiveOverlayExportFps([{ durationSeconds: 40 }]),
    6
  );
});
