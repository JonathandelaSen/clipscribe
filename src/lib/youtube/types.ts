export type YouTubePrivacyStatus = "private" | "unlisted" | "public";
export type YouTubeLicense = "youtube" | "creativeCommon";

export interface YouTubeLocalizationInput {
  locale: string;
  title: string;
  description: string;
}

export interface YouTubeRelatedVideoReference {
  videoId: string;
  title: string;
  watchUrl: string;
  studioUrl: string;
  privacyStatus?: YouTubePrivacyStatus;
  publishedAt?: string;
  thumbnailUrl?: string;
}

export interface YouTubeUploadDraft {
  title: string;
  description: string;
  privacyStatus: YouTubePrivacyStatus;
  tags: string[];
  categoryId?: string;
  defaultLanguage?: string;
  notifySubscribers?: boolean;
  embeddable?: boolean;
  license?: YouTubeLicense;
  publicStatsViewable?: boolean;
  publishAt?: string;
  selfDeclaredMadeForKids?: boolean;
  containsSyntheticMedia?: boolean;
  recordingDate?: string;
  localizations: YouTubeLocalizationInput[];
  relatedVideo?: YouTubeRelatedVideoReference;
}

export interface YouTubeThumbnailUpload {
  file: Blob;
  filename: string;
  mimeType: string;
}

export interface YouTubeCaptionUpload {
  file: Blob;
  filename: string;
  language: string;
  name: string;
  isDraft: boolean;
}

export interface YouTubeChannelSummary {
  id: string;
  title: string;
  description?: string;
  customUrl?: string;
  thumbnailUrl?: string;
}

export interface YouTubeRelatedVideoOption extends YouTubeRelatedVideoReference {}

export interface YouTubeCategoryOption {
  id: string;
  title: string;
  assignable: boolean;
}

export interface YouTubeLanguageOption {
  id: string;
  name: string;
}

export interface YouTubeOptionCatalog {
  regionCode: string;
  categories: YouTubeCategoryOption[];
  languages: YouTubeLanguageOption[];
}

export interface YouTubeOAuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export interface YouTubeSessionStatus {
  configured: boolean;
  connected: boolean;
  expiresAt?: number;
  missingEnvKeys?: string[];
}

export interface YouTubeAccessTokenResponse {
  ok: true;
  accessToken: string;
  expiresAt: number;
  tokenType: string;
}

export type YouTubePublishStepState = "applied" | "skipped" | "failed";

export interface YouTubePublishStepResult {
  state: YouTubePublishStepState;
  error?: string;
}

export interface YouTubeVideoProcessingStatus {
  videoId: string;
  processingStatus: string;
  uploadStatus?: string;
  failureReason?: string;
  rejectionReason?: string;
  privacyStatus?: string;
}

export interface YouTubePublishResult {
  ok: true;
  videoId: string;
  watchUrl: string;
  studioUrl: string;
  processing: YouTubeVideoProcessingStatus;
  thumbnail: YouTubePublishStepResult;
  caption: YouTubePublishStepResult;
}

export type YouTubeBrowserUploadPhase =
  | "idle"
  | "initializing"
  | "uploading"
  | "thumbnail"
  | "caption"
  | "processing"
  | "complete";

export interface YouTubeBrowserUploadProgress {
  phase: YouTubeBrowserUploadPhase;
  percent: number;
  message: string;
}
