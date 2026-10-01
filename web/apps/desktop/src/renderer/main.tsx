import { createMockData, InMemoryMailRepository, type AccountsApi, type AttachmentFiles, type MailRepository } from "@stinkyma/core";
import { App, pickLocale } from "@stinkyma/ui";
import "@stinkyma/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    stinkyma?: {
      mail: MailRepository;
      accounts: AccountsApi;
      files: AttachmentFiles;
      onMailChanged: (callback: () => void) => () => void;
      onOpenMessage: (callback: (messageId: string) => void) => () => void;
      platform: string;
    };
  }
}

// In der Windows-App kommt alles aus dem Preload (SQLite + IMAP im Main-Prozess).
// Im reinen Browser (Vorschau) laufen Beispieldaten im Arbeitsspeicher, ohne Kontoverwaltung.
const bridge = window.stinkyma;
const repository: MailRepository = bridge?.mail ?? new InMemoryMailRepository(createMockData());
const locale = pickLocale(navigator.languages);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App repository={repository} locale={locale} accounts={bridge?.accounts} files={bridge?.files} subscribeChanges={bridge?.onMailChanged} subscribeOpenMessage={bridge?.onOpenMessage} />
    </StrictMode>,
  );
}
