import { useEffect, useRef, useState } from "react";

type SelectionInput<Item> = {
  records: readonly Item[] | null;
  isSelectable: (item: Item) => boolean;
  completedIds?: readonly string[] | null;
};

export function useSessionSelection<Item extends { id: string }>({
  records,
  isSelectable,
  completedIds = null,
}: SelectionInput<Item>) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const latest = useRef({ records, isSelectable });
  latest.current = { records, isSelectable };

  useEffect(() => {
    if (!records) return;
    const available = new Set(
      records.filter((item) => latest.current.isSelectable(item)).map((item) => item.id),
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [records]);

  useEffect(() => {
    if (!completedIds?.length) return;
    setSelectedIds((current) => {
      const next = current.filter((id) => !completedIds.includes(id));
      return next.length === current.length ? current : next;
    });
  }, [completedIds]);

  function selectableIds(items: readonly Item[]) {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of items) {
      if (!latest.current.isSelectable(item) || seen.has(item.id)) continue;
      seen.add(item.id);
      ids.push(item.id);
    }
    return ids;
  }

  function toggle(id: string, selected: boolean) {
    if (selected) {
      const item = latest.current.records?.find((candidate) => candidate.id === id);
      if (!item || !latest.current.isSelectable(item)) return;
      setSelectedIds((current) => current.includes(id) ? current : [...current, id]);
    } else {
      setSelectedIds((current) => current.filter((currentId) => currentId !== id));
    }
  }

  function selectAll(items: readonly Item[]) {
    setSelectedIds(selectableIds(items));
  }

  function selectGroup(items: readonly Item[], selected: boolean) {
    const ids = selectableIds(items);
    if (!ids.length) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return [...next];
    });
  }

  function clear() {
    setSelectedIds((current) => current.length ? [] : current);
  }

  return { selectedIds, toggle, selectAll, selectGroup, clear };
}
