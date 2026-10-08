import type { ManagerId } from "./types";

/** All manager scans share two slots; repeated requests share their promise. */
export function createManagerScanQueue() {
  const pending = new Map<ManagerId, Promise<void>>();
  const jobs: (() => void)[] = [];
  let running = 0;

  function pump() {
    while (running < 2 && jobs.length) jobs.shift()!();
  }

  return {
    run(manager: ManagerId, job: () => Promise<void>): Promise<void> {
      const existing = pending.get(manager);
      if (existing) return existing;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      pending.set(manager, promise);
      jobs.push(() => {
        running += 1;
        const release = () => {
          pending.delete(manager);
          running -= 1;
          pump();
        };
        void Promise.resolve().then(job).then(() => { release(); resolve(); }, (error) => { release(); reject(error); });
      });
      pump();
      return promise;
    },
  };
}
