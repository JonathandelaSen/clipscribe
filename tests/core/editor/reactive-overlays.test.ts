import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectReactiveOverlayAudioAnalysis,
  resolveReactiveOverlayExportFps,
  resolveReactiveOverlayFrame,
  resolveReactiveOverlayRect,
} from "../../../src/lib/editor/reactive-overlays";
import {
  createDefaultAudioTrack,
  createDefaultTimelineOverlayItem,
  createDefaultVideoClip,
  createEmptyEditorProject,
} from "../../../src/lib/editor/storage";

test("buildProjectReactiveOverlayAudioAnalysis respects reverse clips, audio offsets, mute, and volume", () => {
  const project = createEmptyEditorProject({
    id: "overlay-analysis-project",
    now: 10,
    aspectRatio: "16:9",
  });

  const clip = createDefaultVideoClip({
    assetId: "clip-audio",
    label: "Clip",
    durationSeconds: 2,
  });
  clip.trimEndSeconds = 2;
  clip.actions.reverse = true;
  project.timeline.videoClips = [clip];

  const delayedAudio = createDefaultAudioTrack({
    assetId: "bed-audio",
    durationSeconds: 2,
  });
  delayedAudio.startOffsetSeconds = 1;
  delayedAudio.trimEndSeconds = 1;
  delayedAudio.volume = 0.5;
  project.timeline.audioItems = [delayedAudio];

  const mutedAudio = createDefaultAudioTrack({
    assetId: "muted-bed",
    durationSeconds: 2,
  });
  mutedAudio.startOffsetSeconds = 0;
  mutedAudio.trimEndSeconds = 2;
  mutedAudio.muted = true;
  project.timeline.audioItems.push(mutedAudio);

  const analysis = buildProjectReactiveOverlayAudioAnalysis({
    project,
    decodedSamplesByAssetId: new Map([
      ["clip-audio", new Float32Array([0.2, 0.2, 1, 1])],
      ["bed-audio", new Float32Array([0.4, 0.4, 0.4, 0.4])],
      ["muted-bed", new Float32Array([1, 1, 1, 1])],
    ]),
    sampleRate: 2,
    sampleRateHz: 2,
  });

  assert.equal(analysis.values.length, 4);
  assert.ok(analysis.values[0]! > analysis.values[2]!);
  assert.ok(analysis.values[1]! > analysis.values[3]!);
  assert.equal(analysis.values[2], analysis.values[3]);
  assert.ok(analysis.values[2]! > 0);
  assert.ok(analysis.values[2]! < analysis.values[0]!);
});

test("resolveReactiveOverlayExportFps lowers fps for long overlays", () => {
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 3 }]), 15);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 7 }]), 12);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 15 }]), 10);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 25 }]), 8);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 45 }]), 6);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 75 }]), 4);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 180 }]), 2);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "waveform_line", durationSeconds: 955.62 }]), 1);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "pulse_ring", durationSeconds: 955.62 }]), 2);
  assert.equal(resolveReactiveOverlayExportFps([{ presetId: "equalizer_bars", durationSeconds: 955.62 }]), 3);
  assert.equal(
    resolveReactiveOverlayExportFps([
      { presetId: "waveform_line", durationSeconds: 955.62 },
      { presetId: "equalizer_bars", durationSeconds: 955.62 },
    ]),
    3
  );
});

test("resolveReactiveOverlayFrame returns stable geometry for every preset", () => {
  const overlay = createDefaultTimelineOverlayItem({
    presetId: "waveform_line",
    startOffsetSeconds: 0,
    durationSeconds: 2,
  });
  const analysis = {
    durationSeconds: 2,
    sampleRateHz: 60,
    values: new Float32Array(Array.from({ length: 120 }, (_, index) => (index % 2 === 0 ? 0.8 : 0.2))),
  };
  const rect = resolveReactiveOverlayRect({
    overlay,
    frameWidth: 1920,
    frameHeight: 1080,
  });

  const waveformFrame = resolveReactiveOverlayFrame({
    overlay,
    rect,
    analysis,
    projectTimeSeconds: 0.4,
    localTimeSeconds: 0.4,
  });
  assert.equal(waveformFrame.kind, "waveform_line");
  assert.ok(waveformFrame.path.startsWith("M"));

  const barsFrame = resolveReactiveOverlayFrame({
    overlay: { ...overlay, presetId: "equalizer_bars" },
    rect,
    analysis,
    projectTimeSeconds: 0.7,
    localTimeSeconds: 0.7,
  });
  assert.equal(barsFrame.kind, "equalizer_bars");
  assert.ok(barsFrame.bars.length > 10);

  const pulseFrame = resolveReactiveOverlayFrame({
    overlay: { ...overlay, presetId: "pulse_ring" },
    rect,
    analysis,
    projectTimeSeconds: 1.1,
    localTimeSeconds: 1.1,
  });
  assert.equal(pulseFrame.kind, "pulse_ring");
  assert.ok(pulseFrame.radius > pulseFrame.innerRadius);
});
