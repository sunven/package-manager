import type { UiMessage } from "../types";
import { displayMessage, formatHomePathsInText } from "../utils/format";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";

export function MessageBanner({
  homeDirectory,
  message,
}: {
  homeDirectory: string | null;
  message: UiMessage | null;
}) {
  if (!message) return null;

  return (
    <Alert className="mb-4" variant={message.tone === "bad" ? "destructive" : "default"}>
      <AlertTitle>{message.title}</AlertTitle>
      <AlertDescription>{formatHomePathsInText(displayMessage(message.message), homeDirectory)}</AlertDescription>
    </Alert>
  );
}
