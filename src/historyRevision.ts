let revision = 0;
const listeners = new Set<() => void>();

export function historyRevision() {
  return revision;
}

export function subscribeHistoryRevision(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function bumpHistoryRevision() {
  revision += 1;
  for (const listener of listeners) listener();
}
