import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { YouTubeOAuthSession } from "./types";

const TOKEN_STORE_VERSION = "v1";
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const AAD = Buffer.from("clipscribe-youtube-session");

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptYouTubeSession(session: YouTubeOAuthSession, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [TOKEN_STORE_VERSION, toBase64Url(iv), toBase64Url(authTag), toBase64Url(ciphertext)].join(".");
}

export function decryptYouTubeSession(value: string, secret: string): YouTubeOAuthSession | null {
  const [version, ivRaw, authTagRaw, ciphertextRaw] = String(value || "").split(".");
  if (version !== TOKEN_STORE_VERSION || !ivRaw || !authTagRaw || !ciphertextRaw) {
    return null;
  }

  try {
    const iv = fromBase64Url(ivRaw);
    const authTag = fromBase64Url(authTagRaw);
    const ciphertext = fromBase64Url(ciphertextRaw);
    if (iv.byteLength !== IV_BYTES || authTag.byteLength !== AUTH_TAG_BYTES) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<YouTubeOAuthSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.scope !== "string" ||
      typeof parsed.tokenType !== "string"
    ) {
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      scope: parsed.scope,
      tokenType: parsed.tokenType,
    };
  } catch {
    return null;
  }
}
