export const PROJECT_YOUTUBE_IMPORT_HEADERS = {
  filename: "x-clipscribe-youtube-filename",
  sizeBytes: "x-clipscribe-youtube-size-bytes",
  durationSeconds: "x-clipscribe-youtube-duration-seconds",
  width: "x-clipscribe-youtube-width",
  height: "x-clipscribe-youtube-height",
  videoId: "x-clipscribe-youtube-video-id",
  title: "x-clipscribe-youtube-title",
  channelTitle: "x-clipscribe-youtube-channel-title",
} as const;

export interface ProjectYouTubeImportResponseMetadata {
  filename: string;
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  videoId: string;
  title?: string;
  channelTitle?: string;
}

function encodeHeaderText(value: string) {
  return encodeURIComponent(value);
}

function decodeHeaderText(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toOptionalFiniteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function readFiniteHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildProjectYouTubeImportHeaders(
  input: ProjectYouTubeImportResponseMetadata
): Record<string, string> {
  const headers: Record<string, string> = {
    [PROJECT_YOUTUBE_IMPORT_HEADERS.filename]: encodeHeaderText(input.filename),
    [PROJECT_YOUTUBE_IMPORT_HEADERS.sizeBytes]: String(input.sizeBytes),
    [PROJECT_YOUTUBE_IMPORT_HEADERS.durationSeconds]: String(input.durationSeconds),
    [PROJECT_YOUTUBE_IMPORT_HEADERS.videoId]: input.videoId,
  };

  const width = toOptionalFiniteNumber(input.width);
  const height = toOptionalFiniteNumber(input.height);
  const title = input.title?.trim();
  const channelTitle = input.channelTitle?.trim();

  if (width) headers[PROJECT_YOUTUBE_IMPORT_HEADERS.width] = width;
  if (height) headers[PROJECT_YOUTUBE_IMPORT_HEADERS.height] = height;
  if (title) headers[PROJECT_YOUTUBE_IMPORT_HEADERS.title] = encodeHeaderText(title);
  if (channelTitle) headers[PROJECT_YOUTUBE_IMPORT_HEADERS.channelTitle] = encodeHeaderText(channelTitle);

  return headers;
}

export function parseProjectYouTubeImportHeaders(
  headers: Headers,
  fallbackFilename: string
): ProjectYouTubeImportResponseMetadata {
  return {
    filename: decodeHeaderText(headers.get(PROJECT_YOUTUBE_IMPORT_HEADERS.filename)) || fallbackFilename,
    sizeBytes: readFiniteHeader(headers, PROJECT_YOUTUBE_IMPORT_HEADERS.sizeBytes) ?? 0,
    durationSeconds: readFiniteHeader(headers, PROJECT_YOUTUBE_IMPORT_HEADERS.durationSeconds) ?? 0,
    width: readFiniteHeader(headers, PROJECT_YOUTUBE_IMPORT_HEADERS.width),
    height: readFiniteHeader(headers, PROJECT_YOUTUBE_IMPORT_HEADERS.height),
    videoId: headers.get(PROJECT_YOUTUBE_IMPORT_HEADERS.videoId) || "",
    title: decodeHeaderText(headers.get(PROJECT_YOUTUBE_IMPORT_HEADERS.title)),
    channelTitle: decodeHeaderText(headers.get(PROJECT_YOUTUBE_IMPORT_HEADERS.channelTitle)),
  };
}
