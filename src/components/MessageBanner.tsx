import type { UiMessage } from "../types";
import { displayMessage } from "../utils/format";
import { cx } from "../utils/classNames";

export function MessageBanner({ message }: { message: UiMessage | null }) {
  if (!message) return null;

  return (
    <section
      className={cx(
        "mb-4 flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        message.tone === "bad" && "border-red-200 bg-red-50 text-red-900",
        message.tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900",
        message.tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900",
      )}
    >
      <strong className="shrink-0">{message.title}</strong>
      <span className="min-w-0">{displayMessage(message.message)}</span>
    </section>
  );
}
