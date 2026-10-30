export interface AppUpdateProgressTracker {
  started(contentLength: number | null | undefined): number | null;
  progress(chunkLength: number): number | null;
  finished(): number;
}

export function createAppUpdateProgressTracker(): AppUpdateProgressTracker {
  let total: number | null = null;
  let downloaded = 0;

  return {
    started(contentLength) {
      total = typeof contentLength === "number" && contentLength > 0 ? contentLength : null;
      downloaded = 0;
      return total === null ? null : 0;
    },
    progress(chunkLength) {
      if (chunkLength > 0) downloaded += chunkLength;
      if (total === null) return null;
      return Math.min(100, Math.round((downloaded / total) * 100));
    },
    finished() {
      return 100;
    },
  };
}
