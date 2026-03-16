const REQUIRED_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YOUTUBE_SESSION_SECRET"] as const;

export interface YouTubeEnvConfig {
  configured: boolean;
  missingKeys: string[];
  clientId?: string;
  clientSecret?: string;
  sessionSecret?: string;
}

export function getYouTubeEnvConfig(env: NodeJS.ProcessEnv = process.env): YouTubeEnvConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const sessionSecret = env.YOUTUBE_SESSION_SECRET?.trim();
  const missingKeys = REQUIRED_KEYS.filter((key) => !env[key]?.trim());

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    clientId,
    clientSecret,
    sessionSecret,
  };
}

export function buildYouTubeRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/youtube/oauth/callback`;
}

export function isYouTubeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getYouTubeEnvConfig(env).configured;
}
