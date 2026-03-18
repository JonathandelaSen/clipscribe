type TransformersEnvLike = {
  allowLocalModels: boolean;
  useBrowserCache: boolean;
};

type CacheCapableScope = {
  caches?: unknown;
} | null | undefined;

export function hasBrowserCache(scope: CacheCapableScope): boolean {
  return typeof scope === "object" && scope !== null && typeof scope.caches !== "undefined";
}

export function configureWorkerTransformersEnv(env: TransformersEnvLike, scope: CacheCapableScope): void {
  env.allowLocalModels = false;
  env.useBrowserCache = hasBrowserCache(scope);
}
