import assert from "node:assert/strict";
import test from "node:test";

import { decryptYouTubeSession, encryptYouTubeSession } from "../../../src/lib/youtube/token-store";

const baseSession = {
  accessToken: "access_123",
  refreshToken: "refresh_456",
  expiresAt: 1_700_000_000_000,
  scope: "scope_a",
  tokenType: "Bearer",
};

test("encryptYouTubeSession round-trips through decryptYouTubeSession", () => {
  const encrypted = encryptYouTubeSession(baseSession, "super-secret");
  const decrypted = decryptYouTubeSession(encrypted, "super-secret");

  assert.deepEqual(decrypted, baseSession);
});

test("decryptYouTubeSession returns null when the secret does not match", () => {
  const encrypted = encryptYouTubeSession(baseSession, "super-secret");
  const decrypted = decryptYouTubeSession(encrypted, "wrong-secret");

  assert.equal(decrypted, null);
});

test("decryptYouTubeSession returns null for malformed values", () => {
  assert.equal(decryptYouTubeSession("bad-value", "super-secret"), null);
});
