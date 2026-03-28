import {
  getSubtitleMaxCharsPerLine,
  resolveCreatorSubtitleStyle,
  wrapSubtitleLines,
} from "../creator/subtitle-style";
import type { EditorProjectRecord } from "./types";
import type { TimelineCaptionChunk } from "./core/captions";

function formatAssTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const wholeSeconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(
    centiseconds
  ).padStart(2, "0")}`;
}

function toAssColor(hex: string, alpha = 1): string {
  const normalized = String(hex || "#000000")
    .trim()
    .replace(/^#/, "")
    .padStart(6, "0")
    .slice(0, 6);
  const rr = normalized.slice(0, 2);
  const gg = normalized.slice(2, 4);
  const bb = normalized.slice(4, 6);
  const assAlpha = Math.max(0, Math.min(255, 255 - Math.round(Math.max(0, Math.min(1, alpha)) * 255)));
  return `&H${assAlpha.toString(16).padStart(2, "0").toUpperCase()}${bb}${gg}${rr}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function escapeFilterPath(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'");
}

export function buildEditorAssFilterExpression(subtitleTrackPath: string): string {
  return `ass='${escapeFilterPath(subtitleTrackPath)}'`;
}

export function buildEditorAssSubtitleDocument(input: {
  project: EditorProjectRecord;
  chunks: TimelineCaptionChunk[];
  width: number;
  height: number;
}): string {
  const style = resolveCreatorSubtitleStyle(input.project.subtitles.preset, input.project.subtitles.style);
  const fontSize = Math.round(Math.min(96, Math.max(34, 56 * input.project.subtitles.scale)));
  const anchorX = Math.round(input.width * (input.project.subtitles.positionXPercent / 100));
  const anchorY = Math.round(input.height * (input.project.subtitles.positionYPercent / 100));
  const maxCharsPerLine = getSubtitleMaxCharsPerLine(fontSize, style.letterWidth, input.width);
  const scaleX = Math.round(style.letterWidth * 100);
  const outline = Number(style.borderWidth.toFixed(2));
  const shadow =
    style.shadowOpacity > 0 && style.shadowDistance > 0
      ? Number(style.shadowDistance.toFixed(2))
      : 0;
  const backColor = style.backgroundEnabled
    ? toAssColor(style.backgroundColor, style.backgroundOpacity)
    : "&HFF000000";
  const borderStyle = style.backgroundEnabled ? "3" : "1";

  const dialogueLines = input.chunks
    .map((chunk) => {
      const start = chunk.timestamp?.[0];
      const end = chunk.timestamp?.[1];
      if (typeof start !== "number" || !Number.isFinite(start)) return null;
      const safeEnd = typeof end === "number" && Number.isFinite(end) ? end : start;
      if (safeEnd <= start) return null;
      const text = String(chunk.text ?? "").trim();
      if (!text) return null;
      const lines = wrapSubtitleLines(
        style.textCase === "uppercase" ? text.toUpperCase() : text,
        maxCharsPerLine
      );
      if (lines.length === 0) return null;

      return `Dialogue: 0,${formatAssTimestamp(start)},${formatAssTimestamp(safeEnd)},Default,,0,0,0,,{\\an5\\pos(${anchorX},${anchorY})}${escapeAssText(lines.join("\\N"))}`;
    })
    .filter((line): line is string => Boolean(line));

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${input.width}`,
    `PlayResY: ${input.height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    [
      "Style: Default",
      "Inter",
      fontSize,
      toAssColor(style.textColor, 1),
      toAssColor(style.textColor, 1),
      toAssColor(style.borderColor, 0.95),
      backColor,
      "-1",
      "0",
      "0",
      "0",
      String(scaleX),
      "100",
      "0",
      "0",
      borderStyle,
      String(outline),
      String(shadow),
      "5",
      "0",
      "0",
      "0",
      "1",
    ].join(","),
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ...dialogueLines,
    "",
  ].join("\n");
}
