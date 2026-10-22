// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSessionSelection } from "./useSessionSelection";

type Item = { id: string; allowed: boolean };

const selectable = (item: Item) => item.allowed;

function renderSelection(records: readonly Item[] | null, completedIds: readonly string[] | null = null) {
  return renderHook(
    (props: { records: readonly Item[] | null; completedIds: readonly string[] | null }) =>
      useSessionSelection({ ...props, isSelectable: selectable }),
    { initialProps: { records, completedIds } },
  );
}

const a: Item = { id: "a", allowed: true };
const b: Item = { id: "b", allowed: false };
const c: Item = { id: "c", allowed: true };

afterEach(cleanup);

describe("Session selection", () => {
  it("selects only eligible existing records", () => {
    const { result } = renderSelection([a, b, c]);
    act(() => result.current.toggle("a", true));
    act(() => result.current.toggle("b", true));
    act(() => result.current.toggle("missing", true));
    expect(result.current.selectedIds).toEqual(["a"]);
    act(() => result.current.toggle("c", true));
    act(() => result.current.toggle("a", false));
    expect(result.current.selectedIds).toEqual(["c"]);
  });

  it("replaces the selection with unique eligible records on select all", () => {
    const { result } = renderSelection([a, b, c]);
    act(() => result.current.toggle("a", true));
    act(() => result.current.selectAll([a, b, c, a]));
    expect(result.current.selectedIds).toEqual(["a", "c"]);
  });

  it("adds and removes only eligible records in a group", () => {
    const { result } = renderSelection([a, b, c]);
    act(() => result.current.toggle("a", true));
    act(() => result.current.selectGroup([b, c], true));
    expect(result.current.selectedIds).toEqual(["a", "c"]);
    act(() => result.current.selectGroup([a, b], false));
    expect(result.current.selectedIds).toEqual(["c"]);
  });

  it("drops records that disappear or become ineligible", async () => {
    const view = renderSelection([a, c]);
    act(() => view.result.current.selectAll([a, c]));
    expect(view.result.current.selectedIds).toEqual(["a", "c"]);
    const next = [{ ...c, allowed: false }, { id: "d", allowed: true }];
    view.rerender({ records: next, completedIds: null });
    await waitFor(() => expect(view.result.current.selectedIds).toEqual([]));
  });

  it("drops completed ids", async () => {
    const view = renderSelection([a, c]);
    act(() => view.result.current.selectAll([a, c]));
    view.rerender({ records: [a, c], completedIds: ["a"] });
    await waitFor(() => expect(view.result.current.selectedIds).toEqual(["c"]));
    view.rerender({ records: [a, c], completedIds: ["a", "c"] });
    await waitFor(() => expect(view.result.current.selectedIds).toEqual([]));
  });

  it("keeps selection when records are temporarily unavailable", async () => {
    const view = renderSelection([a]);
    act(() => view.result.current.toggle("a", true));
    view.rerender({ records: null, completedIds: null });
    await waitFor(() => expect(view.result.current.selectedIds).toEqual(["a"]));
    view.rerender({ records: [], completedIds: null });
    await waitFor(() => expect(view.result.current.selectedIds).toEqual([]));
  });

  it("clears only the current selection", () => {
    const { result } = renderSelection([a, c]);
    act(() => result.current.selectAll([a, c]));
    expect(result.current.selectedIds).toEqual(["a", "c"]);
    act(() => result.current.clear());
    expect(result.current.selectedIds).toEqual([]);
  });
});
