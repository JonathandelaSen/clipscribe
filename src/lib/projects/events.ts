export const PROJECT_LIBRARY_UPDATED_EVENT = "clipscribe:projects-updated";

export function notifyProjectLibraryUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROJECT_LIBRARY_UPDATED_EVENT));
}
