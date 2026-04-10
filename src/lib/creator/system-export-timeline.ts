import {
  buildCreatorSemanticSubtitlePayload,
  shouldUseCreatorPngSubtitleFallback,
} from "./semantic-subtitles";
import type {
  CreatorShortEditorState,
  CreatorSuggestedShort,
} from "./types";
import type { SubtitleChunk } from "../history";

type OverlayFrame = {
  pngBytes: Uint8Array;
  start: number;
  end: number;
  vfsPath: string;
  kind?: "intro_overlay" | "outro_overlay" | "reactive_overlay" | "subtitle_atlas" | "subtitle_frame";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cropExpression?: string;
};

export interface PrepareSystemExportTimelineDependencies {
  renderTextOverlayToPngFramesFn?: (input: {
    overlay: CreatorShortEditorState["introOverlay"] extends infer T
      ? T extends object
        ? T
        : never
      : never;
    slot: "intro" | "outro";
    clipDurationSeconds: number;
    timeOffsetSeconds: number;
    signal?: AbortSignal;
  }) => Promise<OverlayFrame[]>;
  buildCreatorSemanticSubtitlePayloadFn?: typeof buildCreatorSemanticSubtitlePayload;
  renderSubtitleAtlasesFn?: (
    subtitleChunks: SubtitleChunk[],
    short: CreatorSuggestedShort,
    editor: CreatorShortEditorState,
    timeOffsetSeconds: number,
    signal?: AbortSignal
  ) => Promise<OverlayFrame[]>;
}

export async function prepareSystemExportTimelineArtifacts(
  input: {
    short: CreatorSuggestedShort;
    adjustedShort: CreatorSuggestedShort;
    editor: CreatorShortEditorState;
    subtitleChunks: SubtitleChunk[];
    signal?: AbortSignal;
  },
  dependencies: PrepareSystemExportTimelineDependencies = {}
) {
  const renderTextOverlayToPngFramesFn = dependencies.renderTextOverlayToPngFramesFn;
  const buildCreatorSemanticSubtitlePayloadFn =
    dependencies.buildCreatorSemanticSubtitlePayloadFn ?? buildCreatorSemanticSubtitlePayload;
  const renderSubtitleAtlasesFn = dependencies.renderSubtitleAtlasesFn;

  if (!renderTextOverlayToPngFramesFn) {
    throw new Error("renderTextOverlayToPngFramesFn is required.");
  }

  const introStartedAt = performance.now();
  const introOverlayFrames = await renderTextOverlayToPngFramesFn({
    overlay: input.editor.introOverlay ?? {
      enabled: false,
      text: "",
      startOffsetSeconds: 0,
      durationSeconds: 0,
      positionXPercent: 50,
      positionYPercent: 24,
      scale: 1,
      maxWidthPct: 78,
    },
    slot: "intro",
    clipDurationSeconds: input.short.durationSeconds,
    timeOffsetSeconds: 0,
    signal: input.signal,
  });
  const introOverlayRenderMs = Number(Math.max(0, performance.now() - introStartedAt).toFixed(2));

  const outroStartedAt = performance.now();
  const outroOverlayFrames = await renderTextOverlayToPngFramesFn({
    overlay: input.editor.outroOverlay ?? {
      enabled: false,
      text: "",
      startOffsetSeconds: 0,
      durationSeconds: 0,
      positionXPercent: 50,
      positionYPercent: 34,
      scale: 0.9,
      maxWidthPct: 72,
    },
    slot: "outro",
    clipDurationSeconds: input.short.durationSeconds,
    timeOffsetSeconds: 0,
    signal: input.signal,
  });
  const outroOverlayRenderMs = Number(Math.max(0, performance.now() - outroStartedAt).toFixed(2));

  const subtitleStartedAt = performance.now();
  const semanticSubtitles = buildCreatorSemanticSubtitlePayloadFn({
    subtitleChunks: input.subtitleChunks,
    short: input.adjustedShort,
    editor: input.editor,
    timeOffsetSeconds: 0,
  });
  const subtitleRenderMode: "fast_ass" | "png_parity" =
    semanticSubtitles != null && shouldUseCreatorPngSubtitleFallback(semanticSubtitles.style)
      ? "png_parity"
      : "fast_ass";
  const subtitleAtlases =
    subtitleRenderMode === "png_parity"
      ? await (() => {
          if (!renderSubtitleAtlasesFn) {
            throw new Error("renderSubtitleAtlasesFn is required for png_parity subtitles.");
          }
          return renderSubtitleAtlasesFn(
            input.subtitleChunks,
            input.adjustedShort,
            input.editor,
            0,
            input.signal
          );
        })()
      : [];
  const subtitlePreparationMs = Number(Math.max(0, performance.now() - subtitleStartedAt).toFixed(2));

  return {
    introOverlayFrames,
    outroOverlayFrames,
    semanticSubtitles,
    subtitleRenderMode,
    subtitleAtlases,
    timingsMs: {
      introOverlayRender: introOverlayRenderMs,
      outroOverlayRender: outroOverlayRenderMs,
      subtitlePreparation: subtitlePreparationMs,
    },
  };
}
