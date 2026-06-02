import type { UiMessage } from "../types";
import { displayMessage } from "../utils/format";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";

export function MessageBanner({ message }: { message: UiMessage | null }) {
  if (!message) return null;

  return (
    <Alert className="mb-4" variant={message.tone === "bad" ? "destructive" : "default"}>
      <AlertTitle>{message.title}</AlertTitle>
      <AlertDescription>{displayMessage(message.message)}</AlertDescription>
    </Alert>
  );
}
