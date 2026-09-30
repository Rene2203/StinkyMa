import { createMockData, InMemoryMailRepository, type MailRepository } from "@stinkyma/core";
import { App, pickLocale } from "@stinkyma/ui";
import "@stinkyma/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    stinkyma?: { mail: MailRepository; platform: string };
  }
}

// In der Windows-App kommt die Schnittstelle aus dem Preload (SQLite im Main-Prozess).
// Im reinen Browser (Vorschau) laufen Beispieldaten im Arbeitsspeicher.
const repository: MailRepository = window.stinkyma?.mail ?? new InMemoryMailRepository(createMockData());
const locale = pickLocale(navigator.languages);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App repository={repository} locale={locale} />
    </StrictMode>,
  );
}
