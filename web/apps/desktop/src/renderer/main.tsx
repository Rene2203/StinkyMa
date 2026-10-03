import { createMockData, InMemoryMailRepository, type AccountsApi, type AIApi, type AIStatus, type AppSettingsApi, type AttachmentFiles, type CleanupApi, type MailRepository, type RulesApi, type SubscriptionsApi, type UserCategoriesApi, type ReceiptsApi, type PromisesApi, type AskApi, type ContactsApi, type PersonalApi, type AttachmentsApi, type MeetingsApi } from "@stinkyma/core";
import { App, pickLocale, type WebPanelHost } from "@stinkyma/ui";
import "@stinkyma/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    stinkyma?: {
      mail: MailRepository;
      accounts: AccountsApi;
      files: AttachmentFiles;
      settings: AppSettingsApi;
      ai: AIApi;
      rules: RulesApi;
      cleanup: CleanupApi;
      subscriptions: SubscriptionsApi;
      categories: UserCategoriesApi;
      receipts: ReceiptsApi;
      promises: PromisesApi;
      ask: AskApi;
      contacts: ContactsApi;
      personal: PersonalApi;
      attachments: AttachmentsApi;
      meetings: MeetingsApi;
      onAIStatus: (callback: (status: AIStatus) => void) => () => void;
      onMailChanged: (callback: () => void) => () => void;
      onOpenMessage: (callback: (messageId: string) => void) => () => void;
      onOpenDigest: (callback: () => void) => () => void;
      webPanel: WebPanelHost;
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
      <App repository={repository} locale={locale} accounts={bridge?.accounts} files={bridge?.files} settings={bridge?.settings} ai={bridge?.ai} rules={bridge?.rules} cleanup={bridge?.cleanup} subscriptions={bridge?.subscriptions} categories={bridge?.categories} receipts={bridge?.receipts} promises={bridge?.promises} ask={bridge?.ask} contacts={bridge?.contacts} personal={bridge?.personal} attachments={bridge?.attachments} meetings={bridge?.meetings} webPanel={bridge?.webPanel} subscribeAIStatus={bridge?.onAIStatus} subscribeChanges={bridge?.onMailChanged} subscribeOpenMessage={bridge?.onOpenMessage} subscribeOpenDigest={bridge?.onOpenDigest} />
    </StrictMode>,
  );
}
