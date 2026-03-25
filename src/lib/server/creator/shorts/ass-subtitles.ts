import { wrapSubtitleLines } from "../../../creator/subtitle-style";
import type { CreatorShortSemanticSubtitlePayload } from "../../../creator/semantic-subtitles";

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

export function buildAssSubtitleDocument(input: CreatorShortSemanticSubtitlePayload): string {
  const scaleX = Math.round(input.style.letterWidth * 100);
  const outline = Number(input.style.borderWidth.toFixed(2));
  const shadow =
    input.style.shadowOpacity > 0 && input.style.shadowDistance > 0
      ? Number(input.style.shadowDistance.toFixed(2))
      : 0;

  const dialogueLines = input.chunks
    .map((chunk) => {
      const lines = wrapSubtitleLines(chunk.text, input.maxCharsPerLine);
      if (lines.length === 0) return null;

      return `Dialogue: 0,${formatAssTimestamp(chunk.start)},${formatAssTimestamp(chunk.end)},Default,,0,0,0,,{\\an5\\pos(${input.anchorX},${input.anchorY})}${escapeAssText(lines.join("\\N"))}`;
    })
    .filter((line): line is string => Boolean(line));

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${input.canvasWidth}`,
    `PlayResY: ${input.canvasHeight}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    [
      "Style: Default",
      "Inter",
      input.fontSize,
      toAssColor(input.style.textColor, 1),
      toAssColor(input.style.textColor, 1),
      toAssColor(input.style.borderColor, 0.95),
      toAssColor(input.style.shadowColor, input.style.shadowOpacity),
      "-1",
      "0",
      "0",
      "0",
      String(scaleX),
      "100",
      "0",
      "0",
      "1",
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
