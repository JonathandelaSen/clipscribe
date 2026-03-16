export const YOUTUBE_FORCE_SSL_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export const YOUTUBE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const YOUTUBE_UPLOAD_VIDEO_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
export const YOUTUBE_UPLOAD_THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
export const YOUTUBE_UPLOAD_CAPTION_URL = "https://www.googleapis.com/upload/youtube/v3/captions";
export const YOUTUBE_DATA_API_BASE_URL = "https://www.googleapis.com/youtube/v3";

export const YOUTUBE_VIDEO_INSERT_PARTS = ["snippet", "status", "recordingDetails", "localizations"] as const;
export const YOUTUBE_STATUS_POLL_PARTS = ["processingDetails", "status"] as const;
export const YOUTUBE_CATEGORIES_PART = "snippet";
export const YOUTUBE_LANGUAGES_PART = "snippet";

export const YOUTUBE_SESSION_COOKIE = "clipscribe_youtube_session";
export const YOUTUBE_STATE_COOKIE = "clipscribe_youtube_state";
export const YOUTUBE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const YOUTUBE_STATE_MAX_AGE_SECONDS = 60 * 15;

export const YOUTUBE_DEFAULT_REGION_CODE = "US";
export const YOUTUBE_POLL_INTERVAL_MS = 2_500;
export const YOUTUBE_POLL_ATTEMPTS = 5;
