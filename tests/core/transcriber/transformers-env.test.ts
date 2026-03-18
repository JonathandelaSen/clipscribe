import test from "node:test";
import assert from "node:assert/strict";

import { configureWorkerTransformersEnv, hasBrowserCache } from "../../../src/lib/transcriber/core/transformers-env";

test("hasBrowserCache returns false when the worker scope has no Cache API", () => {
  assert.equal(hasBrowserCache({}), false);
  assert.equal(hasBrowserCache(undefined), false);
  assert.equal(hasBrowserCache(null), false);
});

test("hasBrowserCache returns true when the worker scope exposes caches", () => {
  assert.equal(hasBrowserCache({ caches: {} }), true);
});

test("configureWorkerTransformersEnv disables browser cache when it is unavailable", () => {
  const transformersEnv = {
    allowLocalModels: true,
    useBrowserCache: true,
  };

  configureWorkerTransformersEnv(transformersEnv, {});

  assert.deepEqual(transformersEnv, {
    allowLocalModels: false,
    useBrowserCache: false,
  });
});

test("configureWorkerTransformersEnv keeps browser cache enabled when available", () => {
  const transformersEnv = {
    allowLocalModels: true,
    useBrowserCache: false,
  };

  configureWorkerTransformersEnv(transformersEnv, { caches: {} });

  assert.deepEqual(transformersEnv, {
    allowLocalModels: false,
    useBrowserCache: true,
  });
});
