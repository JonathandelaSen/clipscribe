"use client";

import { useCallback, useEffect, useState } from "react";

import {
  COMPOSER_WORKSPACE_PREFS_STORAGE_KEY,
  getDefaultComposerWorkspacePrefs,
  normalizeComposerWorkspacePrefs,
  parseComposerWorkspacePrefs,
  serializeComposerWorkspacePrefs,
  type ComposerWorkspacePrefs,
} from "@/lib/composer/core/workspace-prefs";

function readInitialPrefs(): ComposerWorkspacePrefs {
  if (typeof window === "undefined") {
    return getDefaultComposerWorkspacePrefs();
  }

  return parseComposerWorkspacePrefs(
    window.localStorage.getItem(COMPOSER_WORKSPACE_PREFS_STORAGE_KEY),
    window.innerWidth
  );
}

export function useComposerWorkspacePrefs() {
  const [prefs, setPrefs] = useState<ComposerWorkspacePrefs>(() => readInitialPrefs());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      COMPOSER_WORKSPACE_PREFS_STORAGE_KEY,
      serializeComposerWorkspacePrefs(prefs)
    );
  }, [prefs]);

  const updatePrefs = useCallback(
    (
      updater:
        | Partial<ComposerWorkspacePrefs>
        | ((previous: ComposerWorkspacePrefs) => ComposerWorkspacePrefs)
    ) => {
      setPrefs((previous) => {
        const next =
          typeof updater === "function"
            ? updater(previous)
            : {
                ...previous,
                ...updater,
              };
        return normalizeComposerWorkspacePrefs(next);
      });
    },
    []
  );

  const resetPrefs = useCallback(() => {
    setPrefs(readInitialPrefs());
  }, []);

  return {
    prefs,
    isReady: true,
    updatePrefs,
    resetPrefs,
  };
}
